// Arc Testnet — USDC-native L2 by Circle
export const CHAIN_CONFIG = {
  chainId: 5042002,
  chainName: "Arc Testnet",
  rpcUrl: "https://rpc.testnet.arc.network",
  blockExplorer: "https://testnet.arcscan.app",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
} as const;

// Contract addresses (set VITE_AGENT_ESCROW_ADDRESS after `npm run deploy:arc`)
export const CONTRACT_ADDRESSES = {
  agentEscrow: import.meta.env.VITE_AGENT_ESCROW_ADDRESS ?? "0x0000000000000000000000000000000000000000",
  uniswapPayout: import.meta.env.VITE_UNISWAP_PAYOUT_ADDRESS ?? "0x0000000000000000000000000000000000000000",
  x402Relay: import.meta.env.VITE_X402_RELAY_ADDRESS ?? "0x0000000000000000000000000000000000000000",
  // Canonical Permit2 on Arc Testnet
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;

// Tokens on Arc Testnet
export const TOKENS: Record<string, { address: string; symbol: string; name: string; decimals: number; logoColor: string }> = {
  USDC: {
    address: "0x3600000000000000000000000000000000000000",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoColor: "#2775CA",
  },
  EURC: {
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    symbol: "EURC",
    name: "Euro Coin",
    decimals: 6,
    logoColor: "#1A73E8",
  },
} as const;

// Cross-chain source tokens (informational only — represent what an agent holds on origin chains)
export const SOURCE_TOKENS: Record<string, {
  symbol: string;
  name: string;
  chain: string;
  chainId: number;
  decimals: number;
  logoColor: string;
  bridgeMethod: string;
}> = {
  ETH: {
    symbol: "ETH",
    name: "Ether",
    chain: "Ethereum",
    chainId: 1,
    decimals: 18,
    logoColor: "#627EEA",
    bridgeMethod: "UniswapX + CCTP",
  },
  WETH: {
    symbol: "WETH",
    name: "Wrapped Ether",
    chain: "Ethereum",
    chainId: 1,
    decimals: 18,
    logoColor: "#EC4899",
    bridgeMethod: "UniswapX + CCTP",
  },
  "USDC-ETH": {
    symbol: "USDC",
    name: "USD Coin (Ethereum)",
    chain: "Ethereum",
    chainId: 1,
    decimals: 6,
    logoColor: "#2775CA",
    bridgeMethod: "CCTP",
  },
  "ARB-ETH": {
    symbol: "ETH",
    name: "Ether (Arbitrum)",
    chain: "Arbitrum",
    chainId: 42161,
    decimals: 18,
    logoColor: "#28A0F0",
    bridgeMethod: "UniswapX + CCTP",
  },
  "USDC-ARB": {
    symbol: "USDC",
    name: "USD Coin (Arbitrum)",
    chain: "Arbitrum",
    chainId: 42161,
    decimals: 6,
    logoColor: "#2775CA",
    bridgeMethod: "CCTP",
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

/** Who may call verify on-chain: human wallet, or an autonomous agent-controlled verifier wallet. */
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
  /** Optional at creation: human approves in a wallet, or an AI agent uses the verifier address. */
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
  // User story additions
  description: string;       // Natural language task description
  deadline: number;           // Unix timestamp — work must be submitted by this time
  expiresAt: number;          // Unix timestamp — funds reclaimable after this if no submission
  maxBudget: number;          // Max budget cap in token units (safety limit)
  capabilities: string[];     // Tags for worker capability matching
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
  purpose: string;            // Human-readable reason for micropayment
}

export interface AuditEvent {
  id: number;
  taskId: number;
  action: string;
  actor: string;
  timestamp: number;
  txHash: string;
  network: "Arc" | "Hedera";
}
