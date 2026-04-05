import { BrowserProvider, Contract, Network, getAddress, type Eip1193Provider, type TransactionResponse } from "ethers";
import type { Task } from "@/contracts/config";

const ESCROW_WRITE_ABI = [
  "function fundTask(uint256 taskId, address worker_, address verifier_, address token_, uint256 amount_) external",
  "function release(uint256 taskId) external",
  "function refund(uint256 taskId) external",
] as const;

/** Matches `HederaTaskEscrow.tasks` public getter (struct → tuple). */
const ESCROW_READ_ABI = [
  "function tasks(uint256 taskId) view returns (address client, address worker, address verifier, address token, uint256 amount, uint8 status)",
] as const;

/** On-chain `HederaTaskEscrow.Status`: None=0, Funded=1, Released=2, Refunded=3 */
const ONCHAIN_STATUS = { none: 0, funded: 1, released: 2, refunded: 3 } as const;

const ERC20_ABI = ["function approve(address spender, uint256 amount) external returns (bool)"] as const;

/**
 * Hedera EVM `eth_estimateGas` is unreliable for HTS precompile calls
 * (long-zero token addresses). Hardcoded gas limits bypass estimation.
 */
const HEDERA_GAS = { gasLimit: 1_500_000 } as const;

function requireEnvEscrow(): { contractAddress: string; rpcUrl: string } {
  const contractAddress = (import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS as string | undefined)?.trim() ?? "";
  const rpcUrl = (import.meta.env.VITE_HEDERA_EVM_RPC as string | undefined)?.trim() ?? "https://testnet.hashio.io/api";
  if (!contractAddress.startsWith("0x")) {
    throw new Error("Set VITE_ESCROW_CONTRACT_ADDRESS (0x…) in .env for on-chain escrow.");
  }
  return { contractAddress, rpcUrl };
}

const HEDERA_TESTNET_CHAIN_HEX = "0x128";
const HEDERA_TESTNET_CHAIN_ID = 296;
const HEDERA_TESTNET_NETWORK = Network.from(HEDERA_TESTNET_CHAIN_ID);

function defaultHederaTestnetRpc(): string {
  return (import.meta.env.VITE_HEDERA_EVM_RPC as string | undefined)?.trim() ?? "https://testnet.hashio.io/api";
}

const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_MS = 800;

function isRateLimited(e: unknown): boolean {
  const msg = String((e as { message?: string }).message ?? e).toLowerCase();
  return msg.includes("rate limit") || msg.includes("429") || msg.includes("-32005");
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= RATE_LIMIT_RETRIES; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isRateLimited(e) || i === RATE_LIMIT_RETRIES) throw e;
      await new Promise((r) => setTimeout(r, RATE_LIMIT_BASE_MS * 2 ** i));
    }
  }
  throw last;
}

type RpcTxPayload = Partial<{
  to: string;
  from: string;
  data: string;
}>;

type RpcPayload = Partial<{
  method: string;
  params: unknown[];
}>;

export type NativeAssociationActions = Partial<{
  associateToken: (accountId: string, tokenId: string) => Promise<{ transactionId: string }>;
  canExecuteNativeTransactions: boolean;
}>;

function extractRpcPayloadTx(payload: RpcPayload | undefined): RpcTxPayload | undefined {
  const first = payload?.params?.[0];
  return typeof first === "object" && first ? (first as RpcTxPayload) : undefined;
}

function extractRpcErrorContext(e: unknown): {
  rpcCode?: number | string;
  rpcMessage?: string;
  method?: string;
  tx?: RpcTxPayload;
} {
  const err = e as {
    code?: number | string;
    error?: { code?: number | string; message?: string };
    info?: { error?: { code?: number | string; message?: string }; payload?: RpcPayload };
    payload?: RpcPayload;
  };
  const nested = err.info?.error ?? err.error;
  const payload = err.info?.payload ?? err.payload;
  return {
    rpcCode: nested?.code ?? err.code,
    rpcMessage: nested?.message,
    method: payload?.method,
    tx: extractRpcPayloadTx(payload),
  };
}

function isHederaLongZeroAddress(address: string | undefined): boolean {
  return typeof address === "string" && /^0x0{24,}[0-9a-fA-F]{1,16}$/.test(address);
}

function isHederaTokenId(tokenId: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(tokenId.trim());
}

