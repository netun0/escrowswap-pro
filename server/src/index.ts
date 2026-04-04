
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import cors from "cors";
import express from "express";
import { dirname, resolve } from "node:path";
import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TokenId,
  TransferTransaction,
} from "@hashgraph/sdk";
import Long from "long";
import { AgentMode, HederaBuilder, HederaLangchainToolkit } from "hedera-agent-kit";
import { Contract, JsonRpcProvider, getAddress } from "ethers";
import { HEDERA_TASK_ESCROW_ABI, EscrowOnChainStatus } from "./escrowAbi.js";

// The server process runs from `/server`, but the shared env file lives at the repo root.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env") });

/** Task shape aligned with the Vite app (`src/contracts/config`). Amount is smallest units (tinybars or token decimals). */
type StoredTask = {
  id: number;
  client: string;
  worker: string;
  verifier: string;
  verifierMode: "human" | "autonomous";
  specURI: string;
  outputURI: string;
  paymentToken: string;
  amount: string;
  workerPreferredToken: string;
  state:
    | "Open"
    | "Funded"
    | "Submitted"
    | "Verified"
    | "PaidOut"
    | "Refunded"
    | "Disputed"
    | "Expired"
    | "EscrowRefundPending";
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
  ledgerTx?: Partial<{
    created: string;
    funded: string;
    submitted: string;
    rejected: string;
    dispute: string;
    settlement: string;
    paidAudit: string;
    onChainFund: string;
    onChainRelease: string;
    onChainRefund: string;
  }>;
  /** Set when `ESCROW_CONTRACT_ADDRESS` is configured at task creation (ERC-20 only). */
  escrowContract?: boolean;
  clientEvm?: string;
  workerEvm?: string;
  verifierEvm?: string;
  tokenEvm?: string;
  /** Verifier must sign matching tx on Hedera EVM, then call POST /tasks/:id/onchain-sync. */
  escrowPendingAction?: "release" | "refund";
};

type LedgerSubmitResult = {
  ok: boolean;
  transactionId: string | null;
  topicSequenceNumber: string | null;
  reason?: "no_topic" | "dry_run_no_key" | "error";
  error?: string;
};

function mergeLedgerTx(task: StoredTask, key: keyof NonNullable<StoredTask["ledgerTx"]>, txId: string | null | undefined): void {
  if (!txId) return;
  if (!task.ledgerTx) task.ledgerTx = {};
  task.ledgerTx[key] = txId;
}

const PORT = Number(process.env.PORT || 3001);
const NETWORK = (process.env.HEDERA_NETWORK || "testnet").toLowerCase();
const TOPIC_ID = (process.env.HCS_TOPIC_ID || "").trim();
const OPERATOR_ID = (process.env.HEDERA_ACCOUNT_ID || "").trim();
const OPERATOR_KEY_RAW = (process.env.HEDERA_PRIVATE_KEY || "").trim();
const DRY_RUN = process.env.HEDERA_DRY_RUN === "true" || process.env.HEDERA_DRY_RUN === "1";
const ESCROW_CONTRACT_ADDRESS = (process.env.ESCROW_CONTRACT_ADDRESS || "").trim();
const HEDERA_EVM_RPC = (
  process.env.HEDERA_EVM_RPC ||
  (NETWORK === "mainnet" ? "https://mainnet.hashio.io/api" : "https://testnet.hashio.io/api")
).trim();
const MIRROR_BASE = (
  process.env.HEDERA_MIRROR_BASE ||
  (NETWORK === "mainnet" ? "https://mainnet-public.mirrornode.hedera.com" : "https://testnet.mirrornode.hedera.com")
).trim();

const escrowDeploymentConfigured = Boolean(ESCROW_CONTRACT_ADDRESS && ESCROW_CONTRACT_ADDRESS.startsWith("0x"));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Writable task snapshot (default: `server/data/tasks.json`). */
const STORE_PATH = process.env.TASK_STORE_PATH?.trim() || path.join(__dirname, "..", "data", "tasks.json");

const tasks = new Map<number, StoredTask>();
let nextId = 0;

