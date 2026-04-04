import { useState, useCallback, useEffect } from "react";
import { MOCK_TASKS, MOCK_PAYMENTS } from "@/contracts/mockData";
import type { Task, MicroPayment, TaskState, VerifierMode } from "@/contracts/config";
import { ESCROW_USE_MOCK, AGENT_ESCROW_ADDRESS, UNISWAPX_USE_MOCK_ORDER } from "@/contracts/env";
import {
  getBrowserProvider,
  ensureChain,
  getEscrowContract,
  fetchTasksFromChain,
  mapChainTaskToTask,
  approveTokenForEscrow,
} from "@/lib/agentEscrowChain";
import { encodeMockUniswapXOrder } from "@/lib/uniswapx/mockOrder";
import { getCreateTaskQuoteSupportNote, getEscrowSettlementSupportNote } from "@/lib/uniswapx/support";

export { ESCROW_USE_MOCK } from "@/contracts/env";

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      if (typeof window !== "undefined" && (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum) {
        const ethereum = (window as unknown as { ethereum: { request: (a: unknown) => Promise<string[]> } }).ethereum;
        const accounts = await ethereum.request({
          method: "eth_requestAccounts",
        });
        setAddress(accounts[0]);
      } else {
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

export type AdvanceOptions = {
  /** For on-chain cross-token verify with mock reactor: exact output amount (wei) paid to worker */
  uniswapXAmountOutWei?: bigint;
  /** Deliverable URI for submitWork on-chain */
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
    if (!AGENT_ESCROW_ADDRESS) {
      setTasks([]);
      return;
    }
    setLoading(true);
    try {
      const list = await fetchTasksFromChain();
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
    }) => {
      if (ESCROW_USE_MOCK) {
        const days = params.deadlineDays ?? 7;
        const nowSec = Date.now() / 1000;
        const newTask: Task = {
          id: tasks.length,
          client: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38",
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
          deadline: nowSec + 86400 * days,
          expiresAt: nowSec + 86400 * (days + 7),
          maxBudget: 10000,
          capabilities: [],
        };
        setTasks((prev) => [...prev, newTask]);
        return newTask.id;
      }

      const provider = getBrowserProvider();
      if (!provider) throw new Error("No wallet");
      await ensureChain(provider);
      const signer = await provider.getSigner();
      const escrow = getEscrowContract(signer);
      setTxPending(true);
      try {
        const before = await escrow.getTaskCount();
        const tx = await escrow.createTask(
          params.specURI || params.description || "",
          params.worker,
          params.verifier,
          params.paymentToken,
          params.amount,
          params.workerPreferredToken
        );
        await tx.wait();
        const after = await escrow.getTaskCount();
        if (after <= before) throw new Error("createTask did not increment task count");
        const taskId = Number(after) - 1;
        await fetchTasks();
        return taskId;
      } finally {
        setTxPending(false);
      }
    },
    [fetchTasks]
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
            return { ...t, state: stateMap[action] || t.state };
          })
        );
        return;
      }

      const provider = getBrowserProvider();
      if (!provider) throw new Error("No wallet");
      await ensureChain(provider);
      const signer = await provider.getSigner();
      const escrow = getEscrowContract(signer);
      const task = tasks.find((t) => t.id === taskId);
      if (!task) throw new Error("Task not found");

      setTxPending(true);
      try {
        if (action === "fund") {
          await approveTokenForEscrow(signer, task.paymentToken, task.amount);
          const tx = await escrow.fundTask(taskId);
          await tx.wait();
        } else if (action === "submit") {
          const uri = opts?.outputURI ?? `ipfs://deliverable-${Date.now()}`;
          const tx = await escrow.submitWork(taskId, uri);
          await tx.wait();
        } else if (action === "reject") {
          const tx = await escrow.verify(taskId, false);
          await tx.wait();
        } else if (action === "dispute") {
          const tx = await escrow.dispute(taskId);
          await tx.wait();
        } else if (action === "verify") {
          const same = task.paymentToken.toLowerCase() === task.workerPreferredToken.toLowerCase();
          if (same) {
            const tx = await escrow.verify(taskId, true);
            await tx.wait();
          } else {
            if (!UNISWAPX_USE_MOCK_ORDER) {
              throw new Error(getEscrowSettlementSupportNote());
            }
            const payoutAddr: string = await escrow.uniswapPayout();
            const amountOut = opts?.uniswapXAmountOutWei ?? 1n;
            const order = encodeMockUniswapXOrder({
              swapper: payoutAddr,
              tokenIn: task.paymentToken,
              amountIn: task.amount,
              tokenOut: task.workerPreferredToken,
              recipient: task.worker,
              amountOut,
            });
            const tx = await escrow.verifyWithUniswapXOrder(taskId, true, order, "0x");
            await tx.wait();
          }
        }
        await fetchTasks();
      } finally {
        setTxPending(false);
      }
    },
    [tasks, fetchTasks]
  );

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return { tasks, loading, txPending, createTask, advanceState, fetchTasks };
}

export interface CrossChainQuote {
  amountOut: string;
  priceImpact: string;
  fee: string;
  sourceChain: string;
  sourceToken: string;
  escrowToken: string;
  bridgeMethod: string;
  route: string;
  estimatedTime: string;
  status: "unsupported";
  note: string;
}

export function useUniswapQuote() {
  const getQuote = useCallback(
    async (
      tokenIn: string,
      tokenOut: string,
      amountIn: string,
      sourceChain?: string,
      bridgeMethod?: string,
    ): Promise<CrossChainQuote> => {
      const chain = sourceChain ?? "Arc Testnet";
      const bridge = bridgeMethod ?? "Direct";
      const isCrossChain = chain !== "Arc Testnet";

      return {
        amountOut: "—",
        priceImpact: "—",
        fee: "Unavailable",
        sourceChain: chain,
        sourceToken: tokenIn,
        escrowToken: tokenOut,
        bridgeMethod: bridge,
        route: isCrossChain
          ? `${tokenIn} on ${chain} -> bridge -> ${tokenOut} on Arc`
          : `${tokenIn} -> ${tokenOut} on Arc`,
        estimatedTime: "Unavailable",
        status: "unsupported",
        note: getCreateTaskQuoteSupportNote(chain, isCrossChain),
      };
    },
    []
  );

  return { getQuote };
}

export function useX402() {
  const [payments, setPayments] = useState<MicroPayment[]>(ESCROW_USE_MOCK ? MOCK_PAYMENTS : []);

  const payForCall = useCallback(
    async (provider: string, token: string, amount: string, callHash: string) => {
      if (ESCROW_USE_MOCK) {
        const newPayment: MicroPayment = {
          id: payments.length,
          payer: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38",
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
    [payments.length]
  );

  return { payments, payForCall };
}
