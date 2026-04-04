import { BrowserProvider, Contract, Network, getAddress, type Eip1193Provider, type TransactionResponse, type TransactionReceipt } from "ethers";
import type { Task } from "@/contracts/config";

const ESCROW_WRITE_ABI = [
  "function fundTask(uint256 taskId, address worker_, address verifier_, address token_, uint256 amount_) external",
  "function release(uint256 taskId) external",
  "function refund(uint256 taskId) external",
] as const;

const ERC20_ABI = ["function approve(address spender, uint256 amount) external returns (bool)"] as const;

const HTS_TOKEN_ASSOCIATE_ABI = ["function associate() external"] as const;

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

const RATE_LIMIT_RETRIES = 5;
const RATE_LIMIT_BASE_MS = 2000;

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

const RECEIPT_POLL_MS = 5_000;
const RECEIPT_TIMEOUT_MS = 180_000;

/**
 * Poll for a transaction receipt manually instead of using ethers `.wait()`,
 * which triggers an aggressive block-number poller that trips Hashio 429.
 */
export async function waitForReceipt(tx: TransactionResponse): Promise<TransactionReceipt | null> {
  const provider = tx.provider;
  const t0 = Date.now();
  while (Date.now() - t0 < RECEIPT_TIMEOUT_MS) {
    try {
      const receipt = await provider.getTransactionReceipt(tx.hash);
      if (receipt) return receipt;
    } catch (e) {
      if (!isRateLimited(e)) throw e;
    }
    await new Promise((r) => setTimeout(r, RECEIPT_POLL_MS));
  }
  throw new Error(`Transaction receipt not found after ${RECEIPT_TIMEOUT_MS / 1000}s. Hash: ${tx.hash}`);
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
          nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
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
    pollingInterval: 30_000,
    cacheTimeout: 30_000,
  });
  _cachedProvider = provider;
  _cachedEth = ethereum;
  return provider;
}

function isUserRejected(e: unknown): boolean {
  const err = e as { code?: number | string; message?: string };
  if (err.code === "ACTION_REJECTED" || err.code === 4001) return true;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("user rejected") || m.includes("user denied");
}

/**
 * Links the signer's Hedera account to the HTS token on the ledger. Required before approve/transferFrom.
 * No-ops safely if the token is already associated (typical empty revert from the precompile).
 */
/**
 * `fundTask` sets `client = msg.sender` and pulls tokens from the caller. Only the task client EVM may fund.
 */
export async function assertFundingWalletIsClient(task: Task): Promise<void> {
  if (!task.clientEvm) throw new Error("Task missing clientEvm");
  const signer = await getBrowserProvider().getSigner();
  const wallet = getAddress(await signer.getAddress());
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
  const signer = await provider.getSigner();
  const me = getAddress(await signer.getAddress());
  const token = new Contract(task.tokenEvm, ["function balanceOf(address) view returns (uint256)"], provider);
  const bal: bigint = await withRetry(() => token.balanceOf(me) as Promise<bigint>);
  if (bal < task.amount) {
    throw new Error(
      `Insufficient token balance: need at least ${task.amount} (smallest units), have ${bal}. Send the escrow token to the client wallet ${me} first.`,
    );
  }
}

export async function associateHtsToken(tokenEvm: string): Promise<void> {
  const signer = await getBrowserProvider().getSigner();
  const token = new Contract(tokenEvm, HTS_TOKEN_ASSOCIATE_ABI, signer);
  try {
    const tx = await withRetry(() => token.associate(HEDERA_GAS) as Promise<TransactionResponse>);
    await waitForReceipt(tx);
  } catch (e: unknown) {
    if (isUserRejected(e)) throw e;
    const msg = String((e as { message?: string }).message ?? "").toLowerCase();
    const alreadyAssociated =
      msg.includes("already associated") ||
      msg.includes("token_already_associated") ||
      msg.includes("precompile") ||
      msg.includes("contract_revert_executed");
    if (alreadyAssociated) {
      console.info("HTS token already associated — continuing.");
    } else {
      console.warn("HTS associate() failed. If approve still fails, associate the token manually in your wallet.", e);
    }
  }
}

export async function approveTokenForEscrow(task: Task): Promise<import("ethers").TransactionResponse> {
  const { contractAddress } = requireEnvEscrow();
  if (!task.tokenEvm) throw new Error("Task missing tokenEvm");
  await assertFundingWalletIsClient(task);
  await associateHtsToken(task.tokenEvm);
  const signer = await getBrowserProvider().getSigner();
  const token = new Contract(task.tokenEvm, ERC20_ABI, signer);
  return withRetry(() => token.approve(contractAddress, task.amount, HEDERA_GAS) as Promise<import("ethers").TransactionResponse>);
}

export async function fundTaskOnChain(task: Task): Promise<import("ethers").TransactionResponse> {
  const { contractAddress } = requireEnvEscrow();
  if (!task.workerEvm || !task.verifierEvm || !task.tokenEvm) {
    throw new Error("Task missing EVM addresses for fundTask");
  }
  await assertFundingWalletIsClient(task);
  const signer = await getBrowserProvider().getSigner();
  const escrow = new Contract(contractAddress, ESCROW_WRITE_ABI, signer);
  return withRetry(() =>
    escrow.fundTask(BigInt(task.id), task.workerEvm, task.verifierEvm, task.tokenEvm, task.amount, HEDERA_GAS) as Promise<
      import("ethers").TransactionResponse
    >,
  );
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