function loadStore(): void {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const data = JSON.parse(raw) as { tasks?: StoredTask[]; nextId?: number };
    if (!Array.isArray(data.tasks)) return;
    tasks.clear();
    let maxId = -1;
    for (const t of data.tasks) {
      tasks.set(t.id, t);
      maxId = Math.max(maxId, t.id);
    }
    const storedNext = typeof data.nextId === "number" ? data.nextId : 0;
    nextId = Math.max(storedNext, maxId + 1);
    console.log(`Loaded ${tasks.size} task(s) from ${STORE_PATH}`);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") console.warn("task store load:", err.message);
  }
}

function persistStore(): void {
  try {
    const dir = path.dirname(STORE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      tasks: [...tasks.values()].sort((a, b) => a.id - b.id),
      nextId,
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(payload, null, 2), "utf8");
  } catch (e) {
    console.error("task store persist failed:", e);
  }
}

loadStore();

function hederaAccountRegex(id: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(id);
}

function normalizeToken(t: string): string {
  const s = t.trim();
  if (!s) return "HBAR";
  if (s.toUpperCase() === "HBAR") return "HBAR";
  return s;
}

function hexToChecksumAddr(hex: string): string {
  const h = hex.startsWith("0x") ? hex : `0x${hex}`;
  return getAddress(h);
}

async function mirrorAccountEvm(accountId: string): Promise<string | null> {
  try {
    const r = await fetch(`${MIRROR_BASE}/api/v1/accounts/${accountId}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { evm_address?: string | null };
    const raw = j.evm_address?.trim();
    if (!raw) return null;
    return getAddress(raw);
  } catch {
    return null;
  }
}

/** HTS ERC-20 `token()` address on Hedera EVM (long zero) when mirror omits `evm_address`. */
function htsTokenToEvmAddress(tokenId: string): string | null {
  try {
    const raw = TokenId.fromString(tokenId).toEvmAddress();
    return hexToChecksumAddr(raw);
  } catch {
    return null;
  }
}

async function mirrorTokenEvm(tokenId: string): Promise<string | null> {
  try {
    const r = await fetch(`${MIRROR_BASE}/api/v1/tokens/${tokenId}`);
    if (r.ok) {
      const j = (await r.json()) as { evm_address?: string | null };
      const raw = j.evm_address?.trim();
      if (raw) return getAddress(raw);
    }
  } catch {
    /* use HTS fallback */
  }
  return htsTokenToEvmAddress(tokenId);
}

function addrEq(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

function buildClient(): Client {
  const net = NETWORK as "testnet" | "mainnet" | "previewnet";
  if (!["testnet", "mainnet", "previewnet"].includes(net)) {
    throw new Error(`HEDERA_NETWORK must be testnet, mainnet, or previewnet (got ${NETWORK})`);
  }
  const client = Client.forName(net);
  if (!OPERATOR_ID || !OPERATOR_KEY_RAW) {
    if (!DRY_RUN) {
      throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are required unless HEDERA_DRY_RUN=true");
    }
    return client;
  }
  const key = PrivateKey.fromString(OPERATOR_KEY_RAW);
  client.setOperator(AccountId.fromString(OPERATOR_ID), key);
  return client;
}

let client: Client;
try {
  client = buildClient();
} catch (e) {
  console.warn("Hedera client init:", (e as Error).message);
  client = Client.forName("testnet");
}

const toolkit =
  OPERATOR_ID && OPERATOR_KEY_RAW
    ? new HederaLangchainToolkit({
        client,
        configuration: {
          context: { accountId: OPERATOR_ID, mode: AgentMode.AUTONOMOUS },
        },
      })
    : null;

if (toolkit) {
  console.log(`hedera-agent-kit: ${toolkit.getTools().length} core tools available (REST uses SDK directly).`);
}

if (!TOPIC_ID) {
  console.warn(
    "[ledger] HCS_TOPIC_ID is not set — create / fund / submit will not write TopicMessageSubmitTransaction. Set a topic id for visible audit txs on HashScan.",
  );
}
if (DRY_RUN) {
  console.warn("[ledger] HEDERA_DRY_RUN=true — transfers and HCS submits are skipped (no paid transactions).");
}
if (!OPERATOR_KEY_RAW || !OPERATOR_ID) {
  console.warn("[ledger] Operator key/account missing — Hedera transactions are disabled until .env is configured.");
}
if (escrowDeploymentConfigured) {
  console.log(`[escrow] HederaTaskEscrow at ${ESCROW_CONTRACT_ADDRESS} (EVM RPC ${HEDERA_EVM_RPC}). New tasks use on-chain ERC-20 escrow; POST /fund and operator payout on approve are disabled.`);
}

async function appendHcs(event: Record<string, unknown>): Promise<LedgerSubmitResult> {
  const label = String(event.type ?? "event");
  if (!TOPIC_ID) {
    console.warn(`[ledger] skip HCS (${label}): set HCS_TOPIC_ID`);
    return { ok: false, transactionId: null, topicSequenceNumber: null, reason: "no_topic" };
  }
  if (DRY_RUN || !OPERATOR_KEY_RAW) {
    console.warn(`[ledger] skip HCS (${label}): DRY_RUN or missing HEDERA_PRIVATE_KEY`);
    return { ok: false, transactionId: null, topicSequenceNumber: null, reason: "dry_run_no_key" };
  }
  try {
    const tx = HederaBuilder.submitTopicMessage({
      topicId: TOPIC_ID,
      message: JSON.stringify(event),
      transactionMemo: label.slice(0, 100),
    });
    const res = await tx.execute(client);
    const receipt = await res.getReceipt(client);
    const txId = res.transactionId.toString();
    const seq = receipt.topicSequenceNumber?.toString() ?? null;
    console.log(`[ledger] HCS ok ${label} | tx=${txId} | topicSeq=${seq ?? "?"}`);
    return { ok: true, transactionId: txId, topicSequenceNumber: seq };
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[ledger] HCS failed (${label}):`, msg);
    return { ok: false, transactionId: null, topicSequenceNumber: null, reason: "error", error: msg };
  }
}

