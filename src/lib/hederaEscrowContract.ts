import { BrowserProvider, Contract, type Eip1193Provider } from "ethers";
import type { Task } from "@/contracts/config";

const ESCROW_WRITE_ABI = [
  "function fundTask(uint256 taskId, address worker_, address verifier_, address token_, uint256 amount_) external",
  "function release(uint256 taskId) external",
  "function refund(uint256 taskId) external",
] as const;

const ERC20_ABI = ["function approve(address spender, uint256 amount) external returns (bool)"] as const;

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

export async function ensureHederaEvmChain(ethereum: Eip1193Provider): Promise<void> {
  const { rpcUrl } = requireEnvEscrow();
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

export async function approveTokenForEscrow(task: Task): Promise<import("ethers").TransactionResponse> {
  const { contractAddress } = requireEnvEscrow();
  if (!task.tokenEvm) throw new Error("Task missing tokenEvm");
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
