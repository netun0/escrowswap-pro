import { useState, useCallback, useEffect } from "react";
import { MOCK_TASKS, MOCK_PAYMENTS } from "@/contracts/mockData";
import { type Task, type MicroPayment, type TaskState, type VerifierMode } from "@/contracts/config";
import { ESCROW_USE_MOCK, HEDERA_API_URL } from "@/contracts/env";

export { ESCROW_USE_MOCK } from "@/contracts/env";

type ApiTask = Omit<Task, "amount"> & { amount: string };

function apiTaskToTask(raw: ApiTask): Task {
  return { ...raw, amount: BigInt(raw.amount) };
}

async function apiGetTasks(): Promise<Task[]> {
  const r = await fetch(`${HEDERA_API_URL}/tasks`);
  if (!r.ok) throw new Error(await r.text());
  const data = (await r.json()) as ApiTask[];
  return data.map(apiTaskToTask);
}

export function useWallet() {
  const [hederaAccountId, setHederaAccountId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("hederaClientId");
  });
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const input =
        typeof window !== "undefined"
          ? window.prompt(
              "Enter your Hedera account id (0.0.x). Used to enable role-gated actions against the API.",
              hederaAccountId ?? "0.0.1001",
            )
          : null;
      if (input && /^\d+\.\d+\.\d+$/.test(input.trim())) {
        const id = input.trim();
        setHederaAccountId(id);
        localStorage.setItem("hederaClientId", id);
      }
    } finally {
      setConnecting(false);
    }
  }, [hederaAccountId]);

  const disconnect = useCallback(() => {
    setHederaAccountId(null);
    localStorage.removeItem("hederaClientId");
  }, []);

  return { address: hederaAccountId, connecting, connect, disconnect };
}

export type AdvanceOptions = {
  outputURI?: string;
};