async function settleHbar(task: StoredTask): Promise<string> {
  const worker = AccountId.fromString(task.worker);
  const operator = AccountId.fromString(OPERATOR_ID);
  const tiny = Long.fromString(task.amount);
  const tx = await new TransferTransaction()
    .addHbarTransfer(worker, Hbar.fromTinybars(tiny))
    .addHbarTransfer(operator, Hbar.fromTinybars(tiny.negate()))
    .execute(client);
  await tx.getReceipt(client);
  return tx.transactionId.toString();
}

async function settleHts(task: StoredTask): Promise<string> {
  const worker = AccountId.fromString(task.worker);
  const operator = AccountId.fromString(OPERATOR_ID);
  const tokenId = TokenId.fromString(task.paymentToken);
  const amt = Long.fromString(task.amount).negate();
  const pos = Long.fromString(task.amount);
  const tx = await new TransferTransaction()
    .addTokenTransfer(tokenId, operator, amt)
    .addTokenTransfer(tokenId, worker, pos)
    .execute(client);
  await tx.getReceipt(client);
  return tx.transactionId.toString();
}

async function settleToWorker(task: StoredTask): Promise<string> {
  if (DRY_RUN || !OPERATOR_KEY_RAW) {
    return `dry-run-${Date.now()}`;
  }
  const pay = normalizeToken(task.paymentToken);
  if (pay === "HBAR") {
    return settleHbar(task);
  }
  return settleHts(task);
}

function serializeTask(t: StoredTask): Record<string, unknown> {
  return { ...t };
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    network: NETWORK,
    operatorConfigured: Boolean(OPERATOR_ID && OPERATOR_KEY_RAW),
    hcsTopic: TOPIC_ID || null,
    dryRun: DRY_RUN,
    escrowContractAddress: escrowDeploymentConfigured ? ESCROW_CONTRACT_ADDRESS : null,
    hederaEvmRpc: HEDERA_EVM_RPC,
    ledgerHints: {
      hcsMessagesNeedTopic: !TOPIC_ID,
      transfersNeedKeysAndNotDryRun: DRY_RUN || !OPERATOR_KEY_RAW,
      settlementOnApprove: !(DRY_RUN || !OPERATOR_KEY_RAW || escrowDeploymentConfigured),
    },
  });
});

app.get("/tasks", (_req, res) => {
  res.json([...tasks.values()].sort((a, b) => a.id - b.id).map(serializeTask));
});

