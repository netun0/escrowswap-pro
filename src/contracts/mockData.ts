import { type Task, type MicroPayment, type AuditEvent, TOKENS } from "@/contracts/config";

const accounts = ["0.0.1001", "0.0.1002", "0.0.1003", "0.0.1004", "0.0.1005"];

const now = Date.now() / 1000;

export const MOCK_TASKS: Task[] = [
  {
    id: 0,
    client: accounts[0],
    worker: accounts[1],
    verifier: accounts[2],
    specURI: "ipfs://QmXyZ123...auditing-smart-contract",
    outputURI: "",
    paymentToken: TOKENS.USDC.address,
    amount: BigInt(5000e6),
    workerPreferredToken: TOKENS.HBAR.address,
    state: "Funded",
    createdAt: now - 86400 * 3,
    fundedAt: now - 86400 * 2,
    submittedAt: 0,
    verifiedAt: 0,
    completedAt: 0,
    description:
      "Audit the operator escrow service integration for idempotency, settlement errors, and HCS logging. Produce a short report with severity ratings.",
    deadline: now + 86400 * 4,
    expiresAt: now + 86400 * 7,
    maxBudget: 10000,
    capabilities: ["security", "hedera", "auditing"],
    verifierMode: "autonomous",
  },
  {
    id: 1,
    client: accounts[2],
    worker: accounts[3],
    verifier: accounts[4],
    specURI: "ipfs://QmAbC456...data-pipeline-cleaning",
    outputURI: "ipfs://QmOutput1...",
    paymentToken: TOKENS.HBAR.address,
    amount: BigInt(2e8),
    workerPreferredToken: TOKENS.HBAR.address,
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
    verifierMode: "human",
  },
  {
    id: 2,
    client: accounts[1],
    worker: accounts[0],
    verifier: accounts[4],
    specURI: "ipfs://QmDeF789...market-analysis-report",
    outputURI: "ipfs://QmOutput2...",
    paymentToken: TOKENS.USDC.address,
    amount: BigInt(12000e6),
    workerPreferredToken: TOKENS.USDC.address,
    state: "PaidOut",
    createdAt: now - 86400 * 10,
    fundedAt: now - 86400 * 9,
    submittedAt: now - 86400 * 7,
    verifiedAt: now - 86400 * 6,
    completedAt: now - 86400 * 6,
    description:
      "Summarize these 5 DeFi protocol whitepapers into a comparative risk report with yield projections and TVL analysis.",
    deadline: now - 86400 * 6,
    expiresAt: now - 86400 * 3,
    maxBudget: 15000,
    capabilities: ["research", "defi", "analysis"],
    verifierMode: "human",
  },
  {
    id: 3,
    client: accounts[3],
    worker: accounts[1],
    verifier: accounts[2],
    specURI: "ipfs://QmGhI012...ml-model-training",
    outputURI: "",
    paymentToken: TOKENS.HBAR.address,
    amount: BigInt(8e8),
    workerPreferredToken: TOKENS.HBAR.address,
    state: "Open",
    createdAt: now - 3600,
    fundedAt: 0,
    submittedAt: 0,
    verifiedAt: 0,
    completedAt: 0,
    description:
      "Train a sentiment classifier on 100k labeled tweets. Target F1 > 0.85. Deliver model weights and evaluation notebook.",
    deadline: now + 86400 * 10,
    expiresAt: now + 86400 * 14,
    maxBudget: 10000,
    capabilities: ["machine-learning", "NLP", "python"],
    verifierMode: "autonomous",
  },
  {
    id: 4,
    client: accounts[0],
    worker: accounts[4],
    verifier: accounts[3],
    specURI: "ipfs://QmJkL345...security-review",
    outputURI: "ipfs://QmOutput4...",
    paymentToken: TOKENS.USDC.address,
    amount: BigInt(500e6),
    workerPreferredToken: TOKENS.USDC.address,
    state: "Verified",
    createdAt: now - 86400 * 2,
    fundedAt: now - 86400 * 2,
    submittedAt: now - 86400,
    verifiedAt: now - 3600,
    completedAt: 0,
    description: "Run static analysis on the settlement service. Verify HTS paths and error handling. Deliver findings JSON.",
    deadline: now + 86400,
    expiresAt: now + 86400 * 3,
    maxBudget: 2000,
    capabilities: ["security", "typescript", "tooling"],
    verifierMode: "human",
  },
  {
    id: 5,
    client: accounts[4],
    worker: accounts[0],
    verifier: accounts[1],
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
    description: "Integrate a price API into the dashboard. Worker failed to meet acceptance criteria.",
    deadline: now - 86400 * 5,
    expiresAt: now - 86400 * 3,
    maxBudget: 5000,
    capabilities: ["api", "typescript", "frontend"],
    verifierMode: "human",
  },
  {
    id: 6,
    client: accounts[0],
    worker: accounts[1],
    verifier: accounts[3],
    specURI: "ipfs://QmAutoDemo...agent-verification",
    outputURI: "ipfs://QmDelivered...demo-output",
    paymentToken: TOKENS.USDC.address,
    amount: BigInt(750e6),
    workerPreferredToken: TOKENS.USDC.address,
    state: "Submitted",
    createdAt: now - 86400 * 2,
    fundedAt: now - 86400 * 2,
    submittedAt: now - 7200,
    verifiedAt: 0,
    completedAt: 0,
    description: "Demo job: autonomous verifier mode with work already submitted (use mock agent buttons to resolve).",
    deadline: now + 86400 * 5,
    expiresAt: now + 86400 * 10,
    maxBudget: 1000,
    capabilities: ["demo", "autonomous-verifier"],
    verifierMode: "autonomous",
  },
];

