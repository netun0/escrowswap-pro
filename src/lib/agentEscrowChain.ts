import { Contract, BrowserProvider, JsonRpcProvider, type Eip1193Provider } from "ethers";
import { CHAIN_CONFIG, type Task, type TaskState } from "@/contracts/config";
import { AGENT_ESCROW_ABI, ERC20_MIN_ABI } from "@/contracts/agentEscrowAbi";
import { AGENT_ESCROW_ADDRESS } from "@/contracts/env";

const TASK_STATE_MAP: TaskState[] = [
  "Open",
  "Funded",
  "Submitted",
  "Verified",
  "PaidOut",
  "Refunded",
  "Disputed",
];

export function getBrowserProvider(): BrowserProvider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (!eth) return null;
  return new BrowserProvider(eth);
}

export async function ensureChain(provider: BrowserProvider): Promise<void> {
  const hex = "0x" + CHAIN_CONFIG.chainId.toString(16);
  try {
    await provider.send("wallet_switchEthereumChain", [{ chainId: hex }]);
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err?.code === 4902) {
      await provider.send("wallet_addEthereumChain", [
        {
          chainId: hex,
          chainName: CHAIN_CONFIG.chainName,
          nativeCurrency: CHAIN_CONFIG.nativeCurrency,
          rpcUrls: [CHAIN_CONFIG.rpcUrl],
          blockExplorerUrls: [CHAIN_CONFIG.blockExplorer],
        },
      ]);
      return;
    }
    throw e;
  }
}

export function getEscrowContract(
  signerOrProvider: BrowserProvider | JsonRpcProvider | Awaited<ReturnType<BrowserProvider["getSigner"]>>
) {
  if (!AGENT_ESCROW_ADDRESS) throw new Error("VITE_AGENT_ESCROW_ADDRESS is not set");
  return new Contract(AGENT_ESCROW_ADDRESS, AGENT_ESCROW_ABI, signerOrProvider);
}

/** Wallet if available; otherwise public RPC (read-only). */
export function getReadProvider(): BrowserProvider | JsonRpcProvider {
  if (typeof window !== "undefined" && (window as unknown as { ethereum?: Eip1193Provider }).ethereum) {
    return new BrowserProvider((window as unknown as { ethereum: Eip1193Provider }).ethereum);
  }
  return new JsonRpcProvider(CHAIN_CONFIG.rpcUrl);
}

export function mapChainTaskToTask(
  raw: {
    id: bigint;
    client: string;
    worker: string;
    verifier: string;
    specURI: string;
    outputURI: string;
    paymentToken: string;
    amount: bigint;
    workerPreferredToken: string;
    state: number;
    createdAt: bigint;
    fundedAt: bigint;
    submittedAt: bigint;
    verifiedAt: bigint;
    completedAt: bigint;
  },
  extras?: Partial<Pick<Task, "description" | "verifierMode" | "deadline" | "expiresAt" | "maxBudget" | "capabilities">>
): Task {
  const state = TASK_STATE_MAP[raw.state] ?? "Open";
  const now = Date.now() / 1000;
  return {
    id: Number(raw.id),
    client: raw.client,
    worker: raw.worker,
    verifier: raw.verifier,
    verifierMode: extras?.verifierMode ?? "human",
    specURI: raw.specURI,
    outputURI: raw.outputURI,
    paymentToken: raw.paymentToken,
    amount: raw.amount,
    workerPreferredToken: raw.workerPreferredToken,
    state,
    createdAt: Number(raw.createdAt),
    fundedAt: Number(raw.fundedAt),
    submittedAt: Number(raw.submittedAt),
    verifiedAt: Number(raw.verifiedAt),
    completedAt: Number(raw.completedAt),
    description: extras?.description ?? raw.specURI,
    deadline: extras?.deadline ?? now + 86400 * 7,
    expiresAt: extras?.expiresAt ?? now + 86400 * 14,
    maxBudget: extras?.maxBudget ?? 0,
    capabilities: extras?.capabilities ?? [],
  };
}

export async function fetchTasksFromChain(): Promise<Task[]> {
  if (!AGENT_ESCROW_ADDRESS) return [];
  const provider = getReadProvider();
  const escrow = getEscrowContract(provider);
  const n = await escrow.getTaskCount();
  const count = Number(n);
  const out: Task[] = [];
  for (let i = 0; i < count; i++) {
    const t = await escrow.getTask(i);
    out.push(mapChainTaskToTask(t));
  }
  return out;
}

export async function approveTokenForEscrow(
  signer: Awaited<ReturnType<BrowserProvider["getSigner"]>>,
  token: string,
  amount: bigint
): Promise<void> {
  if (!AGENT_ESCROW_ADDRESS) throw new Error("VITE_AGENT_ESCROW_ADDRESS is not set");
  const erc20 = new Contract(token, ERC20_MIN_ABI, signer);
  const cur = await erc20.allowance(await signer.getAddress(), AGENT_ESCROW_ADDRESS);
  if (cur >= amount) return;
  const tx = await erc20.approve(AGENT_ESCROW_ADDRESS, amount);
  await tx.wait();
}