app.get("/tasks/:id", (req, res) => {
  const id = Number(req.params.id);
  const t = tasks.get(id);
  if (!t) return res.status(404).json({ error: "Task not found" });
  res.json(serializeTask(t));
});

app.post("/tasks", async (req, res) => {
  const {
    clientId,
    worker,
    verifier,
    verifierMode = "human",
    specURI = "",
    description = "",
    paymentToken,
    amount,
    workerPreferredToken,
    deadlineUnix,
    capabilities = [],
    maxBudget = 10000,
  } = req.body ?? {};

  if (!clientId || !worker || !verifier || !paymentToken || amount == null || !workerPreferredToken) {
    return res.status(400).json({ error: "clientId, worker, verifier, paymentToken, amount, workerPreferredToken required" });
  }
  for (const label of ["clientId", "worker", "verifier"] as const) {
    const v = label === "clientId" ? clientId : label === "worker" ? worker : verifier;
    if (!hederaAccountRegex(String(v))) {
      return res.status(400).json({ error: `${label} must be a Hedera account id (0.0.x)` });
    }
  }
  const payTok = normalizeToken(String(paymentToken));
  const prefTok = normalizeToken(String(workerPreferredToken));
  if (payTok !== "HBAR" && !hederaAccountRegex(payTok)) {
    return res.status(400).json({ error: "paymentToken must be HBAR or a token id 0.0.x" });
  }
  if (prefTok !== "HBAR" && !hederaAccountRegex(prefTok)) {
    return res.status(400).json({ error: "workerPreferredToken must be HBAR or a token id 0.0.x" });
  }
  if (escrowDeploymentConfigured) {
    if (payTok === "HBAR") {
      return res.status(400).json({
        error:
          "On-chain escrow requires an HTS token id (ERC-20 on Hedera EVM), not HBAR. Unset ESCROW_CONTRACT_ADDRESS for legacy operator custody with HBAR.",
      });
    }
    if (payTok !== prefTok) {
      return res.status(400).json({ error: "Escrow contract mode requires paymentToken and workerPreferredToken to match." });
    }
  }
  const amtStr = String(amount);
  if (!/^\d+$/.test(amtStr) || BigInt(amtStr) <= 0n) {
    return res.status(400).json({ error: "amount must be a positive integer string (tinybars or token smallest unit)" });
  }
  if (verifierMode !== "human" && verifierMode !== "autonomous") {
    return res.status(400).json({ error: "verifierMode must be human or autonomous" });
  }

  const now = Date.now() / 1000;
  let deadlineSec = now + 86400 * 7;
  let expiresAtSec = deadlineSec + 86400 * 7;
  if (deadlineUnix != null && Number.isFinite(Number(deadlineUnix)) && Number(deadlineUnix) > now) {
    deadlineSec = Math.floor(Number(deadlineUnix));
    expiresAtSec = deadlineSec + 86400 * 7;
  }

  let escrowContract = false;
  let clientEvm: string | undefined;
  let workerEvm: string | undefined;
  let verifierEvm: string | undefined;
  let tokenEvm: string | undefined;
  if (escrowDeploymentConfigured) {
    const [ce, we, ve, te] = await Promise.all([
      mirrorAccountEvm(String(clientId)),
      mirrorAccountEvm(String(worker)),
      mirrorAccountEvm(String(verifier)),
      mirrorTokenEvm(payTok),
    ]);
    if (!ce || !we || !ve || !te) {
      const missing: string[] = [];
      if (!ce) missing.push("client");
      if (!we) missing.push("worker");
      if (!ve) missing.push("verifier");
      if (!te) missing.push("token");
      return res.status(400).json({
        error:
          "Could not resolve Hedera EVM address for all task participants. Accounts need a mirror `evm_address` (ECDSA / alias wallet). Tokens use mirror `evm_address` or the HTS long-zero address.",
        missingEvmFor: missing,
        mirrorBase: MIRROR_BASE,
        hint:
          "Use real testnet accounts in MetaMask/HashPack (not placeholder 0.0.1001). Ensure `HEDERA_NETWORK` / `HEDERA_MIRROR_BASE` match your accounts. Token id must exist on that network (e.g. USDC 0.0.429274 on testnet).",
      });
    }
    escrowContract = true;
    clientEvm = ce;
    workerEvm = we;
    verifierEvm = ve;
    tokenEvm = te;
  }

  const id = nextId++;
  const task: StoredTask = {
    id,
    client: String(clientId),
    worker: String(worker),
    verifier: String(verifier),
    verifierMode,
    specURI: String(specURI),
    outputURI: "",
    paymentToken: payTok,
    amount: amtStr,
    workerPreferredToken: prefTok,
    state: "Open",
    createdAt: now,
    fundedAt: 0,
    submittedAt: 0,
    verifiedAt: 0,
    completedAt: 0,
    description: String(description) || String(specURI),
    deadline: deadlineSec,
    expiresAt: expiresAtSec,
    maxBudget: Number(maxBudget) || 10000,
    capabilities: Array.isArray(capabilities) ? capabilities.map(String) : [],
    ...(escrowContract && clientEvm && workerEvm && verifierEvm && tokenEvm
      ? { escrowContract: true, clientEvm, workerEvm, verifierEvm, tokenEvm }
      : {}),
  };
  tasks.set(id, task);
  persistStore();

  const hcs = await appendHcs({ type: "created", taskId: id, at: now, task: serializeTask(task) });
  if (hcs.ok && hcs.transactionId) {
    mergeLedgerTx(task, "created", hcs.transactionId);
    tasks.set(id, task);
    persistStore();
  }

  res.status(201).json(serializeTask(task));
});

