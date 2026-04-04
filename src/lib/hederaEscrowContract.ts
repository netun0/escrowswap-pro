import { BrowserProvider, Contract, getAddress, type Eip1193Provider } from "ethers";
import type { Task } from "@/contracts/config";

const ESCROW_WRITE_ABI = [
  "function fundTask(uint256 taskId, address worker_, address verifier_, address token_, uint256 amount_) external",
  "function release(uint256 taskId) external",
  "function refund(uint256 taskId) external",
] as const;

const ERC20_ABI = ["function approve(address spender, uint256 amount) external returns (bool)"] as const;

/** HTS-native ERC-20 facade: must be called once per account before approve/transfer. */
const HTS_TOKEN_ASSOCIATE_ABI = ["function associate() external"] as const;

function requireEnvEscrow(): { contractAddress: string; rpcUrl: string } {
  const contractAddress = (import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS as string | undefined)?.trim() ?? "";
  const rpcUrl = (import.meta.env.VITE_HEDERA_EVM_RPC as string | undefined)?.trim() ?? "https://testnet.hashio.io/api";
  if (!contractAddress.startsWith("0x")) {
    throw new Error("Set VITE_ESCROW_CONTRACT_ADDRESS (0x…) in .env for on-chain escrow.");
  }
  return { contractAddress, rpcUrl };
}

/** Hedera Testnet EVM chain id */
const HEDERA_TESTNET_CHAIN_HEX = "0x128";

function defaultHederaTestnetRpc(): string {
  return (import.meta.env.VITE_HEDERA_EVM_RPC as string | undefined)?.trim() ?? "https://testnet.hashio.io/api";
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

export function getBrowserProvider(): BrowserProvider {
  const ethereum = getInjectedEip1193();
  if (!ethereum) {
    throw new Error("No injected wallet (window.ethereum). Use a browser wallet that supports Hedera EVM.");
  }
  return new BrowserProvider(ethereum);
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
  const bal: bigint = await token.balanceOf(me);
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
    const tx = await token.associate();
    await tx.wait();
  } catch (e: unknown) {
    if (isUserRejected(e)) throw e;
    console.warn(
      "HTS associate() did not complete (often already associated). If approve still fails, associate the token in your wallet.",
      e,
    );
  }
}

export async function approveTokenForEscrow(task: Task): Promise<import("ethers").TransactionResponse> {
  const { contractAddress } = requireEnvEscrow();
  if (!task.tokenEvm) throw new Error("Task missing tokenEvm");
  await assertFundingWalletIsClient(task);
  await associateHtsToken(task.tokenEvm);
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const token = new Contract(task.tokenEvm, ERC20_ABI, signer);
  return token.approve(contractAddress, task.amount) as Promise<import("ethers").TransactionResponse>;
}

export async function fundTaskOnChain(task: Task): Promise<import("ethers").TransactionResponse> {
  const { contractAddress } = requireEnvEscrow();
  if (!task.workerEvm || !task.verifierEvm || !task.tokenEvm) {
    throw new Error("Task missing EVM addresses for fundTask");
  }
  await assertFundingWalletIsClient(task);
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const escrow = new Contract(contractAddress, ESCROW_WRITE_ABI, signer);
  return escrow.fundTask(BigInt(task.id), task.workerEvm, task.verifierEvm, task.tokenEvm, task.amount) as Promise<
    import("ethers").TransactionResponse
  >;
}

export async function releaseOnChain(taskId: number): Promise<import("ethers").TransactionResponse> {
  const { contractAddress } = requireEnvEscrow();
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const escrow = new Contract(contractAddress, ESCROW_WRITE_ABI, signer);
  return escrow.release(BigInt(taskId)) as Promise<import("ethers").TransactionResponse>;
}

export async function refundOnChain(taskId: number): Promise<import("ethers").TransactionResponse> {
  const { contractAddress } = requireEnvEscrow();
  const provider = getBrowserProvider();
  const signer = await provider.getSigner();
  const escrow = new Contract(contractAddress, ESCROW_WRITE_ABI, signer);
  return escrow.refund(BigInt(taskId)) as Promise<import("ethers").TransactionResponse>;
}
