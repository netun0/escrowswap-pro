import type { Task, TaskLedgerTx, TaskState } from "@/contracts/config";
import { shortenAddress, timeAgo } from "@/contracts/mockData";

const TERMINAL: TaskState[] = ["PaidOut", "Refunded", "Expired", "Disputed"];

function taskActive(t: Task): boolean {
  return !TERMINAL.includes(t.state);
}

function truncateDesc(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

/** Latest milestone message per Hedera account across all tasks. */
export function buildAgentActivityRows(tasks: Task[]) {
  const latest = new Map<
    string,
    { role: string; action: string; ts: number }
  >();

  const consider = (addr: string, role: string, action: string, ts: number) => {
    if (ts <= 0) return;
    const prev = latest.get(addr);
    if (!prev || ts > prev.ts) latest.set(addr, { role, action, ts });
  };

  for (const t of tasks) {
    consider(
      t.client,
      "Client",
      `Task #${t.id}: created — ${truncateDesc(t.description, 48)}`,
      t.createdAt,
    );
    if (t.fundedAt > 0) consider(t.client, "Client", `Task #${t.id}: marked funded`, t.fundedAt);
    if (t.submittedAt > 0) consider(t.worker, "Worker", `Task #${t.id}: submitted work`, t.submittedAt);
    if (t.verifiedAt > 0) {
      const verb =
        t.state === "PaidOut" ? "approved payout" : t.state === "Refunded" ? "rejected" : `verification (${t.state})`;
      consider(t.verifier, "Verifier", `Task #${t.id}: ${verb}`, t.verifiedAt);
    }
    if (t.completedAt > 0 && t.state === "PaidOut") {
      consider(t.worker, "Worker", `Task #${t.id}: payout completed`, t.completedAt);
    }
  }

  const rows = [...latest.entries()]
    .map(([account, v]) => {
      const active = tasks.some(
        (t) => taskActive(t) && (t.client === account || t.worker === account || t.verifier === account),
      );
      return {
        account,
        agentShort: shortenAddress(account),
        role: v.role,
        lastAction: v.action,
        time: timeAgo(v.ts),
        ts: v.ts,
        status: active ? ("active" as const) : ("idle" as const),
      };
    })
    .sort((a, b) => b.ts - a.ts);

  return rows;
}

const LEDGER_ACTION: Record<keyof TaskLedgerTx, string> = {
  created: "HCS: task created",
  funded: "HCS: funded",
  submitted: "HCS: work submitted",
  rejected: "HCS: rejected",
  dispute: "HCS: dispute",
  settlement: "Transfer: payout to worker",
  paidAudit: "HCS: paid (audit)",
};

/** Flatten `ledgerTx` from tasks for the audit table. */
export function buildLedgerAuditRows(tasks: Task[]) {
  const rows: {
    id: string;
    taskId: number;
    action: string;
    txId: string;
  }[] = [];

  for (const t of tasks) {
    if (!t.ledgerTx) continue;
    (Object.keys(t.ledgerTx) as (keyof TaskLedgerTx)[]).forEach((key) => {
      const txId = t.ledgerTx?.[key];
      if (!txId) return;
      rows.push({
        id: `${t.id}-${String(key)}`,
        taskId: t.id,
        action: LEDGER_ACTION[key] ?? String(key),
        txId,
      });
    });
  }

  rows.sort((a, b) => b.taskId - a.taskId || a.txId.localeCompare(b.txId));
  return rows;
}