app.post("/tasks/:id/fund", async (req, res) => {
  const id = Number(req.params.id);
  const t = tasks.get(id);
  if (!t) return res.status(404).json({ error: "Task not found" });
  if (t.escrowContract) {
    return res.status(409).json({
      error:
        "This task uses HederaTaskEscrow on-chain funding. Approve the token and call fundTask from the client EVM wallet, then POST /tasks/:id/onchain-sync.",
      escrow: { contract: ESCROW_CONTRACT_ADDRESS, taskId: id },
    });
  }
  if (t.state !== "Open") return res.status(400).json({ error: "Task not open" });

  const now = Date.now() / 1000;
  t.state = "Funded";
  t.fundedAt = now;
  tasks.set(id, t);
  persistStore();

  const hcs = await appendHcs({ type: "funded", taskId: id, at: now, note: (req.body as { note?: string })?.note });
  if (hcs.ok && hcs.transactionId) {
    mergeLedgerTx(t, "funded", hcs.transactionId);
    tasks.set(id, t);
    persistStore();
  }
  res.json({
    task: serializeTask(t),
    hcsSequence: hcs.topicSequenceNumber,
    transactionId: hcs.transactionId,
  });
});

app.post("/tasks/:id/submit", async (req, res) => {
  const id = Number(req.params.id);
  const t = tasks.get(id);
  if (!t) return res.status(404).json({ error: "Task not found" });
  if (t.state !== "Funded") return res.status(400).json({ error: "Task not funded" });

  const outputURI = String((req.body as { outputURI?: string })?.outputURI || `ipfs://deliverable-${Date.now()}`);
  const now = Date.now() / 1000;
  t.state = "Submitted";
  t.submittedAt = now;
  t.outputURI = outputURI;
  tasks.set(id, t);
  persistStore();

  const hcs = await appendHcs({ type: "submitted", taskId: id, at: now, outputURI });
  if (hcs.ok && hcs.transactionId) {
    mergeLedgerTx(t, "submitted", hcs.transactionId);
    tasks.set(id, t);
    persistStore();
  }
  res.json({ task: serializeTask(t), hcsSequence: hcs.topicSequenceNumber, transactionId: hcs.transactionId });
});