function formatRpcClientError(e: unknown, hint: string): Error | null {
  const { rpcCode, rpcMessage, method, tx } = extractRpcErrorContext(e);
  const lowerRpc = (rpcMessage ?? "").toLowerCase();
  if (!lowerRpc.includes("rpc endpoint returned http client error")) return null;
  const txMethod = method === "eth_sendTransaction" ? "wallet send" : method ? `${method} request` : "wallet request";
  let detail =
    `${hint}: Hedera RPC rejected the ${txMethod} before broadcast. ` +
    "Confirm the wallet is on Hedera Testnet (chain 296), the configured RPC URL is healthy, and the token is already associated to the funding wallet.";
  if (tx?.from) detail += ` Wallet: ${tx.from}.`;
  if (tx?.to) detail += ` Target: ${tx.to}.`;
  if (isHederaLongZeroAddress(tx?.to)) {
    detail += " This token is using Hedera's long-zero EVM address format; if your wallet/provider rejects it consistently, use a token whose mirror node exposes `evm_address`.";
  }
  if (rpcCode !== undefined) detail += ` RPC code: ${rpcCode}.`;
  return new Error(detail);
}

/** Switch or add MetaMask / injected wallet to Hedera Testnet (296). Does not require `VITE_ESCROW_CONTRACT_ADDRESS`. */
export async function ensureHederaTestnetEvmChain(ethereum: Eip1193Provider): Promise<void> {
  const rpcUrl = defaultHederaTestnetRpc();
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: HEDERA_TESTNET_CHAIN_HEX }] });
  } catch (e: unknown) {
    const code = typeof e === "object" && e && "code" in e ? (e as { code?: number }).code : undefined;
    if (code !== 4902) throw e;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: HEDERA_TESTNET_CHAIN_HEX,
          chainName: "Hedera Testnet",
          nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 8 },
          rpcUrls: [rpcUrl],
          blockExplorerUrls: ["https://hashscan.io/testnet"],
        },
      ],
    });
  }
}

export async function ensureHederaEvmChain(ethereum: Eip1193Provider): Promise<void> {
  requireEnvEscrow();
  await ensureHederaTestnetEvmChain(ethereum);
}

export function getInjectedEip1193(): Eip1193Provider | undefined {
  const g = globalThis as typeof globalThis & { ethereum?: Eip1193Provider };
  return g.ethereum;
}

let _cachedProvider: BrowserProvider | null = null;
let _cachedEth: Eip1193Provider | null = null;

export function getBrowserProvider(): BrowserProvider {
  const ethereum = getInjectedEip1193();
  if (!ethereum) {
    throw new Error("No injected wallet (window.ethereum). Use a browser wallet that supports Hedera EVM.");
  }
  if (_cachedProvider && _cachedEth === ethereum) return _cachedProvider;
  const provider = new BrowserProvider(ethereum, HEDERA_TESTNET_CHAIN_ID, {
    staticNetwork: HEDERA_TESTNET_NETWORK,
    pollingInterval: 4_000,
    cacheTimeout: 6_000,
  });
  _cachedProvider = provider;
  _cachedEth = ethereum;
  return provider;
}

async function getFundingWalletAddress(): Promise<string> {
  const signer = await getBrowserProvider().getSigner();
  return getAddress(await signer.getAddress());
}

function isUserRejected(e: unknown): boolean {
  const err = e as { code?: number | string; message?: string };
  if (err.code === "ACTION_REJECTED" || err.code === 4001) return true;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("user rejected") || m.includes("user denied");
}

