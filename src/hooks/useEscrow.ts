import { useState, useCallback, useEffect } from "react";
import { MOCK_TASKS, MOCK_PAYMENTS } from "@/contracts/mockData";
import type { Task, MicroPayment, TaskState } from "@/contracts/config";

// Mock mode: simulates contract interactions without a real blockchain
const USE_MOCK = true;

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        const accounts = await (window as any).ethereum.request({
          method: "eth_requestAccounts",
        });
        setAddress(accounts[0]);
      } else {
        // Mock wallet for development
        setAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38");
      }
    } catch (e) {
      console.error("Wallet connection failed:", e);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => setAddress(null), []);

  return { address, connecting, connect, disconnect };
}

export function useEscrow() {
  const [tasks, setTasks] = useState<Task[]>(USE_MOCK ? MOCK_TASKS : []);
  const [loading, setLoading] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (USE_MOCK) {
      setTasks(MOCK_TASKS);
      return;
    }
    setLoading(true);
    // TODO: fetch from contract
    setLoading(false);
  }, []);

  const createTask = useCallback(
    async (params: {
      specURI: string;
      worker: string;
      verifier: string;
      paymentToken: string;
      amount: string;
      workerPreferredToken: string;
    }) => {
      if (USE_MOCK) {
        const newTask: Task = {
          id: tasks.length,
          client: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38",
          worker: params.worker,
          verifier: params.verifier,
          specURI: params.specURI,
          outputURI: "",
          paymentToken: params.paymentToken,
          amount: BigInt(params.amount),
          workerPreferredToken: params.workerPreferredToken,
          state: "Open",
          createdAt: Date.now() / 1000,
          fundedAt: 0,
          submittedAt: 0,
          verifiedAt: 0,
          completedAt: 0,
        };
        setTasks((prev) => [...prev, newTask]);
        return newTask.id;
      }
      // TODO: call contract
    },
    [tasks.length]
  );

  const advanceState = useCallback(
    async (taskId: number, action: "fund" | "submit" | "verify" | "reject" | "dispute") => {
      if (USE_MOCK) {
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            const stateMap: Record<string, TaskState> = {
              fund: "Funded",
              submit: "Submitted",
              verify: "Verified",
              reject: "Refunded",
              dispute: "Disputed",
            };
            return { ...t, state: stateMap[action] || t.state };
          })
        );
      }
    },
    []
  );

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return { tasks, loading, createTask, advanceState, fetchTasks };
}

export function useUniswapQuote() {
  const getQuote = useCallback(
    async (tokenIn: string, tokenOut: string, amountIn: string) => {
      // Mock quote: simple 1:1 ratio with slight variance
      const inAmount = parseFloat(amountIn);
      const rate = 0.98 + Math.random() * 0.04; // 0.98-1.02
      return {
        amountOut: (inAmount * rate).toFixed(6),
        priceImpact: (Math.random() * 0.5).toFixed(2),
        route: `${tokenIn.slice(0, 6)}→${tokenOut.slice(0, 6)}`,
        fee: "0.3%",
      };
    },
    []
  );

  return { getQuote };
}

export function useX402() {
  const [payments, setPayments] = useState<MicroPayment[]>(USE_MOCK ? MOCK_PAYMENTS : []);

  const payForCall = useCallback(
    async (provider: string, token: string, amount: string, callHash: string) => {
      if (USE_MOCK) {
        const newPayment: MicroPayment = {
          id: payments.length,
          payer: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38",
          provider,
          token,
          amount: BigInt(amount),
          callHash,
          timestamp: Date.now() / 1000,
          settled: false,
        };
        setPayments((prev) => [...prev, newPayment]);
        return newPayment.id;
      }
    },
    [payments.length]
  );

  return { payments, payForCall };
}