app.post("/tasks/:id/verify", async (req, res) => {
  const id = Number(req.params.id);
  const t = tasks.get(id);
  if (!t) return res.status(404).json({ error: "Task not found" });
  if (t.state !== "Submitted") return res.status(400).json({ error: "Task not awaiting verification" });

  const approved = Boolean((req.body as { approved?: boolean })?.approved);
  const now = Date.now() / 1000;

  if (!approved) {
    if (t.escrowContract) {
      t.state = "EscrowRefundPending";
      t.escrowPendingAction = "refund";
      t.verifiedAt = now;
      tasks.set(id, t);
      persistStore();
      const hcs = await appendHcs({ type: "escrow_reject_pending_refund", taskId: id, at: now });
      if (hcs.ok && hcs.transactionId) {
        mergeLedgerTx(t, "rejected", hcs.transactionId);
        tasks.set(id, t);
        persistStore();
      }
      return res.json({
        task: serializeTask(t),
        hcsSequence: hcs.topicSequenceNumber,
        transactionId: hcs.transactionId,
        escrowNext: "sign_refund_then_sync",
      });
    }
    t.state = "Refunded";
    t.verifiedAt = now;
    tasks.set(id, t);
    persistStore();
    const hcs = await appendHcs({ type: "rejected", taskId: id, at: now });
    if (hcs.ok && hcs.transactionId) {
      mergeLedgerTx(t, "rejected", hcs.transactionId);
      tasks.set(id, t);
      persistStore();
    }
    return res.json({ task: serializeTask(t), hcsSequence: hcs.topicSequenceNumber, transactionId: hcs.transactionId });
  }

  if (t.escrowContract) {
    t.state = "Verified";
    t.escrowPendingAction = "release";
    t.verifiedAt = now;
    tasks.set(id, t);
    persistStore();
    const hcs = await appendHcs({ type: "escrow_approve_pending_release", taskId: id, at: now });
    return res.json({
      task: serializeTask(t),
      hcsSequence: hcs.topicSequenceNumber,
      transactionId: hcs.transactionId,
      escrowNext: "sign_release_then_sync",
    });
  }

  try {
    const payTok = normalizeToken(t.paymentToken);
    const prefTok = normalizeToken(t.workerPreferredToken);
    if (payTok !== prefTok) {
      return res.status(400).json({
        error:
          "Cross-token settlement is not implemented. Use the same paymentToken and workerPreferredToken (e.g. both HBAR).",
      });
    }

    const txId = await settleToWorker(t);
    mergeLedgerTx(t, "settlement", txId);
    t.state = "PaidOut";
    t.verifiedAt = now;
    t.completedAt = now;
    tasks.set(id, t);
    persistStore();
    const hcs = await appendHcs({ type: "paid", taskId: id, at: now, settlementTxId: txId });
    if (hcs.ok && hcs.transactionId) {
      mergeLedgerTx(t, "paidAudit", hcs.transactionId);
      tasks.set(id, t);
      persistStore();
    }
    return res.json({
      task: serializeTask(t),
      settlementTxId: txId,
      hcsSequence: hcs.topicSequenceNumber,
      paidAuditTransactionId: hcs.transactionId,
    });
  } catch (e) {
    console.error("settlement failed", e);
    return res.status(500).json({ error: (e as Error).message || "Settlement failed" });
  }
});

app.post("/tasks/:id/dispute", async (req, res) => {
  const id = Number(req.params.id);
  const t = tasks.get(id);
  if (!t) return res.status(404).json({ error: "Task not found" });
  if (!["Funded", "Submitted"].includes(t.state)) {
    return res.status(400).json({ error: "Task cannot be disputed in this state" });
  }
  t.state = "Disputed";
  tasks.set(id, t);
  persistStore();
  const hcs = await appendHcs({ type: "dispute", taskId: id, at: Date.now() / 1000 });
  if (hcs.ok && hcs.transactionId) {
    mergeLedgerTx(t, "dispute", hcs.transactionId);
    tasks.set(id, t);
    persistStore();
  }
  res.json({ task: serializeTask(t), hcsSequence: hcs.topicSequenceNumber, transactionId: hcs.transactionId });
});

