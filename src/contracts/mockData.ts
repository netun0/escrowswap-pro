import { type Task, type TaskState, type MicroPayment, type AuditEvent, TOKENS } from "@/contracts/config";

const addresses = [
  "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38",
  "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199",
  "0xdD2FD4581271e230360230F9337D5c0430Bf44C0",
  "0xbDA5747bFD65F08deb54cb465eB87D40e51B197E",
  "0x2546BcD3c84621e976D8185a91A922aE77ECEc30",
];

const now = Date.now() / 1000;

export const MOCK_TASKS: Task[] = [
  {
    id: 0,
    client: addresses[0],
    worker: addresses[1],
    verifier: addresses[2],
    specURI: "ipfs://QmXyZ123...auditing-smart-contract",
    outputURI: "",
    paymentToken: TOKENS.USDC.address,
    amount: BigInt(5000e6),
    workerPreferredToken: TOKENS.WETH.address,
    state: "Funded",
    createdAt: now - 86400 * 3,
    fundedAt: now - 86400 * 2,
    submittedAt: 0,
    verifiedAt: 0,
    completedAt: 0,
    description: "Audit the AgentEscrow smart contract for reentrancy, overflow, and access control vulnerabilities. Produce a PDF report with severity ratings.",
    deadline: now + 86400 * 4,
    expiresAt: now + 86400 * 7,
    maxBudget: 10000,
    capabilities: ["security", "solidity", "auditing"],
  },
  {
    id: 1,
    client: addresses[2],
    worker: addresses[3],
    verifier: addresses[4],
    specURI: "ipfs://QmAbC456...data-pipeline-cleaning",
    outputURI: "ipfs://QmOutput1...",
    paymentToken: TOKENS.WETH.address,
    amount: BigInt("2000000000000000000"),
    workerPreferredToken: TOKENS.USDC.address,
    state: "Submitted",
    createdAt: now - 86400 * 5,
    fundedAt: now - 86400 * 4,
    submittedAt: now - 86400,
    verifiedAt: 0,
    completedAt: 0,
    description: "Clean and normalize 50k rows of transaction data. Remove duplicates, fix date formats, and output as Parquet.",
    deadline: now + 86400 * 2,
    expiresAt: now + 86400 * 5,
    maxBudget: 5000,
    capabilities: ["data-engineering", "ETL", "python"],
  },
  {
    id: 2,
    client: addresses[1],
    worker: addresses[0],
    verifier: addresses[4],
    specURI: "ipfs://QmDeF789...market-analysis-report",
    outputURI: "ipfs://QmOutput2...",
    paymentToken: TOKENS.USDC.address,
    amount: BigInt(12000e6),
    workerPreferredToken: TOKENS.DAI.address,
    state: "PaidOut",
    createdAt: now - 86400 * 10,
    fundedAt: now - 86400 * 9,
    submittedAt: now - 86400 * 7,
    verifiedAt: now - 86400 * 6,
    completedAt: now - 86400 * 6,
    description: "Summarize these 5 DeFi protocol whitepapers into a comparative risk report with yield projections and TVL analysis.",
    deadline: now - 86400 * 6,
    expiresAt: now - 86400 * 3,
    maxBudget: 15000,
    capabilities: ["research", "defi", "analysis"],
  },
  {
    id: 3,
    client: addresses[3],
    worker: addresses[1],
    verifier: addresses[2],
    specURI: "ipfs://QmGhI012...ml-model-training",
    outputURI: "",
    paymentToken: TOKENS.DAI.address,
    amount: BigInt("8000000000000000000000"),
    workerPreferredToken: TOKENS.LINK.address,
    state: "Open",
    createdAt: now - 3600,
    fundedAt: 0,
    submittedAt: 0,
    verifiedAt: 0,
    completedAt: 0,
    description: "Train a sentiment classifier on 100k labeled tweets. Target F1 > 0.85. Deliver model weights and evaluation notebook.",
    deadline: now + 86400 * 10,
    expiresAt: now + 86400 * 14,
    maxBudget: 10000,
    capabilities: ["machine-learning", "NLP", "python"],
  },
  {
    id: 4,
    client: addresses[0],
    worker: addresses[4],
    verifier: addresses[3],
    specURI: "ipfs://QmJkL345...security-review",
    outputURI: "ipfs://QmOutput4...",
    paymentToken: TOKENS.WETH.address,
    amount: BigInt("500000000000000000"),
    workerPreferredToken: TOKENS.WETH.address,
    state: "Verified",
    createdAt: now - 86400 * 2,
    fundedAt: now - 86400 * 2,
    submittedAt: now - 86400,
    verifiedAt: now - 3600,
    completedAt: 0,
    description: "Run Slither + Mythril on the UniswapPayout contract. Verify all external calls are guarded. Deliver findings JSON.",
    deadline: now + 86400,
    expiresAt: now + 86400 * 3,
    maxBudget: 2000,
    capabilities: ["security", "solidity", "tooling"],
  },
  {
    id: 5,
    client: addresses[4],
    worker: addresses[0],
    verifier: addresses[1],
    specURI: "ipfs://QmMnO678...api-integration",
    outputURI: "",
    paymentToken: TOKENS.USDC.address,
    amount: BigInt(3000e6),
    workerPreferredToken: TOKENS.USDC.address,
    state: "Refunded",
    createdAt: now - 86400 * 8,
    fundedAt: now - 86400 * 7,
    submittedAt: now - 86400 * 5,
    verifiedAt: 0,
    completedAt: now - 86400 * 4,
    description: "Integrate CoinGecko API for real-time price feeds into the dashboard. Worker failed to meet acceptance criteria.",
    deadline: now - 86400 * 5,
    expiresAt: now - 86400 * 3,
    maxBudget: 5000,
    capabilities: ["api", "typescript", "frontend"],
  },
];

