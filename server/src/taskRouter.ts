import express from "express";
import Long from "long";
import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TokenId,
  TopicMessageSubmitTransaction,
  TransferTransaction,
} from "@hashgraph/sdk";
import { Contract, JsonRpcProvider, getAddress } from "ethers";

import type { AuthenticatedUser } from "../../packages/shared/src/auth.js";
import {
  ESCROW_CONTRACT_ADDRESS,
  HCS_TOPIC_ID,
  HEDERA_ACCOUNT_ID,
  HEDERA_DRY_RUN,
  HEDERA_EVM_RPC,
  HEDERA_PRIVATE_KEY,
  MIRROR_BASE,
  NETWORK,
} from "./config.js";
import { EscrowOnChainStatus, HEDERA_TASK_ESCROW_ABI } from "./escrowAbi.js";
import { createTask, getTask, listTasks, mergeLedgerTx, saveTask, type StoredTask } from "./taskStore.js";

type StoredSession = {
  user: AuthenticatedUser;
};

type CreateTaskRouterOptions = {
  mirrorAccountEvm: (accountId: string) => Promise<string | null>;
  requireAuthSession: (req: express.Request, res: express.Response) => StoredSession | null;
};

type HcsResult = {
  ok: boolean;
  transactionId: string | null;
  topicSequenceNumber: string | null;
};

const escrowProvider = new JsonRpcProvider(HEDERA_EVM_RPC);
const escrowDeploymentConfigured = ESCROW_CONTRACT_ADDRESS.startsWith("0x");

function normalizeToken(value: string): string {
  const token = value.trim();
  if (!token) return "HBAR";
  return token.toUpperCase() === "HBAR" ? "HBAR" : token;
}

function isHederaAccountId(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value.trim());
}