export function useEscrow() {
  const [tasks, setTasks] = useState<Task[]>(ESCROW_USE_MOCK ? MOCK_TASKS : []);
  const [loading, setLoading] = useState(false);
  const [txPending, setTxPending] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (ESCROW_USE_MOCK) {
      setTasks(MOCK_TASKS);
      return;
    }
    if (!HEDERA_API_URL) {
      setTasks([]);
      return;
    }
    setLoading(true);
    try {
      const list = await apiGetTasks();
      setTasks(list);
    } catch (e) {
      console.error("fetchTasks", e);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const createTask = useCallback(
    async (params: {
      specURI: string;
      description?: string;
      worker: string;
      verifier: string;
      verifierMode: VerifierMode;
      paymentToken: string;
      amount: string;
      workerPreferredToken: string;
      deadlineDays?: number;
      deadlineUnix?: number;
      clientId?: string;
    }) => {
      if (ESCROW_USE_MOCK) {
        const nowSec = Date.now() / 1000;
        const days = params.deadlineDays ?? 7;
        let deadlineSec: number;
        let expiresAtSec: number;
        if (params.deadlineUnix != null && Number.isFinite(params.deadlineUnix) && params.deadlineUnix > nowSec) {
          deadlineSec = Math.floor(params.deadlineUnix);
          expiresAtSec = deadlineSec + 86400 * 7;
        } else {
          deadlineSec = nowSec + 86400 * days;
          expiresAtSec = nowSec + 86400 * (days + 7);
        }
        const client = params.clientId ?? "0.0.1001";
        let newId = 0;
        setTasks((prev) => {
          newId = prev.length === 0 ? 0 : Math.max(...prev.map((t) => t.id)) + 1;
          const newTask: Task = {
            id: newId,
            client,
            worker: params.worker,
            verifier: params.verifier,
            verifierMode: params.verifierMode,
            specURI: params.specURI,
            outputURI: "",
            paymentToken: params.paymentToken,
            amount: BigInt(params.amount),
            workerPreferredToken: params.workerPreferredToken,
            state: "Open",
            createdAt: nowSec,
            fundedAt: 0,
            submittedAt: 0,
            verifiedAt: 0,
            completedAt: 0,
            description: params.description ?? params.specURI,
            deadline: deadlineSec,
            expiresAt: expiresAtSec,
            maxBudget: 10000,
            capabilities: [],
          };
          return [...prev, newTask];
        });
        return newId;
      }

      if (!HEDERA_API_URL) throw new Error("VITE_HEDERA_API_URL is not set");
      const clientId = params.clientId?.trim();
      if (!clientId || !/^\d+\.\d+\.\d+$/.test(clientId)) {
        throw new Error("Set your Hedera client id in the sidebar before creating a task.");
      }

      setTxPending(true);
      try {
        const body = {
          clientId,
          worker: params.worker,
          verifier: params.verifier,
          verifierMode: params.verifierMode,
          specURI: params.specURI || params.description || "",
          description: params.description ?? params.specURI,
          paymentToken: params.paymentToken,
          amount: params.amount,
          workerPreferredToken: params.workerPreferredToken,
          deadlineUnix: params.deadlineUnix,
        };
        const r = await fetch(`${HEDERA_API_URL}/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(await r.text());
        const created = apiTaskToTask((await r.json()) as ApiTask);
        await fetchTasks();
        return created.id;
      } finally {
        setTxPending(false);
      }
    },
    [fetchTasks],
  );

  const advanceState = useCallback(
    async (taskId: number, action: "fund" | "submit" | "verify" | "reject" | "dispute", opts?: AdvanceOptions) => {
      if (ESCROW_USE_MOCK) {
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            const stateMap: Record<string, TaskState> = {
              fund: "Funded",
              submit: "Submitted",
              verify: "PaidOut",
              reject: "Refunded",
              dispute: "Disputed",
            };
            const nextState = stateMap[action] || t.state;
            const now = Date.now() / 1000;
            const patch: Partial<Task> = { state: nextState };
            if (action === "fund") patch.fundedAt = now;
            if (action === "submit") {
              patch.submittedAt = now;
              patch.outputURI = opts?.outputURI ?? `ipfs://deliverable-${Date.now()}`;
            }
            if (action === "verify") {
              patch.verifiedAt = now;
              patch.completedAt = now;
            }
            if (action === "reject") patch.verifiedAt = now;
            return { ...t, ...patch };
          }),
        );
        return;
      }

      if (!HEDERA_API_URL) throw new Error("VITE_HEDERA_API_URL is not set");

      setTxPending(true);
      try {
        if (action === "fund") {
          const r = await fetch(`${HEDERA_API_URL}/tasks/${taskId}/fund`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          if (!r.ok) throw new Error(await r.text());
        } else if (action === "submit") {
          const r = await fetch(`${HEDERA_API_URL}/tasks/${taskId}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ outputURI: opts?.outputURI ?? `ipfs://deliverable-${Date.now()}` }),
          });
          if (!r.ok) throw new Error(await r.text());
        } else if (action === "reject") {
          const r = await fetch(`${HEDERA_API_URL}/tasks/${taskId}/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ approved: false }),
          });
          if (!r.ok) throw new Error(await r.text());
        } else if (action === "dispute") {
          const r = await fetch(`${HEDERA_API_URL}/tasks/${taskId}/dispute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          if (!r.ok) throw new Error(await r.text());
        } else if (action === "verify") {
          const r = await fetch(`${HEDERA_API_URL}/tasks/${taskId}/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ approved: true }),
          });
          if (!r.ok) throw new Error(await r.text());
        }
        await fetchTasks();
      } finally {
        setTxPending(false);
      }
    },
    [fetchTasks],
  );

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return { tasks, loading, txPending, createTask, advanceState, fetchTasks };
}

export function useX402() {
  const [payments, setPayments] = useState<MicroPayment[]>(ESCROW_USE_MOCK ? MOCK_PAYMENTS : []);

  const payForCall = useCallback(
    async (provider: string, token: string, amount: string, callHash: string) => {
      if (ESCROW_USE_MOCK) {
        const newPayment: MicroPayment = {
          id: payments.length,
          payer: "0.0.1001",
          provider,
          token,
          amount: BigInt(amount),
          callHash,
          timestamp: Date.now() / 1000,
          settled: false,
          purpose: "API call payment",
        };
        setPayments((prev) => [...prev, newPayment]);
        return newPayment.id;
      }
    },
    [payments.length],
  );

  return { payments, payForCall };
}