function formatEscrowSendError(e: unknown, hint: string): Error {
  if (isUserRejected(e)) return e instanceof Error ? e : new Error(String(e));
  const rpcClientError = formatRpcClientError(e, hint);
  if (rpcClientError) return rpcClientError;
  const msg = String(
    (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? e,
  );
  const lower = msg.toLowerCase();
  if (lower.includes("task exists")) {
    return new Error(
      `${hint}: this task id is already on the escrow contract (each id can only be funded once). Use “Sync contract” on the task page if the UI is stale, or create a new task.`,
    );
  }
  if (
    lower.includes("transferfrom") ||
    lower.includes("erc20") ||
    lower.includes("exceeds balance") ||
    lower.includes("exceeds allowance")
  ) {
    return new Error(
      `${hint}: token transfer failed — confirm allowance covers the amount, you have balance, and the HTS token is associated to your wallet.`,
    );
  }
  if (lower.includes("revert") && lower.includes("data=null")) {
    return new Error(
      `${hint}: revert with no decoded reason (common on Hedera). Check HashScan for the tx: input data must be non-empty for fundTask; empty calldata means a plain send to the contract, which always fails.`,
    );
  }
  return new Error(`${hint}. ${msg}`);
}

async function readAllowance(task: Task): Promise<bigint> {
  const { contractAddress } = requireEnvEscrow();
  if (!task.tokenEvm) throw new Error("Task missing tokenEvm");
  const provider = getBrowserProvider();
  const me = await getFundingWalletAddress();
  const token = new Contract(
    task.tokenEvm,
    ["function allowance(address owner, address spender) view returns (uint256)"],
    provider,
  );
  return withRetry(() => token.allowance(me, contractAddress) as Promise<bigint>);
}

async function readEscrowTaskRow(taskId: bigint): Promise<{
  client: string;
  worker: string;
  verifier: string;
  token: string;
  amount: bigint;
  status: number;
}> {
  const { contractAddress } = requireEnvEscrow();
  const escrow = new Contract(contractAddress, ESCROW_READ_ABI, getBrowserProvider());
  const row = await withRetry(() => escrow.tasks(taskId) as Promise<readonly unknown[]>);
  return {
    client: getAddress(String(row[0])),
    worker: getAddress(String(row[1])),
    verifier: getAddress(String(row[2])),
    token: getAddress(String(row[3])),
    amount: BigInt(String(row[4])),
    status: Number(row[5]),
  };
}

/** Throws if this task id is already used on-chain (cannot fund twice). */
export async function assertEscrowTaskIsFundable(task: Task): Promise<void> {
  const row = await readEscrowTaskRow(BigInt(task.id));
  if (row.status !== ONCHAIN_STATUS.none) {
    const label =
      row.status === ONCHAIN_STATUS.funded
        ? "already funded"
        : row.status === ONCHAIN_STATUS.released
          ? "already released (paid out)"
          : row.status === ONCHAIN_STATUS.refunded
            ? "already refunded"
            : `status code ${row.status}`;
    throw new Error(
      `Escrow task #${task.id} is not empty on-chain (${label}). fundTask only works once per task id. Sync from the contract or create a new task.`,
    );
  }
}

async function assertAllowanceCoversFund(task: Task): Promise<void> {
  const allowance = await readAllowance(task);
  if (allowance < task.amount) {
    throw new Error(
      `Allowance too low before fundTask: need at least ${task.amount} (smallest units), currently ${allowance}. Finish the approve step first.`,
    );
  }
}

/**
 * `fundTask` sets `client = msg.sender` and pulls tokens from the caller. Only the task client EVM may fund.
 */
export async function assertFundingWalletIsClient(task: Task): Promise<void> {
  if (!task.clientEvm) throw new Error("Task missing clientEvm");
  const wallet = await getFundingWalletAddress();
  const expected = getAddress(task.clientEvm);
  if (wallet !== expected) {
    throw new Error(
      `Wrong EVM wallet: you must use the CLIENT account (who created the task). Expected ${expected}, connected ${wallet}. The worker cannot sign fund — the contract pulls USDC from msg.sender.`,
    );
  }
}

export async function assertClientHasTokenBalance(task: Task): Promise<void> {
  if (!task.tokenEvm) throw new Error("Task missing tokenEvm");
  const provider = getBrowserProvider();
  const me = await getFundingWalletAddress();
  const token = new Contract(task.tokenEvm, ["function balanceOf(address) view returns (uint256)"], provider);
  const bal: bigint = await withRetry(() => token.balanceOf(me) as Promise<bigint>);
  if (bal < task.amount) {
    throw new Error(
      `Insufficient token balance: need at least ${task.amount} (smallest units), have ${bal}. Send the escrow token to the client wallet ${me} first.`,
    );
  }
}

async function isTokenAssociated(tokenEvm: string): Promise<boolean> {
  try {
    const provider = getBrowserProvider();
    const me = await getFundingWalletAddress();
    const token = new Contract(tokenEvm, ["function balanceOf(address) view returns (uint256)"], provider);
    await token.balanceOf(me);
    return true;
  } catch {
    return false;
  }
}

function hasNativeAssociationActions(actions: NativeAssociationActions | undefined): actions is Required<NativeAssociationActions> {
  return Boolean(actions?.canExecuteNativeTransactions && actions.associateToken);
}

async function waitForTokenAssociation(tokenEvm: string, attempts = 4, delayMs = 1_250): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await isTokenAssociated(tokenEvm)) return true;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

/**
 * Hedera token association is a native HTS operation, so only wallets with Hedera-native signing
 * support (HashPack via WalletConnect in this app) can perform it in-app.
 */
