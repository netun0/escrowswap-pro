
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
    | "Expired";
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
  }>;
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
    ledgerHints: {
      hcsMessagesNeedTopic: !TOPIC_ID,
      transfersNeedKeysAndNotDryRun: DRY_RUN || !OPERATOR_KEY_RAW,
      settlementOnApprove: !(DRY_RUN || !OPERATOR_KEY_RAW),
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

app.listen(PORT, () => {
  console.log(`Hedera escrow API listening on http://localhost:${PORT}`);
  console.log(`Task store: ${STORE_PATH}`);
});
