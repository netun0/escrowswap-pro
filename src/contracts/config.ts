// Sepolia testnet configuration
export const CHAIN_CONFIG = {
  chainId: 11155111,
  chainName: "Sepolia",
  rpcUrl: "https://rpc.sepolia.org",
  blockExplorer: "https://sepolia.etherscan.io",
  nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
} as const;

// Contract addresses (update after deployment)
export const CONTRACT_ADDRESSES = {
  agentEscrow: "0x0000000000000000000000000000000000000000",
  uniswapPayout: "0x0000000000000000000000000000000000000000",
  x402Relay: "0x0000000000000000000000000000000000000000",
  // Uniswap V3 SwapRouter on Sepolia
  uniswapRouter: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
} as const;

// Test tokens on Sepolia
export const TOKENS: Record<string, { address: string; symbol: string; name: string; decimals: number; logoColor: string }> = {
  WETH: {
    address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    logoColor: "#627EEA",
  },
  USDC: {
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoColor: "#2775CA",
  },
  DAI: {
    address: "0x68194a729C2450ad26072b3D33ADaCbcef39D574",
    symbol: "DAI",
    name: "Dai Stablecoin",
    decimals: 18,
    logoColor: "#F5AC37",
  },
  LINK: {
    address: "0x779877A7B0D9E8603169DdbD7836e478b4624789",
    symbol: "LINK",
    name: "Chainlink",
    decimals: 18,
    logoColor: "#2A5ADA",
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
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export interface Task {
  id: number;
  client: string;
  worker: string;
  verifier: string;
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
}
