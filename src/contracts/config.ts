// Hedera Testnet — operator escrow + HCS audit (see `server/`)

const usdcTokenId =
  (import.meta.env.VITE_HEDERA_USDC_TOKEN_ID as string | undefined)?.trim() || "0.0.456858";

export const CHAIN_CONFIG = {
  chainId: 296,
  chainName: "Hedera Testnet",
  mirrorBase: "https://hashscan.io/testnet",
  blockExplorer: "https://hashscan.io/testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 8 },
} as const;

/** Demo HTS / HBAR — `address` is either `HBAR` or a token id `0.0.x` (matches prior Task shape). */
export const TOKENS: Record<string, { address: string; symbol: string; name: string; decimals: number; logoColor: string }> = {
  HBAR: {
    address: "HBAR",
    symbol: "HBAR",
    name: "Hbar",
    decimals: 8,
    logoColor: "#3ECF8E",
  },
  USDC: {
    address: usdcTokenId,
    symbol: "USDC",
    name: "USD Coin (HTS demo)",
    decimals: 6,
    logoColor: "#2775CA",
  },
} as const;

export const TASK_STATES = [
  "Open",
  "Funded",
  "Submitted",
  "Verified",
  "PaidOut",
  "Refunded",
  "Disputed",
  "Expired",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export type VerifierMode = "human" | "autonomous";

export const VERIFIER_MODE_LABELS: Record<VerifierMode, { title: string; short: string }> = {
  human: {
    title: "Human-in-the-loop",
    short: "Human verifier",
  },
  autonomous: {
    title: "Autonomous verifier wallet",
    short: "Autonomous agent",
  },
};

export interface Task {
  id: number;
  client: string;
  worker: string;
  verifier: string;
  verifierMode: VerifierMode;
  specURI: string;
  outputURI: string;
  paymentToken: string;
  amount: bigint;
  workerPreferredToken: string;
  state: TaskState;
  createdAt: number;
  fundedAt: number;
  submittedAt: number;
  verifiedAt: number;
  completedAt: number;
  description: string;
  deadline: number;
  expiresAt: number;
  maxBudget: number;
  capabilities: string[];
}

export interface MicroPayment {
  id: number;
  payer: string;
  provider: string;
  token: string;
  amount: bigint;
  callHash: string;
  timestamp: number;
  settled: boolean;
  purpose: string;
}

export interface AuditEvent {
  id: number;
  taskId: number;
  action: string;
  actor: string;
  timestamp: number;
  txHash: string;
  network: "Hedera";
}
