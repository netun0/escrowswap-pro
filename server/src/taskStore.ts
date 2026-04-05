import fs from "node:fs";
import path from "node:path";

import { TASK_STORE_PATH } from "./config.js";

export type TaskVerifierMode = "human" | "autonomous";
export type TaskState =
  | "Open"
  | "Funded"
  | "Submitted"
  | "Verified"
  | "PaidOut"
  | "Refunded"
  | "EscrowRefundPending"
  | "Disputed"
  | "Expired";

export type TaskLedgerTx = Partial<{
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

export type StoredTask = {
  id: number;
  client: string;
  worker: string;
  verifier: string;
  verifierMode: TaskVerifierMode;
  specURI: string;
  outputURI: string;
  paymentToken: string;
  amount: string;
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
  ledgerTx?: TaskLedgerTx;
  escrowContract?: boolean;
  clientEvm?: string;
  workerEvm?: string;
  verifierEvm?: string;
  tokenEvm?: string;
  escrowPendingAction?: "release" | "refund";
};

type TaskStoreSnapshot = {
  tasks: StoredTask[];
  nextId: number;
};

const tasks = new Map<number, StoredTask>();
let nextId = 0;

function loadStore(): void {
  try {
    const raw = fs.readFileSync(TASK_STORE_PATH, "utf8");
    const data = JSON.parse(raw) as Partial<TaskStoreSnapshot>;
    if (!Array.isArray(data.tasks)) return;
    tasks.clear();

    let maxId = -1;
    for (const task of data.tasks) {
      tasks.set(task.id, task);
      maxId = Math.max(maxId, task.id);
    }

    const storedNext = typeof data.nextId === "number" ? data.nextId : 0;
    nextId = Math.max(storedNext, maxId + 1);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      console.warn("task store load failed:", err.message);
    }
  }
}

function persistStore(): void {
  const dir = path.dirname(TASK_STORE_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const payload: TaskStoreSnapshot = {
    tasks: [...tasks.values()].sort((a, b) => a.id - b.id),
    nextId,
  };
  fs.writeFileSync(TASK_STORE_PATH, JSON.stringify(payload, null, 2), "utf8");
}

loadStore();

export function listTasks(): StoredTask[] {
  return [...tasks.values()].sort((a, b) => a.id - b.id);
}

export function getTask(id: number): StoredTask | undefined {
  return tasks.get(id);
}

export function createTask(input: Omit<StoredTask, "id">): StoredTask {
  const task: StoredTask = { ...input, id: nextId++ };
  tasks.set(task.id, task);
  persistStore();
  return task;
}

export function saveTask(task: StoredTask): StoredTask {
  tasks.set(task.id, task);
  persistStore();
  return task;
}

export function taskStoreInfo(): { path: string; count: number } {
  return { path: TASK_STORE_PATH, count: tasks.size };
}

export function mergeLedgerTx(
  task: StoredTask,
  key: keyof NonNullable<StoredTask["ledgerTx"]>,
  txId: string | null | undefined,
): void {
  if (!txId) return;
  if (!task.ledgerTx) task.ledgerTx = {};
  task.ledgerTx[key] = txId;
}
