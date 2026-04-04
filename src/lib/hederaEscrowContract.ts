import { BrowserProvider, Contract, Interface, JsonRpcProvider, getAddress, type Eip1193Provider } from "ethers";
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
const HEDERA_TESTNET_CHAIN_CAIP = "eip155:296";
const HEDERA_TESTNET_CHAIN_ID = 296;
const TX_RECEIPT_POLL_MS = 2500;
const TX_RECEIPT_TIMEOUT_MS = 180_000;

function defaultHederaTestnetRpc(): string {
  return (import.meta.env.VITE_HEDERA_EVM_RPC as string | undefined)?.trim() ?? "https://testnet.hashio.io/api";
}

const RATE_LIMIT_RETRIES = 4;
const RATE_LIMIT_BASE_MS = 1500;

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

/** Switch or add the connected EVM wallet to Hedera Testnet (296). Does not require `VITE_ESCROW_CONTRACT_ADDRESS`. */
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

  if ("setDefaultChain" in ethereum && typeof ethereum.setDefaultChain === "function") {
    ethereum.setDefaultChain(HEDERA_TESTNET_CHAIN_CAIP);
  }
}

export async function ensureHederaEvmChain(ethereum: Eip1193Provider): Promise<void> {
  requireEnvEscrow();
  await ensureHederaTestnetEvmChain(ethereum);
}

export function getWindowInjectedEip1193(): Eip1193Provider | undefined {
  const g = globalThis as typeof globalThis & { ethereum?: Eip1193Provider };
  return g.ethereum;
}

export function getInjectedEip1193(): Eip1193Provider | undefined {
  if (_preferredEip1193) return _preferredEip1193;
  return getWindowInjectedEip1193();
}

let _cachedProvider: BrowserProvider | null = null;
let _cachedEth: Eip1193Provider | null = null;
let _preferredEip1193: Eip1193Provider | null = null;
let _cachedRpcProvider: JsonRpcProvider | null = null;
let _cachedRpcUrl: string | null = null;

export function setPreferredEip1193(provider: Eip1193Provider | null): void {
  if (_preferredEip1193 === provider) return;
  _preferredEip1193 = provider;
  _cachedProvider = null;
  _cachedEth = null;
}

export function getBrowserProvider(): BrowserProvider {
  const ethereum = getInjectedEip1193();
  if (!ethereum) {
    throw new Error("No EVM wallet connected. Sign in with a Hedera Testnet wallet first.");
  }
  if (_cachedProvider && _cachedEth === ethereum) return _cachedProvider;
  const provider = new BrowserProvider(ethereum);
  _cachedProvider = provider;
  _cachedEth = ethereum;
  return provider;
}

function getRpcProvider(): JsonRpcProvider {
  const rpcUrl = defaultHederaTestnetRpc();
  if (_cachedRpcProvider && _cachedRpcUrl === rpcUrl) return _cachedRpcProvider;
  const provider = new JsonRpcProvider(rpcUrl, HEDERA_TESTNET_CHAIN_ID, { staticNetwork: true });
  _cachedRpcProvider = provider;
  _cachedRpcUrl = rpcUrl;
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
  const signer = await getBrowserProvider().getSigner();
  const me = getAddress(await signer.getAddress());
  const token = new Contract(task.tokenEvm, ["function balanceOf(address) view returns (uint256)"], getRpcProvider());
  const bal: bigint = await withRetry(() => token.balanceOf(me) as Promise<bigint>);
  if (bal < task.amount) {
    throw new Error(
      `Insufficient token balance: need at least ${task.amount} (smallest units), have ${bal}. Send the escrow token to the client wallet ${me} first.`,
    );
  }
}

async function sendUncheckedTransaction(to: string, data: string): Promise<string> {
  const signer = await getBrowserProvider().getSigner();
  return withRetry(() =>
    signer.sendUncheckedTransaction({
      to,
      data,
      gasLimit: HEDERA_GAS.gasLimit,
    }),
  );
}

export async function waitForHederaTransaction(hash: string): Promise<import("ethers").TransactionReceipt> {
  const provider = getRpcProvider();
  const startedAt = Date.now();

  while (Date.now() - startedAt < TX_RECEIPT_TIMEOUT_MS) {
    const receipt = await withRetry(() => provider.getTransactionReceipt(hash));
    if (receipt) {
      if (receipt.status === 0) {
        throw new Error(`Transaction reverted on Hedera Testnet: ${hash}`);
      }
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, TX_RECEIPT_POLL_MS));
  }

  throw new Error(`Timed out waiting for Hedera Testnet confirmation: ${hash}`);
}

export async function associateHtsToken(tokenEvm: string): Promise<void> {
  const tokenInterface = new Interface(HTS_TOKEN_ASSOCIATE_ABI);
  try {
    const hash = await sendUncheckedTransaction(tokenEvm, tokenInterface.encodeFunctionData("associate"));
    await waitForHederaTransaction(hash);
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

export async function approveTokenForEscrow(task: Task): Promise<string> {
  const { contractAddress } = requireEnvEscrow();
  if (!task.tokenEvm) throw new Error("Task missing tokenEvm");
  await assertFundingWalletIsClient(task);
  await associateHtsToken(task.tokenEvm);
  const tokenInterface = new Interface(ERC20_ABI);
  return sendUncheckedTransaction(task.tokenEvm, tokenInterface.encodeFunctionData("approve", [contractAddress, task.amount]));
}

export async function fundTaskOnChain(task: Task): Promise<string> {
  const { contractAddress } = requireEnvEscrow();
  if (!task.workerEvm || !task.verifierEvm || !task.tokenEvm) {
    throw new Error("Task missing EVM addresses for fundTask");
  }
  await assertFundingWalletIsClient(task);
  const escrowInterface = new Interface(ESCROW_WRITE_ABI);
  return sendUncheckedTransaction(
    contractAddress,
    escrowInterface.encodeFunctionData("fundTask", [BigInt(task.id), task.workerEvm, task.verifierEvm, task.tokenEvm, task.amount]),
  );
}

export async function releaseOnChain(taskId: number): Promise<string> {
  const { contractAddress } = requireEnvEscrow();
  const escrowInterface = new Interface(ESCROW_WRITE_ABI);
  return sendUncheckedTransaction(contractAddress, escrowInterface.encodeFunctionData("release", [BigInt(taskId)]));
}

export async function refundOnChain(taskId: number): Promise<string> {
  const { contractAddress } = requireEnvEscrow();
  const escrowInterface = new Interface(ESCROW_WRITE_ABI);
  return sendUncheckedTransaction(contractAddress, escrowInterface.encodeFunctionData("refund", [BigInt(taskId)]));
}