export const MOCK_PAYMENTS: MicroPayment[] = [
  {
    id: 0,
    payer: addresses[1],
    provider: addresses[2],
    token: TOKENS.USDC.address,
    amount: BigInt(50e6),
    callHash: "0xabc123def456789012345678901234567890abcd",
    timestamp: now - 3600,
    settled: true,
    purpose: "GPT-4 verification call for Task #0",
  },
  {
    id: 1,
    payer: addresses[3],
    provider: addresses[0],
    token: TOKENS.USDC.address,
    amount: BigInt(25e6),
    callHash: "0x789ghi012jkl345678901234567890123456abcd",
    timestamp: now - 1800,
    settled: false,
    purpose: "Data API access for pipeline cleaning",
  },
  {
    id: 2,
    payer: addresses[0],
    provider: addresses[4],
    token: TOKENS.DAI.address,
    amount: BigInt("100000000000000000000"),
    callHash: "0xmno345pqr678901234567890123456789012abcd",
    timestamp: now - 600,
    settled: true,
    purpose: "Slither analysis compute on Task #4",
  },
];

export const MOCK_AUDIT_EVENTS: AuditEvent[] = [
  { id: 0, taskId: 0, action: "Task Created", actor: addresses[0], timestamp: now - 86400 * 3, txHash: "0xaaa111...", network: "Sepolia" },
  { id: 1, taskId: 0, action: "Task Funded", actor: addresses[0], timestamp: now - 86400 * 2, txHash: "0xaaa222...", network: "Sepolia" },
  { id: 2, taskId: 0, action: "Funding logged", actor: "HCS", timestamp: now - 86400 * 2, txHash: "0.0.12345@1234567890", network: "Hedera" },
  { id: 3, taskId: 1, action: "Work Submitted", actor: addresses[3], timestamp: now - 86400, txHash: "0xbbb111...", network: "Sepolia" },
  { id: 4, taskId: 1, action: "Submission logged", actor: "HCS", timestamp: now - 86400, txHash: "0.0.12345@1234567891", network: "Hedera" },
  { id: 5, taskId: 2, action: "Payout Completed", actor: addresses[4], timestamp: now - 86400 * 6, txHash: "0xccc111...", network: "Sepolia" },
  { id: 6, taskId: 4, action: "Work Verified", actor: addresses[3], timestamp: now - 3600, txHash: "0xddd111...", network: "Sepolia" },
  { id: 7, taskId: 4, action: "Verification logged", actor: "HCS", timestamp: now - 3600, txHash: "0.0.12345@1234567892", network: "Hedera" },
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

export function timeAgo(ts: number): string {
  if (ts <= 0) return "—";
  const diff = Date.now() / 1000 - ts;
  if (diff < 0) return "in " + formatDuration(-diff);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function timeUntil(ts: number): { label: string; urgent: boolean } {
  if (ts <= 0) return { label: "No deadline", urgent: false };
  const diff = ts - Date.now() / 1000;
  if (diff < 0) return { label: "Expired", urgent: true };
  if (diff < 86400) return { label: `${Math.floor(diff / 3600)}h left`, urgent: true };
  if (diff < 86400 * 3) return { label: `${Math.floor(diff / 86400)}d left`, urgent: true };
  return { label: `${Math.floor(diff / 86400)}d left`, urgent: false };
}