app.post("/tasks/:id/onchain-sync", async (req, res) => {
  const id = Number(req.params.id);
  const t = tasks.get(id);
  if (!t) return res.status(404).json({ error: "Task not found" });
  if (!t.escrowContract) return res.status(400).json({ error: "Task is not an on-chain escrow task" });
  if (!escrowDeploymentConfigured) {
    return res.status(503).json({ error: "Server ESCROW_CONTRACT_ADDRESS is not set" });
  }

  const optionalTx = String((req.body as { txHash?: string })?.txHash || "").trim() || undefined;

  try {
    const provider = new JsonRpcProvider(HEDERA_EVM_RPC);
    const c = new Contract(ESCROW_CONTRACT_ADDRESS, HEDERA_TASK_ESCROW_ABI, provider);
    const raw = await c.tasks(BigInt(id));
    const cClient = String(raw[0]);
    const cWorker = String(raw[1]);
    const cVerifier = String(raw[2]);
    const cToken = String(raw[3]);
    const cAmount = raw[4] as bigint;
    const cStatus = Number(raw[5]);

    if (!t.clientEvm || !t.workerEvm || !t.verifierEvm || !t.tokenEvm) {
      return res.status(500).json({ error: "Task missing EVM participant addresses" });
    }
    if (!addrEq(cClient, t.clientEvm)) return res.status(409).json({ error: "On-chain client does not match task" });
    if (!addrEq(cWorker, t.workerEvm)) return res.status(409).json({ error: "On-chain worker does not match task" });
    if (!addrEq(cVerifier, t.verifierEvm)) return res.status(409).json({ error: "On-chain verifier does not match task" });
    if (!addrEq(cToken, t.tokenEvm)) return res.status(409).json({ error: "On-chain token does not match task" });
    if (cAmount.toString() !== t.amount) return res.status(409).json({ error: "On-chain amount does not match task" });

    if (cStatus === EscrowOnChainStatus.None) {
      return res.json({ task: serializeTask(t), onChain: { status: "none" as const } });
    }

    if (cStatus === EscrowOnChainStatus.Funded) {
      if (t.state === "Open") {
        const fundNow = Date.now() / 1000;
        t.state = "Funded";
        t.fundedAt = fundNow;
        if (optionalTx) mergeLedgerTx(t, "onChainFund", optionalTx);
        tasks.set(id, t);
        persistStore();
        const hcs = await appendHcs({ type: "onchain_funded", taskId: id, at: fundNow });
        if (hcs.ok && hcs.transactionId) mergeLedgerTx(t, "funded", hcs.transactionId);
        tasks.set(id, t);
        persistStore();
      }
      return res.json({ task: serializeTask(t), onChain: { status: "funded" as const } });
    }

    if (cStatus === EscrowOnChainStatus.Released) {
      const done = Date.now() / 1000;
      if (t.state !== "PaidOut") {
        t.state = "PaidOut";
        t.completedAt = done;
        if (!t.verifiedAt) t.verifiedAt = done;
        delete t.escrowPendingAction;
        if (optionalTx) {
          mergeLedgerTx(t, "onChainRelease", optionalTx);
          mergeLedgerTx(t, "settlement", optionalTx);
        }
        tasks.set(id, t);
        persistStore();
        const hcs = await appendHcs({ type: "onchain_released", taskId: id, at: done });
        if (hcs.ok && hcs.transactionId) mergeLedgerTx(t, "paidAudit", hcs.transactionId);
        tasks.set(id, t);
        persistStore();
      }
      return res.json({ task: serializeTask(t), onChain: { status: "released" as const } });
    }

    if (cStatus === EscrowOnChainStatus.Refunded) {
      const done = Date.now() / 1000;
      if (t.state !== "Refunded") {
        t.state = "Refunded";
        if (!t.verifiedAt) t.verifiedAt = done;
        delete t.escrowPendingAction;
        if (optionalTx) mergeLedgerTx(t, "onChainRefund", optionalTx);
        tasks.set(id, t);
        persistStore();
        const hcs = await appendHcs({ type: "onchain_refunded", taskId: id, at: done });
        if (hcs.ok && hcs.transactionId) mergeLedgerTx(t, "rejected", hcs.transactionId);
        tasks.set(id, t);
        persistStore();
      }
      return res.json({ task: serializeTask(t), onChain: { status: "refunded" as const } });
    }

    return res.status(500).json({ error: "Unknown on-chain status" });
  } catch (e) {
    console.error("onchain-sync", e);
    return res.status(502).json({ error: (e as Error).message || "RPC or contract read failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Hedera escrow API listening on http://localhost:${PORT}`);
  console.log(`Task store: ${STORE_PATH}`);
});