async function ensureHtsTokenAssociation(task: Task, nativeAssociation?: NativeAssociationActions): Promise<void> {
  if (!task.tokenEvm) throw new Error("Task missing tokenEvm");
  const wallet = await getFundingWalletAddress();
  if (await isTokenAssociated(task.tokenEvm)) return;

  if (!isHederaTokenId(task.paymentToken)) {
    throw new Error(
      `On-chain escrow expected paymentToken to be a Hedera token id (0.0.x), received ${task.paymentToken}. Recreate the task with a real Hedera token id.`,
    );
  }

  if (!hasNativeAssociationActions(nativeAssociation)) {
    throw new Error(
      `HTS token ${task.paymentToken} (${task.tokenEvm}) is not associated to client wallet ${wallet} for Hedera account ${task.client}. MetaMask / injected EVM wallets cannot associate HTS tokens in this flow. Sign in with HashPack to associate it in-app, or associate the token manually in your wallet before retrying.`,
    );
  }

  let transactionId: string | undefined;
  try {
    const result = await nativeAssociation.associateToken(task.client, task.paymentToken);
    transactionId = result.transactionId;
  } catch (e: unknown) {
    if (isUserRejected(e)) throw e;
    const msg = String(
      (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? e,
    );
    throw new Error(
      `HTS association failed for token ${task.paymentToken} on Hedera account ${task.client} / wallet ${wallet}. ${msg}`,
    );
  }

  if (await waitForTokenAssociation(task.tokenEvm)) return;

  throw new Error(
    `HashPack submitted token association for ${task.paymentToken} on Hedera account ${task.client}, but wallet ${wallet} still does not show the token as associated. Wait for transaction ${transactionId ?? "pending"} to finalize on HashScan, then retry funding.`,
  );
}

export async function approveTokenForEscrow(
  task: Task,
  nativeAssociation?: NativeAssociationActions,
): Promise<TransactionResponse | null> {
  const { contractAddress } = requireEnvEscrow();
  if (!task.tokenEvm) throw new Error("Task missing tokenEvm");
  await assertFundingWalletIsClient(task);
  await ensureHtsTokenAssociation(task, nativeAssociation);
  await assertClientHasTokenBalance(task);
  const allowance = await readAllowance(task);
  if (allowance >= task.amount) return null;
  const signer = await getBrowserProvider().getSigner();
  const token = new Contract(task.tokenEvm, ERC20_ABI, signer);
  try {
    await withRetry(() => token.approve.staticCall(contractAddress, task.amount, HEDERA_GAS) as Promise<boolean>);
  } catch (e: unknown) {
    throw formatEscrowSendError(e, "approve would revert");
  }
  try {
    return await withRetry(() => token.approve(contractAddress, task.amount, HEDERA_GAS) as Promise<TransactionResponse>);
  } catch (e: unknown) {
    throw formatEscrowSendError(e, "approve send failed");
  }
}

export async function fundTaskOnChain(task: Task): Promise<TransactionResponse> {
  const { contractAddress } = requireEnvEscrow();
  if (!task.workerEvm || !task.verifierEvm || !task.tokenEvm) {
    throw new Error("Task missing EVM addresses for fundTask");
  }
  await assertFundingWalletIsClient(task);
  await assertEscrowTaskIsFundable(task);
  await assertAllowanceCoversFund(task);

  const signer = await getBrowserProvider().getSigner();
  const escrow = new Contract(contractAddress, ESCROW_WRITE_ABI, signer);
  const args = [BigInt(task.id), task.workerEvm, task.verifierEvm, task.tokenEvm, task.amount] as const;

  try {
    await withRetry(() => escrow.fundTask.staticCall(...args));
  } catch (e: unknown) {
    throw formatEscrowSendError(e, "fundTask would revert");
  }

  const populated = await escrow.fundTask.populateTransaction(...args, HEDERA_GAS);
  if (!populated.data || populated.data === "0x") {
    throw new Error(
      "Built fundTask transaction has empty calldata — refusing to send. (Sending 0-byte data to the escrow contract always reverts on Hedera.)",
    );
  }

  try {
    return await withRetry(() =>
      signer.sendTransaction({
        to: contractAddress,
        data: populated.data,
        gasLimit: HEDERA_GAS.gasLimit,
      }) as Promise<TransactionResponse>,
    );
  } catch (e: unknown) {
    throw formatEscrowSendError(e, "fundTask send failed");
  }
}

export async function releaseOnChain(taskId: number): Promise<import("ethers").TransactionResponse> {
  const { contractAddress } = requireEnvEscrow();
  const signer = await getBrowserProvider().getSigner();
  const escrow = new Contract(contractAddress, ESCROW_WRITE_ABI, signer);
  return withRetry(() => escrow.release(BigInt(taskId), HEDERA_GAS) as Promise<import("ethers").TransactionResponse>);
}

export async function refundOnChain(taskId: number): Promise<import("ethers").TransactionResponse> {
  const { contractAddress } = requireEnvEscrow();
  const signer = await getBrowserProvider().getSigner();
  const escrow = new Contract(contractAddress, ESCROW_WRITE_ABI, signer);
  return withRetry(() => escrow.refund(BigInt(taskId), HEDERA_GAS) as Promise<import("ethers").TransactionResponse>);
}