export const MOCK_PAYMENTS: MicroPayment[] = [
  {
    id: 0,
    payer: accounts[1],
    provider: accounts[2],
    token: TOKENS.USDC.address,
    amount: BigInt(50e6),
    callHash: "0.0.999@1234567890.000000001",
    timestamp: now - 3600,
    settled: true,
    purpose: "GPT-4 verification call for Task #0",
  },
  {
    id: 1,
    payer: accounts[3],
    provider: accounts[0],
    token: TOKENS.USDC.address,
    amount: BigInt(25e6),
    callHash: "0.0.999@1234567890.000000002",
    timestamp: now - 1800,
    settled: false,
    purpose: "Data API access for pipeline cleaning",
  },
  {
    id: 2,
    payer: accounts[0],
    provider: accounts[4],
    token: TOKENS.HBAR.address,
    amount: BigInt(10e8),
    callHash: "0.0.999@1234567890.000000003",
    timestamp: now - 600,
    settled: true,
    purpose: "Static analysis compute on Task #4",
  },
];

export const MOCK_AUDIT_EVENTS: AuditEvent[] = [
  { id: 0, taskId: 0, action: "Task Created", actor: accounts[0], timestamp: now - 86400 * 3, txHash: "0.0.888@…", network: "Hedera" },
  { id: 1, taskId: 0, action: "Task Funded", actor: accounts[0], timestamp: now - 86400 * 2, txHash: "0.0.888@…", network: "Hedera" },
  { id: 2, taskId: 0, action: "HCS: funded", actor: "HCS", timestamp: now - 86400 * 2, txHash: "0.0.12345@42", network: "Hedera" },
  { id: 3, taskId: 1, action: "Work Submitted", actor: accounts[3], timestamp: now - 86400, txHash: "0.0.888@…", network: "Hedera" },
  { id: 4, taskId: 1, action: "HCS: submitted", actor: "HCS", timestamp: now - 86400, txHash: "0.0.12345@43", network: "Hedera" },
  { id: 5, taskId: 2, action: "Payout Completed", actor: accounts[4], timestamp: now - 86400 * 6, txHash: "0.0.888@…", network: "Hedera" },
  { id: 6, taskId: 4, action: "Work Verified", actor: accounts[3], timestamp: now - 3600, txHash: "0.0.888@…", network: "Hedera" },
  { id: 7, taskId: 4, action: "HCS: verified", actor: "HCS", timestamp: now - 3600, txHash: "0.0.12345@44", network: "Hedera" },
];

export function getTokenSymbol(address: string): string {
  if (address.toUpperCase() === "HBAR") return "HBAR";
  for (const [symbol, token] of Object.entries(TOKENS)) {
    if (token.address.toLowerCase() === address.toLowerCase()) return symbol;
  }
  return address.length > 12 ? address.slice(0, 6) + "…" : address;
}

export function formatAmount(amount: bigint, tokenAddress: string): string {
  if (tokenAddress.toUpperCase() === "HBAR") {
    const value = Number(amount) / 1e8;
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  for (const token of Object.values(TOKENS)) {
    if (token.address.toLowerCase() === tokenAddress.toLowerCase()) {
      const value = Number(amount) / 10 ** token.decimals;
      return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
  }
  return amount.toString();
}

export function shortenAddress(addr: string): string {
  if (/^\d+\.\d+\.\d+$/.test(addr)) {
    const [a, b, c] = addr.split(".");
    return `${a}.${b}.${c.length > 4 ? c.slice(0, 2) + "…" + c.slice(-2) : c}`;
  }
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
