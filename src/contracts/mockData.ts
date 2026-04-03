import { TASK_STATES, type Task, type TaskState, type MicroPayment, TOKENS } from "@/contracts/config";

// Generate mock tasks for development
const addresses = [
  "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38",
  "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199",
  "0xdD2FD4581271e230360230F9337D5c0430Bf44C0",
  "0xbDA5747bFD65F08deb54cb465eB87D40e51B197E",
  "0x2546BcD3c84621e976D8185a91A922aE77ECEc30",
];

const specURIs = [
  "ipfs://QmXyZ123...auditing-smart-contract",
  "ipfs://QmAbC456...data-pipeline-cleaning",
  "ipfs://QmDeF789...market-analysis-report",
  "ipfs://QmGhI012...ml-model-training",
  "ipfs://QmJkL345...security-review",
  "ipfs://QmMnO678...api-integration",
];

export const MOCK_TASKS: Task[] = [
  {
    id: 0,
    client: addresses[0],
    worker: addresses[1],
    verifier: addresses[2],
    specURI: specURIs[0],
    outputURI: "",
    paymentToken: TOKENS.USDC.address,
    amount: BigInt(5000e6),
    workerPreferredToken: TOKENS.WETH.address,
    state: "Funded",
    createdAt: Date.now() / 1000 - 86400 * 3,
    fundedAt: Date.now() / 1000 - 86400 * 2,
    submittedAt: 0,
    verifiedAt: 0,
    completedAt: 0,
  },
  {
    id: 1,
    client: addresses[2],
    worker: addresses[3],
    verifier: addresses[4],
    specURI: specURIs[1],
    outputURI: "ipfs://QmOutput1...",
    paymentToken: TOKENS.WETH.address,
    amount: BigInt("2000000000000000000"),
    workerPreferredToken: TOKENS.USDC.address,
    state: "Submitted",
    createdAt: Date.now() / 1000 - 86400 * 5,
    fundedAt: Date.now() / 1000 - 86400 * 4,
    submittedAt: Date.now() / 1000 - 86400,
    verifiedAt: 0,
    completedAt: 0,
  },
  {
    id: 2,
    client: addresses[1],
    worker: addresses[0],
    verifier: addresses[4],
    specURI: specURIs[2],
    outputURI: "ipfs://QmOutput2...",
    paymentToken: TOKENS.USDC.address,
    amount: BigInt(12000e6),
    workerPreferredToken: TOKENS.DAI.address,
    state: "PaidOut",
    createdAt: Date.now() / 1000 - 86400 * 10,
    fundedAt: Date.now() / 1000 - 86400 * 9,
    submittedAt: Date.now() / 1000 - 86400 * 7,
    verifiedAt: Date.now() / 1000 - 86400 * 6,
    completedAt: Date.now() / 1000 - 86400 * 6,
  },
  {
    id: 3,
    client: addresses[3],
    worker: addresses[1],
    verifier: addresses[2],
    specURI: specURIs[3],
    outputURI: "",
    paymentToken: TOKENS.DAI.address,
    amount: BigInt("8000000000000000000000"),
    workerPreferredToken: TOKENS.LINK.address,
    state: "Open",
    createdAt: Date.now() / 1000 - 3600,
    fundedAt: 0,
    submittedAt: 0,
    verifiedAt: 0,
    completedAt: 0,
  },
  {
    id: 4,
    client: addresses[0],
    worker: addresses[4],
    verifier: addresses[3],
    specURI: specURIs[4],
    outputURI: "ipfs://QmOutput4...",
    paymentToken: TOKENS.WETH.address,
    amount: BigInt("500000000000000000"),
    workerPreferredToken: TOKENS.WETH.address,
    state: "Verified",
    createdAt: Date.now() / 1000 - 86400 * 2,
    fundedAt: Date.now() / 1000 - 86400 * 2,
    submittedAt: Date.now() / 1000 - 86400,
    verifiedAt: Date.now() / 1000 - 3600,
    completedAt: 0,
  },
  {
    id: 5,
    client: addresses[4],
    worker: addresses[0],
    verifier: addresses[1],
    specURI: specURIs[5],
    outputURI: "",
    paymentToken: TOKENS.USDC.address,
    amount: BigInt(3000e6),
    workerPreferredToken: TOKENS.USDC.address,
    state: "Refunded",
    createdAt: Date.now() / 1000 - 86400 * 8,
    fundedAt: Date.now() / 1000 - 86400 * 7,
    submittedAt: Date.now() / 1000 - 86400 * 5,
    verifiedAt: 0,
    completedAt: Date.now() / 1000 - 86400 * 4,
  },
];

export const MOCK_PAYMENTS: MicroPayment[] = [
  {
    id: 0,
    payer: addresses[1],
    provider: addresses[2],
    token: TOKENS.USDC.address,
    amount: BigInt(50e6),
    callHash: "0xabc123def456...",
    timestamp: Date.now() / 1000 - 3600,
    settled: true,
  },
  {
    id: 1,
    payer: addresses[3],
    provider: addresses[0],
    token: TOKENS.USDC.address,
    amount: BigInt(25e6),
    callHash: "0x789ghi012jkl...",
    timestamp: Date.now() / 1000 - 1800,
    settled: false,
  },
  {
    id: 2,
    payer: addresses[0],
    provider: addresses[4],
    token: TOKENS.DAI.address,
    amount: BigInt("100000000000000000000"),
    callHash: "0xmno345pqr678...",
    timestamp: Date.now() / 1000 - 600,
    settled: true,
  },
];

export function getTokenSymbol(address: string): string {
  for (const [symbol, token] of Object.entries(TOKENS)) {
    if (token.address.toLowerCase() === address.toLowerCase()) return symbol;
  }
  return address.slice(0, 6) + "...";
}

export function formatAmount(amount: bigint, tokenAddress: string): string {
  for (const token of Object.values(TOKENS)) {
    if (token.address.toLowerCase() === tokenAddress.toLowerCase()) {
      const value = Number(amount) / 10 ** token.decimals;
      return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
  }
  return amount.toString();
}

export function shortenAddress(addr: string): string {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}