function sameAccount(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

function addrEq(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

function serializeTask(task: StoredTask): Record<string, unknown> {
  return { ...task };
}

function buildHederaClient(): Client {
  const network = NETWORK === "mainnet" ? "mainnet" : NETWORK === "previewnet" ? "previewnet" : "testnet";
  const client = Client.forName(network);
  if (HEDERA_ACCOUNT_ID && HEDERA_PRIVATE_KEY) {
    client.setOperator(AccountId.fromString(HEDERA_ACCOUNT_ID), PrivateKey.fromString(HEDERA_PRIVATE_KEY));
  }
  return client;
}

const hederaClient = buildHederaClient();

async function mirrorTokenEvm(tokenId: string): Promise<string | null> {
  try {
    const response = await fetch(`${MIRROR_BASE}/api/v1/tokens/${tokenId}`);
    if (!response.ok) return null;
    const payload = (await response.json()) as { evm_address?: string | null };
    return payload.evm_address ? getAddress(payload.evm_address) : null;
  } catch {
    return null;
  }
}

async function appendTaskHcs(event: Record<string, unknown>): Promise<HcsResult> {
  if (!HCS_TOPIC_ID || HEDERA_DRY_RUN || !HEDERA_ACCOUNT_ID || !HEDERA_PRIVATE_KEY) {
    return { ok: false, transactionId: null, topicSequenceNumber: null };
  }

  const tx = await new TopicMessageSubmitTransaction({
    topicId: HCS_TOPIC_ID,
    message: JSON.stringify(event),
  }).execute(hederaClient);
  const receipt = await tx.getReceipt(hederaClient);
  return {
    ok: true,
    transactionId: tx.transactionId.toString(),
    topicSequenceNumber: receipt.topicSequenceNumber?.toString() ?? null,
  };
}

async function settleHbarTo(task: StoredTask, recipientId: string): Promise<string> {
  if (HEDERA_DRY_RUN) return `dry-run-${Date.now()}`;
  if (!HEDERA_ACCOUNT_ID || !HEDERA_PRIVATE_KEY) {
    throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are required for legacy HBAR settlement.");
  }

  const amount = Long.fromString(task.amount);
  const tx = await new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(recipientId), Hbar.fromTinybars(amount))
    .addHbarTransfer(AccountId.fromString(HEDERA_ACCOUNT_ID), Hbar.fromTinybars(amount.negate()))
    .execute(hederaClient);

  await tx.getReceipt(hederaClient);
  return tx.transactionId.toString();
}

async function settleHtsTo(task: StoredTask, recipientId: string): Promise<string> {
  if (HEDERA_DRY_RUN) return `dry-run-${Date.now()}`;
  if (!HEDERA_ACCOUNT_ID || !HEDERA_PRIVATE_KEY) {
    throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are required for legacy HTS settlement.");
  }

  const amount = Long.fromString(task.amount);
  const tx = await new TransferTransaction()
    .addTokenTransfer(TokenId.fromString(task.paymentToken), AccountId.fromString(HEDERA_ACCOUNT_ID), amount.negate())
    .addTokenTransfer(TokenId.fromString(task.paymentToken), AccountId.fromString(recipientId), amount)
    .execute(hederaClient);

  await tx.getReceipt(hederaClient);
  return tx.transactionId.toString();
}

async function settleToRecipient(task: StoredTask, recipientId: string): Promise<string> {
  return normalizeToken(task.paymentToken) === "HBAR" ? settleHbarTo(task, recipientId) : settleHtsTo(task, recipientId);
}

export function createTaskRouter({ mirrorAccountEvm, requireAuthSession }: CreateTaskRouterOptions): express.Router {
  const router = express.Router();

  router.get("/tasks", (_req, res) => {
    res.json(listTasks().map(serializeTask));
  });

  router.get("/tasks/:id", (req, res) => {
    const taskId = Number(req.params.id);
    const task = getTask(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(serializeTask(task));
  });

  router.post("/tasks", async (req, res) => {
    const session = requireAuthSession(req, res);
    if (!session) return;

    const worker = String(req.body?.worker ?? "").trim();
    const verifier = String(req.body?.verifier ?? "").trim();
    const verifierMode = req.body?.verifierMode === "autonomous" ? "autonomous" : "human";
    const specURI = String(req.body?.specURI ?? "").trim();
    const description = String(req.body?.description ?? specURI).trim();
    const paymentToken = normalizeToken(String(req.body?.paymentToken ?? ""));
    const workerPreferredToken = normalizeToken(String(req.body?.workerPreferredToken ?? ""));
    const amount = String(req.body?.amount ?? "").trim();
    const deadlineUnix = Number(req.body?.deadlineUnix ?? 0);
    const capabilities = Array.isArray(req.body?.capabilities) ? req.body.capabilities.map(String) : [];
    const maxBudget = Number(req.body?.maxBudget ?? 10_000);

    if (!isHederaAccountId(worker) || !isHederaAccountId(verifier)) {
      return res.status(400).json({ error: "worker and verifier must be Hedera account ids (0.0.x)." });
    }
    if (paymentToken !== "HBAR" && !isHederaAccountId(paymentToken)) {
      return res.status(400).json({ error: "paymentToken must be HBAR or an HTS token id (0.0.x)." });
    }
    if (workerPreferredToken !== "HBAR" && !isHederaAccountId(workerPreferredToken)) {
      return res.status(400).json({ error: "workerPreferredToken must be HBAR or an HTS token id (0.0.x)." });
    }
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      return res.status(400).json({ error: "amount must be a positive integer string in smallest units." });
    }

    let escrowContract = false;
    let workerEvm: string | undefined;
    let verifierEvm: string | undefined;
    let tokenEvm: string | undefined;

    if (escrowDeploymentConfigured) {
      if (paymentToken === "HBAR") {
        return res.status(400).json({ error: "On-chain escrow requires an HTS token id, not HBAR." });
      }
      if (paymentToken !== workerPreferredToken) {
        return res.status(400).json({ error: "On-chain escrow requires paymentToken and workerPreferredToken to match." });
      }

      const [resolvedWorkerEvm, resolvedVerifierEvm, resolvedTokenEvm] = await Promise.all([
        mirrorAccountEvm(worker),
        mirrorAccountEvm(verifier),
        mirrorTokenEvm(paymentToken),
      ]);

      if (!resolvedWorkerEvm || !resolvedVerifierEvm || !resolvedTokenEvm) {
        return res.status(400).json({
          error: "Could not resolve EVM addresses for worker, verifier, or token from the Hedera mirror.",
        });
      }

      escrowContract = true;
      workerEvm = resolvedWorkerEvm;
      verifierEvm = resolvedVerifierEvm;
      tokenEvm = resolvedTokenEvm;
    }

    const now = Date.now() / 1000;
    const deadline = Number.isFinite(deadlineUnix) && deadlineUnix > now ? Math.floor(deadlineUnix) : Math.floor(now + 86400 * 7);
    const expiresAt = deadline + 86400 * 7;

    const task = createTask({
      client: session.user.accountId,
      worker,
      verifier,
      verifierMode,
      specURI,
      outputURI: "",
      paymentToken,
      amount,
      workerPreferredToken,
      state: "Open",
      createdAt: now,
      fundedAt: 0,
      submittedAt: 0,
      verifiedAt: 0,
      completedAt: 0,
      description,
      deadline,
      expiresAt,
      maxBudget: Number.isFinite(maxBudget) ? maxBudget : 10_000,
      capabilities,
      ...(escrowContract
        ? {
            escrowContract: true,
            clientEvm: session.user.evmAddress,
            workerEvm,
            verifierEvm,
            tokenEvm,
          }
        : {}),
    });

    const hcs = await appendTaskHcs({ type: "created", taskId: task.id, at: now, task: serializeTask(task) });
    if (hcs.transactionId) {
      mergeLedgerTx(task, "created", hcs.transactionId);
      saveTask(task);
    }

    res.status(201).json(serializeTask(task));
  });

  router.post("/tasks/:id/fund", async (req, res) => {
    const session = requireAuthSession(req, res);
    if (!session) return;

    const taskId = Number(req.params.id);
    const task = getTask(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (!sameAccount(task.client, session.user.accountId)) {
      return res.status(403).json({ error: "Only the client can mark this task as funded." });
    }
    if (task.escrowContract) {
      return res.status(409).json({
        error: "This task uses HederaTaskEscrow on-chain funding. Fund from the client wallet, then sync the contract state.",
        escrow: { contract: ESCROW_CONTRACT_ADDRESS, taskId },
      });
    }
    if (task.state !== "Open") return res.status(400).json({ error: "Task is not open." });

    const now = Date.now() / 1000;
    task.state = "Funded";
    task.fundedAt = now;
    saveTask(task);

    const hcs = await appendTaskHcs({ type: "funded", taskId, at: now, note: String(req.body?.note ?? "") || undefined });
    if (hcs.transactionId) {
      mergeLedgerTx(task, "funded", hcs.transactionId);
      saveTask(task);
    }

    res.json({ task: serializeTask(task), hcsSequence: hcs.topicSequenceNumber, transactionId: hcs.transactionId });
  });

  router.post("/tasks/:id/submit", async (req, res) => {
    const session = requireAuthSession(req, res);
    if (!session) return;

    const taskId = Number(req.params.id);
    const task = getTask(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (!sameAccount(task.worker, session.user.accountId)) {
      return res.status(403).json({ error: "Only the worker can submit deliverables for this task." });
    }
    if (task.state !== "Funded") return res.status(400).json({ error: "Task is not funded." });

    const outputURI = String(req.body?.outputURI ?? `ipfs://deliverable-${Date.now()}`);
    const now = Date.now() / 1000;
    task.state = "Submitted";
    task.submittedAt = now;
    task.outputURI = outputURI;
    saveTask(task);

    const hcs = await appendTaskHcs({ type: "submitted", taskId, at: now, outputURI });
    if (hcs.transactionId) {
      mergeLedgerTx(task, "submitted", hcs.transactionId);
      saveTask(task);
    }

    res.json({ task: serializeTask(task), hcsSequence: hcs.topicSequenceNumber, transactionId: hcs.transactionId });
  });

  router.post("/tasks/:id/verify", async (req, res) => {
    const session = requireAuthSession(req, res);
    if (!session) return;

    const taskId = Number(req.params.id);
    const task = getTask(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (!sameAccount(task.verifier, session.user.accountId)) {
      return res.status(403).json({ error: "Only the verifier can approve or reject this task." });
    }
    if (task.state !== "Submitted") return res.status(400).json({ error: "Task is not awaiting verification." });

    const approved = Boolean(req.body?.approved);
    const now = Date.now() / 1000;

    if (!approved) {
      if (task.escrowContract) {
        task.state = "EscrowRefundPending";
        task.verifiedAt = now;
        task.escrowPendingAction = "refund";
        saveTask(task);

        const hcs = await appendTaskHcs({ type: "escrow_reject_pending_refund", taskId, at: now });
        if (hcs.transactionId) {
          mergeLedgerTx(task, "rejected", hcs.transactionId);
          saveTask(task);
        }

        return res.json({
          task: serializeTask(task),
          hcsSequence: hcs.topicSequenceNumber,
          transactionId: hcs.transactionId,
          escrowNext: "sign_refund_then_sync",
        });
      }

      const refundTx = await settleToRecipient(task, task.client);
      mergeLedgerTx(task, "settlement", refundTx);
      task.state = "Refunded";
      task.verifiedAt = now;
      task.completedAt = now;
      saveTask(task);

      const hcs = await appendTaskHcs({ type: "rejected", taskId, at: now, settlementTxId: refundTx });
      if (hcs.transactionId) {
        mergeLedgerTx(task, "rejected", hcs.transactionId);
        saveTask(task);
      }

      return res.json({
        task: serializeTask(task),
        settlementTxId: refundTx,
        hcsSequence: hcs.topicSequenceNumber,
        transactionId: hcs.transactionId,
      });
    }

    if (task.escrowContract) {
      task.state = "Verified";
      task.verifiedAt = now;
      task.escrowPendingAction = "release";
      saveTask(task);

      return res.json({
        task: serializeTask(task),
        escrowNext: "sign_release_then_sync",
      });
    }

    const settlementTx = await settleToRecipient(task, task.worker);
    mergeLedgerTx(task, "settlement", settlementTx);
    task.state = "PaidOut";
    task.verifiedAt = now;
    task.completedAt = now;
    saveTask(task);

    const hcs = await appendTaskHcs({ type: "paid", taskId, at: now, settlementTxId: settlementTx });
    if (hcs.transactionId) {
      mergeLedgerTx(task, "paidAudit", hcs.transactionId);
      saveTask(task);
    }

    res.json({
      task: serializeTask(task),
      settlementTxId: settlementTx,
      hcsSequence: hcs.topicSequenceNumber,
      paidAuditTransactionId: hcs.transactionId,
    });
  });

  router.post("/tasks/:id/dispute", async (req, res) => {
    const session = requireAuthSession(req, res);
    if (!session) return;

    const taskId = Number(req.params.id);
    const task = getTask(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (!sameAccount(task.client, session.user.accountId) && !sameAccount(task.worker, session.user.accountId)) {
      return res.status(403).json({ error: "Only the client or worker can dispute this task." });
    }
    if (!["Funded", "Submitted"].includes(task.state)) {
      return res.status(400).json({ error: "Task cannot be disputed in its current state." });
    }

    task.state = "Disputed";
    saveTask(task);

    const hcs = await appendTaskHcs({ type: "dispute", taskId, at: Date.now() / 1000 });
    if (hcs.transactionId) {
      mergeLedgerTx(task, "dispute", hcs.transactionId);
      saveTask(task);
    }

    res.json({ task: serializeTask(task), hcsSequence: hcs.topicSequenceNumber, transactionId: hcs.transactionId });
  });

  router.post("/tasks/:id/onchain-sync", async (req, res) => {
    const session = requireAuthSession(req, res);
    if (!session) return;

    const taskId = Number(req.params.id);
    const task = getTask(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (
      !sameAccount(task.client, session.user.accountId) &&
      !sameAccount(task.worker, session.user.accountId) &&
      !sameAccount(task.verifier, session.user.accountId)
    ) {
      return res.status(403).json({ error: "Only task participants can sync contract state." });
    }
    if (!task.escrowContract) return res.status(400).json({ error: "Task is not an on-chain escrow task." });
    if (!escrowDeploymentConfigured) {
      return res.status(503).json({ error: "ESCROW_CONTRACT_ADDRESS is not configured on the server." });
    }
    if (!task.clientEvm || !task.workerEvm || !task.verifierEvm || !task.tokenEvm) {
      return res.status(500).json({ error: "Task is missing mirrored EVM addresses." });
    }

    const txHash = String(req.body?.txHash ?? "").trim() || undefined;
    const escrow = new Contract(ESCROW_CONTRACT_ADDRESS, HEDERA_TASK_ESCROW_ABI, escrowProvider);

    const raw = (await escrow.tasks(BigInt(taskId))) as [string, string, string, string, bigint, number];
    const [clientEvm, workerEvm, verifierEvm, tokenEvm, amount, status] = raw;

    if (!addrEq(clientEvm, task.clientEvm)) return res.status(409).json({ error: "On-chain client does not match the stored task." });
    if (!addrEq(workerEvm, task.workerEvm)) return res.status(409).json({ error: "On-chain worker does not match the stored task." });
    if (!addrEq(verifierEvm, task.verifierEvm)) return res.status(409).json({ error: "On-chain verifier does not match the stored task." });
    if (!addrEq(tokenEvm, task.tokenEvm)) return res.status(409).json({ error: "On-chain token does not match the stored task." });
    if (amount.toString() !== task.amount) return res.status(409).json({ error: "On-chain amount does not match the stored task." });

    if (status === EscrowOnChainStatus.None) {
      return res.json({ task: serializeTask(task), onChain: { status: "none" as const } });
    }

    if (status === EscrowOnChainStatus.Funded) {
      if (txHash) mergeLedgerTx(task, "onChainFund", txHash);
      if (task.state === "Open") {
        const now = Date.now() / 1000;
        task.state = "Funded";
        task.fundedAt = now;
        const hcs = await appendTaskHcs({ type: "onchain_funded", taskId, at: now });
        if (hcs.transactionId) mergeLedgerTx(task, "funded", hcs.transactionId);
      }
      saveTask(task);
      return res.json({ task: serializeTask(task), onChain: { status: "funded" as const } });
    }

    if (status === EscrowOnChainStatus.Released) {
      const now = Date.now() / 1000;
      if (txHash) {
        mergeLedgerTx(task, "onChainRelease", txHash);
        mergeLedgerTx(task, "settlement", txHash);
      }
      task.state = "PaidOut";
      task.completedAt = now;
      if (!task.verifiedAt) task.verifiedAt = now;
      delete task.escrowPendingAction;
      const hcs = await appendTaskHcs({ type: "onchain_released", taskId, at: now, settlementTxId: txHash ?? null });
      if (hcs.transactionId) mergeLedgerTx(task, "paidAudit", hcs.transactionId);
      saveTask(task);
      return res.json({ task: serializeTask(task), onChain: { status: "released" as const } });
    }

    if (status === EscrowOnChainStatus.Refunded) {
      const now = Date.now() / 1000;
      if (txHash) {
        mergeLedgerTx(task, "onChainRefund", txHash);
        mergeLedgerTx(task, "settlement", txHash);
      }
      task.state = "Refunded";
      task.completedAt = now;
      if (!task.verifiedAt) task.verifiedAt = now;
      delete task.escrowPendingAction;
      const hcs = await appendTaskHcs({ type: "onchain_refunded", taskId, at: now, settlementTxId: txHash ?? null });
      if (hcs.transactionId) mergeLedgerTx(task, "rejected", hcs.transactionId);
      saveTask(task);
      return res.json({ task: serializeTask(task), onChain: { status: "refunded" as const } });
    }

    return res.status(500).json({ error: `Unknown HederaTaskEscrow status ${status}.` });
  });

  return router;
}
