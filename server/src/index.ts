
import fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
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
import { proto } from "@hiero-ledger/proto";
import { PublicKey } from "@hiero-ledger/sdk";
import Long from "long";
import { AgentMode, HederaBuilder, HederaLangchainToolkit } from "hedera-agent-kit";
import { Contract, JsonRpcProvider, getAddress, verifyMessage } from "ethers";
import { HEDERA_TASK_ESCROW_ABI, EscrowOnChainStatus } from "./escrowAbi.js";
import {
  PROJECT_SEGMENTATION_RESPONSE_SCHEMA,
  buildProjectSegmentationInstructions,
  buildProjectSegmentationPrompt,
  parseProjectSegmentationResult,
} from "./projectSegmentation.js";
import type { ProjectSegmentationInput, ProjectSegmentationResult } from "./projectSegmentation.js";

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

type WalletSource = "hashpack" | "metamask";
type SupportedNetwork = "testnet";

type AuthenticatedUser = {
  accountId: string;
  walletSource: WalletSource;
  network: SupportedNetwork;
};

type AuthChallenge = AuthenticatedUser & {
  challengeId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  expiresAtMs: number;
  used: boolean;
};

type StoredSession = {
  token: string;
  user: AuthenticatedUser;
  expiresAtMs: number;
};

type ProjectSegmentationSource = "manual" | "hedera";
type ProjectSubmissionStatus = "queued" | "processing" | "segmented" | "failed";
type ProjectSegmentationJobStatus = "queued" | "processing" | "completed" | "failed";

type HederaProjectEvent = Partial<{
  consensusTimestamp: string;
  eventType: string;
  sourceAccountId: string;
  topicId: string;
  topicSequenceNumber: string;
  transactionId: string;
}>;

type StoredProjectSubmission = {
  id: string;
  source: ProjectSegmentationSource;
  status: ProjectSubmissionStatus;
  createdAt: number;
  updatedAt: number;
  latestJobId: string;
  project: ProjectSegmentationInput;
  rawPayload: Record<string, unknown> | null;
  hedera: HederaProjectEvent | null;
  segmentation?: ProjectSegmentationResult;
  error?: string;
};

type OpenAIUsageSnapshot = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

type StoredProjectSegmentationJob = {
  id: string;
  submissionId: string;
  source: ProjectSegmentationSource;
  status: ProjectSegmentationJobStatus;
  createdAt: number;
  updatedAt: number;
  startedAt: number;
  completedAt: number;
  attempts: number;
  model: string;
  openAiResponseId?: string;
  usage?: OpenAIUsageSnapshot;
  error?: string;
};

type OpenAIResponseOutputContentItem = {
  type?: string;
  text?: string;
  refusal?: string;
};

type OpenAIResponseOutputItem = {
  type?: string;
  content?: OpenAIResponseOutputContentItem[];
};

type OpenAIResponsePayload = {
  id?: string;
  status?: string;
  error?: { message?: string } | null;
  output?: OpenAIResponseOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
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
const SESSION_COOKIE_NAME = "escrowswap_session";
const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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
const PROJECT_SEGMENTATION_STORE_PATH =
  process.env.PROJECT_SEGMENTATION_STORE_PATH?.trim() || path.join(__dirname, "..", "data", "project-segmentation.json");
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
const OPENAI_SEGMENT_MODEL = (process.env.OPENAI_SEGMENT_MODEL || "gpt-4o-mini").trim();
const OPENAI_SEGMENT_TIMEOUT_MS = Number(process.env.OPENAI_SEGMENT_TIMEOUT_MS || 45000);
const OPENAI_SEGMENT_MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_SEGMENT_MAX_OUTPUT_TOKENS || 700);
const HEDERA_QUEUE_SHARED_SECRET = (process.env.HEDERA_QUEUE_SHARED_SECRET || "").trim();

const tasks = new Map<number, StoredTask>();
const authChallenges = new Map<string, AuthChallenge>();
const authSessions = new Map<string, StoredSession>();
const projectSubmissions = new Map<string, StoredProjectSubmission>();
const projectSegmentationJobs = new Map<string, StoredProjectSegmentationJob>();
let nextId = 0;
let projectSegmentationWorkerRunning = false;

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

function loadProjectSegmentationStore(): void {
  try {
    const raw = fs.readFileSync(PROJECT_SEGMENTATION_STORE_PATH, "utf8");
    const data = JSON.parse(raw) as {
      jobs?: StoredProjectSegmentationJob[];
      submissions?: StoredProjectSubmission[];
    };

    projectSubmissions.clear();
    for (const submission of data.submissions ?? []) {
      projectSubmissions.set(submission.id, {
        ...submission,
        status: submission.status === "processing" ? "queued" : submission.status,
      });
    }

    projectSegmentationJobs.clear();
    for (const job of data.jobs ?? []) {
      projectSegmentationJobs.set(job.id, {
        ...job,
        status: job.status === "processing" ? "queued" : job.status,
        startedAt: job.status === "processing" ? 0 : job.startedAt,
      });
    }

    console.log(`Loaded ${projectSubmissions.size} project submission(s) from ${PROJECT_SEGMENTATION_STORE_PATH}`);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") console.warn("project segmentation store load:", err.message);
  }
}

function persistProjectSegmentationStore(): void {
  try {
    const dir = path.dirname(PROJECT_SEGMENTATION_STORE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      submissions: [...projectSubmissions.values()].sort((a, b) => a.createdAt - b.createdAt),
      jobs: [...projectSegmentationJobs.values()].sort((a, b) => a.createdAt - b.createdAt),
    };
    fs.writeFileSync(PROJECT_SEGMENTATION_STORE_PATH, JSON.stringify(payload, null, 2), "utf8");
  } catch (e) {
    console.error("project segmentation store persist failed:", e);
  }
}

loadProjectSegmentationStore();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readOptionalStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function readOptionalNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readTeamNameValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 6)
      .join(", ");
  }
  return "";
}

function parseMaybeJsonObjectString(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeProjectSegmentationInput(value: unknown): ProjectSegmentationInput {
  const body = isRecord(value) ? value : {};
  const projectName = readOptionalStringValue(body.projectName ?? body.name ?? body.title);
  const description = readOptionalStringValue(body.description ?? body.summary ?? body.pitch);

  if (!projectName || !description) {
    throw new Error("projectName and description are required");
  }

  const metadata =
    (isRecord(body.metadata) && body.metadata) ||
    (isRecord(body.context) && body.context) ||
    (isRecord(body.extra) && body.extra) ||
    null;

  return {
    projectName,
    description,
    teamName: readTeamNameValue(body.teamName ?? body.team ?? body.submitters ?? body.builders),
    githubUrl: readOptionalStringValue(body.githubUrl ?? body.repositoryUrl ?? body.repoUrl),
    demoUrl: readOptionalStringValue(body.demoUrl ?? body.videoUrl ?? body.websiteUrl),
    trackHints: readStringArrayValue(body.trackHints ?? body.tracks ?? body.trackNames),
    capabilities: readStringArrayValue(body.capabilities ?? body.tags ?? body.keywords),
    requestedBudget: readOptionalNumberValue(body.requestedBudget ?? body.prizeRequested ?? body.amount),
    metadata,
  };
}

function extractHederaProjectEvent(body: Record<string, unknown>): HederaProjectEvent | null {
  const eventType = readOptionalStringValue(body.eventType ?? body.type);
  const transactionId = readOptionalStringValue(body.transactionId ?? body.txId);
  const topicId = readOptionalStringValue(body.topicId);
  const topicSequenceNumber = readOptionalStringValue(body.topicSequenceNumber ?? body.sequenceNumber);
  const consensusTimestamp = readOptionalStringValue(body.consensusTimestamp ?? body.timestamp);
  const sourceAccountId = readOptionalStringValue(body.sourceAccountId ?? body.accountId ?? body.sender);

  if (!eventType && !transactionId && !topicId && !topicSequenceNumber && !consensusTimestamp && !sourceAccountId) {
    return null;
  }

  return {
    ...(eventType ? { eventType } : {}),
    ...(transactionId ? { transactionId } : {}),
    ...(topicId ? { topicId } : {}),
    ...(topicSequenceNumber ? { topicSequenceNumber } : {}),
    ...(consensusTimestamp ? { consensusTimestamp } : {}),
    ...(sourceAccountId ? { sourceAccountId } : {}),
  };
}

function serializeProjectSubmission(submission: StoredProjectSubmission): Record<string, unknown> {
  return { ...submission };
}

function serializeProjectSegmentationJob(job: StoredProjectSegmentationJob): Record<string, unknown> {
  return { ...job };
}

function buildProjectSegmentationQueueSummary(): Record<string, unknown> {
  const jobs = [...projectSegmentationJobs.values()];
  return {
    openAiConfigured: Boolean(OPENAI_API_KEY),
    model: OPENAI_SEGMENT_MODEL,
    submissions: projectSubmissions.size,
    jobs: jobs.length,
    queued: jobs.filter((job) => job.status === "queued").length,
    processing: jobs.filter((job) => job.status === "processing").length,
    completed: jobs.filter((job) => job.status === "completed").length,
    failed: jobs.filter((job) => job.status === "failed").length,
  };
}

function isOpenAiSegmentationConfigured(): boolean {
  return Boolean(OPENAI_API_KEY);
}

function openAiResponsesUrl(): string {
  return `${OPENAI_BASE_URL}/responses`;
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function extractStructuredContentText(payload: OpenAIResponsePayload): string {
  const texts: string[] = [];

  for (const item of payload.output ?? []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content.type === "refusal" && content.refusal?.trim()) {
        throw new Error(`OpenAI refused to segment the project: ${content.refusal.trim()}`);
      }
      if (content.type === "output_text" && content.text?.trim()) {
        texts.push(content.text);
      }
    }
  }

  if (texts.length === 0) {
    throw new Error("OpenAI returned no structured output text.");
  }

  return stripMarkdownCodeFence(texts.join("\n"));
}

async function callOpenAiProjectSegmentation(
  submission: StoredProjectSubmission,
): Promise<{ responseId: string; segmentation: ProjectSegmentationResult; usage?: OpenAIUsageSnapshot }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_SEGMENT_TIMEOUT_MS);

  try {
    const response = await fetch(openAiResponsesUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_SEGMENT_MODEL,
        store: false,
        max_output_tokens: OPENAI_SEGMENT_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: buildProjectSegmentationInstructions() }],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: buildProjectSegmentationPrompt(submission.project, submission.source === "hedera" ? "hedera event" : "manual api"),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "project_segmentation",
            strict: true,
            schema: PROJECT_SEGMENTATION_RESPONSE_SCHEMA,
          },
        },
        metadata: {
          source: submission.source,
          submission_id: submission.id,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const raw = await response.text();
      const parsed = parseMaybeJsonObjectString(raw);
      const apiMessage = readOptionalStringValue(parsed?.error && isRecord(parsed.error) ? parsed.error.message : "");
      throw new Error(apiMessage || `OpenAI API returned ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as OpenAIResponsePayload;
    const text = extractStructuredContentText(payload);
    const parsed = JSON.parse(text) as unknown;

    return {
      responseId: readOptionalStringValue(payload.id) || "unknown",
      segmentation: parseProjectSegmentationResult(parsed),
      usage: payload.usage
        ? {
            inputTokens: Number(payload.usage.input_tokens || 0),
            outputTokens: Number(payload.usage.output_tokens || 0),
            reasoningTokens: Number(payload.usage.output_tokens_details?.reasoning_tokens || 0),
            totalTokens: Number(payload.usage.total_tokens || 0),
          }
        : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function findExistingHederaSubmission(event: HederaProjectEvent | null): StoredProjectSubmission | undefined {
  if (!event) return undefined;

  return [...projectSubmissions.values()].find((submission) => {
    if (submission.source !== "hedera" || !submission.hedera) return false;
    if (event.transactionId && submission.hedera.transactionId === event.transactionId) return true;
    if (
      event.topicId &&
      event.topicSequenceNumber &&
      submission.hedera.topicId === event.topicId &&
      submission.hedera.topicSequenceNumber === event.topicSequenceNumber
    ) {
      return true;
    }
    return false;
  });
}

function createProjectSegmentationJob(submission: StoredProjectSubmission): StoredProjectSegmentationJob {
  const now = Date.now() / 1000;
  return {
    id: randomUUID(),
    submissionId: submission.id,
    source: submission.source,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    startedAt: 0,
    completedAt: 0,
    attempts: 0,
    model: OPENAI_SEGMENT_MODEL,
  };
}

function queueProjectSegmentationSubmission(
  source: ProjectSegmentationSource,
  project: ProjectSegmentationInput,
  rawPayload: Record<string, unknown> | null,
  hedera: HederaProjectEvent | null,
): { duplicate: boolean; job: StoredProjectSegmentationJob; submission: StoredProjectSubmission } {
  if (source === "hedera") {
    const existing = findExistingHederaSubmission(hedera);
    if (existing) {
      const existingJob =
        projectSegmentationJobs.get(existing.latestJobId) ??
        [...projectSegmentationJobs.values()]
          .filter((job) => job.submissionId === existing.id)
          .sort((a, b) => b.createdAt - a.createdAt)[0];

      if (existingJob) {
        return { duplicate: true, submission: existing, job: existingJob };
      }
    }
  }

  const submission: StoredProjectSubmission = {
    id: randomUUID(),
    source,
    status: "queued",
    createdAt: Date.now() / 1000,
    updatedAt: Date.now() / 1000,
    latestJobId: "",
    project,
    rawPayload,
    hedera,
  };
  const job = createProjectSegmentationJob(submission);
  submission.latestJobId = job.id;
  projectSubmissions.set(submission.id, submission);
  projectSegmentationJobs.set(job.id, job);
  persistProjectSegmentationStore();
  void drainProjectSegmentationQueue();
  return { duplicate: false, submission, job };
}

function requeueProjectSegmentationSubmission(submission: StoredProjectSubmission): StoredProjectSegmentationJob {
  const job = createProjectSegmentationJob(submission);
  submission.status = "queued";
  submission.updatedAt = Date.now() / 1000;
  delete submission.error;
  submission.latestJobId = job.id;
  projectSubmissions.set(submission.id, submission);
  projectSegmentationJobs.set(job.id, job);
  persistProjectSegmentationStore();
  void drainProjectSegmentationQueue();
  return job;
}

// Single-flight worker keeps Hedera-derived events in arrival order.
async function drainProjectSegmentationQueue(): Promise<void> {
  if (projectSegmentationWorkerRunning || !isOpenAiSegmentationConfigured()) return;

  projectSegmentationWorkerRunning = true;
  try {
    for (;;) {
      const nextJob = [...projectSegmentationJobs.values()]
        .filter((job) => job.status === "queued")
        .sort((a, b) => a.createdAt - b.createdAt)[0];

      if (!nextJob) return;

      const submission = projectSubmissions.get(nextJob.submissionId);
      if (!submission) {
        nextJob.status = "failed";
        nextJob.updatedAt = Date.now() / 1000;
        nextJob.completedAt = nextJob.updatedAt;
        nextJob.error = "Submission is missing.";
        projectSegmentationJobs.set(nextJob.id, nextJob);
        persistProjectSegmentationStore();
        continue;
      }

      const startedAt = Date.now() / 1000;
      nextJob.status = "processing";
      nextJob.startedAt = startedAt;
      nextJob.updatedAt = startedAt;
      nextJob.attempts += 1;
      submission.status = "processing";
      submission.updatedAt = startedAt;
      delete submission.error;
      projectSegmentationJobs.set(nextJob.id, nextJob);
      projectSubmissions.set(submission.id, submission);
      persistProjectSegmentationStore();

      try {
        const result = await callOpenAiProjectSegmentation(submission);
        const completedAt = Date.now() / 1000;

        submission.status = "segmented";
        submission.updatedAt = completedAt;
        submission.segmentation = result.segmentation;
        delete submission.error;
        projectSubmissions.set(submission.id, submission);

        nextJob.status = "completed";
        nextJob.updatedAt = completedAt;
        nextJob.completedAt = completedAt;
        nextJob.openAiResponseId = result.responseId;
        nextJob.usage = result.usage;
        delete nextJob.error;
        projectSegmentationJobs.set(nextJob.id, nextJob);
        persistProjectSegmentationStore();

        await appendHcs({
          type: "project_segmented",
          submissionId: submission.id,
          source: submission.source,
          at: completedAt,
          primarySegment: result.segmentation.primarySegment,
          hederaFit: result.segmentation.hederaFit,
          confidence: result.segmentation.confidence,
          ...(submission.hedera ? { hedera: submission.hedera } : {}),
        });
      } catch (error) {
        const completedAt = Date.now() / 1000;
        const message = readErrorMessage(error);

        submission.status = "failed";
        submission.updatedAt = completedAt;
        submission.error = message;
        projectSubmissions.set(submission.id, submission);

        nextJob.status = "failed";
        nextJob.updatedAt = completedAt;
        nextJob.completedAt = completedAt;
        nextJob.error = message;
        projectSegmentationJobs.set(nextJob.id, nextJob);
        persistProjectSegmentationStore();
        console.error(`[segmentation] job ${nextJob.id} failed:`, message);
      }
    }
  } finally {
    projectSegmentationWorkerRunning = false;
  }
}

function hederaAccountRegex(id: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(id);
}

function sameAccount(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

function isWalletSource(value: unknown): value is WalletSource {
  return value === "hashpack" || value === "metamask";
}

function isSupportedNetwork(value: unknown): value is SupportedNetwork {
  return value === "testnet";
}

function buildAuthSignedMessage(challenge: AuthChallenge): string {
  return [
    "EscrowSwap Pro sign-in",
    "",
    `Account: ${challenge.accountId}`,
    `Wallet: ${challenge.walletSource}`,
    `Network: ${challenge.network}`,
    `Challenge ID: ${challenge.challengeId}`,
    `Nonce: ${challenge.nonce}`,
    `Issued At: ${challenge.issuedAt}`,
    `Expires At: ${challenge.expiresAt}`,
    "",
    "Only sign this message if you are connecting to EscrowSwap Pro.",
  ].join("\n");
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function prefixHederaSignedMessage(message: string): string {
  return `\x19Hedera Signed Message:\n${message.length}${message}`;
}

function verifyHederaSignedMessage(message: string, base64SignatureMap: string, publicKey: PublicKey): boolean {
  const signatureMap = proto.SignatureMap.decode(Buffer.from(base64SignatureMap, "base64"));
  const signaturePair = signatureMap.sigPair?.[0];
  const signature = signaturePair?.ed25519 ?? signaturePair?.ECDSASecp256k1;
  if (!signature) {
    throw new Error("Signature not found in signature map");
  }

  return publicKey.verify(Buffer.from(prefixHederaSignedMessage(message)), signature);
}

function cleanupExpiredAuthState(): void {
  const now = Date.now();

  for (const [id, challenge] of authChallenges.entries()) {
    if (challenge.used || challenge.expiresAtMs <= now) {
      authChallenges.delete(id);
    }
  }

  for (const [token, session] of authSessions.entries()) {
    if (session.expiresAtMs <= now) {
      authSessions.delete(token);
    }
  }
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};

  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey || rest.length === 0) return acc;
    acc[rawKey] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function setSessionCookie(res: express.Response, token: string, expiresAtMs: number): void {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs.join("; ")}`);
}

function clearSessionCookie(res: express.Response): void {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; ${attrs.join("; ")}`);
}

function getSessionFromRequest(req: express.Request): StoredSession | null {
  cleanupExpiredAuthState();
  const token = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session) return null;
  if (session.expiresAtMs <= Date.now()) {
    authSessions.delete(token);
    return null;
  }
  return session;
}

function requireAuthSession(req: express.Request, res: express.Response): StoredSession | null {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Sign in with HashPack or MetaMask first." });
    return null;
  }
  return session;
}

function requireTaskRole(
  req: express.Request,
  res: express.Response,
  task: StoredTask,
  roles: ("client" | "worker" | "verifier")[],
): StoredSession | null {
  const session = requireAuthSession(req, res);
  if (!session) return null;

  const authorized = roles.some((role) => sameAccount(task[role], session.user.accountId));
  if (!authorized) {
    res.status(403).json({ error: "Your signed-in Hedera account is not authorized for this task action." });
    return null;
  }

  return session;
}

function hasValidHederaQueueSecret(req: express.Request): boolean {
  if (!HEDERA_QUEUE_SHARED_SECRET) return true;
  return req.get("x-hedera-queue-secret")?.trim() === HEDERA_QUEUE_SHARED_SECRET;
}

function extractProjectSubmissionRequest(body: unknown): {
  hedera: HederaProjectEvent | null;
  project: ProjectSegmentationInput;
  rawPayload: Record<string, unknown> | null;
} {
  const rawBody = isRecord(body) ? body : {};
  const nestedPayload =
    (isRecord(rawBody.project) && rawBody.project) ||
    (isRecord(rawBody.submission) && rawBody.submission) ||
    (isRecord(rawBody.payload) && rawBody.payload) ||
    parseMaybeJsonObjectString(rawBody.payload) ||
    parseMaybeJsonObjectString(rawBody.message) ||
    rawBody;

  const nestedProject =
    (isRecord(nestedPayload.project) && nestedPayload.project) ||
    (isRecord(nestedPayload.submission) && nestedPayload.submission) ||
    nestedPayload;

  return {
    hedera: extractHederaProjectEvent(rawBody),
    project: normalizeProjectSegmentationInput(nestedProject),
    rawPayload: rawBody,
  };
}

function mirrorNodeBaseUrl(network: SupportedNetwork): string {
  return network === "testnet" ? "https://testnet.mirrornode.hedera.com" : "https://mainnet.mirrornode.hedera.com";
}

async function fetchAccountPublicKey(accountId: string, network: SupportedNetwork): Promise<PublicKey> {
  const response = await fetch(`${mirrorNodeBaseUrl(network)}/api/v1/accounts/${accountId}`);
  if (!response.ok) {
    throw new Error(`Unable to fetch Hedera account key for ${accountId}.`);
  }

  const payload = (await response.json()) as {
    key?: {
      _type?: string;
      key?: string;
    };
  };

  const rawKey = payload.key?.key?.trim();
  const rawType = payload.key?._type?.trim();
  if (!rawKey || !rawType) {
    throw new Error("Hedera account key is not available from the mirror node.");
  }

  if (rawType === "ED25519") {
    return PublicKey.fromStringED25519(rawKey);
  }
  if (rawType === "ECDSA_SECP256K1") {
    return PublicKey.fromStringECDSA(rawKey);
  }

  throw new Error(`Unsupported Hedera account key type: ${rawType}`);
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
        // `hedera-agent-kit` currently resolves its own `@hashgraph/sdk` copy.
        client: client as never,
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
if (!isOpenAiSegmentationConfigured()) {
  console.warn("[segmentation] OPENAI_API_KEY is not set — Hedera project events can be queued, but OpenAI segmentation will not run.");
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
    const res = await tx.execute(client as never);
    const receipt = await res.getReceipt(client as never);
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

void drainProjectSegmentationQueue();

const app = express();
app.use(cors({ origin: true, credentials: true }));
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
    openai: {
      configured: isOpenAiSegmentationConfigured(),
      baseUrl: OPENAI_BASE_URL,
      model: OPENAI_SEGMENT_MODEL,
    },
    segmentationQueue: buildProjectSegmentationQueueSummary(),
    hederaIngestion: {
      sharedSecretConfigured: Boolean(HEDERA_QUEUE_SHARED_SECRET),
    },
    ledgerHints: {
      hcsMessagesNeedTopic: !TOPIC_ID,
      transfersNeedKeysAndNotDryRun: DRY_RUN || !OPERATOR_KEY_RAW,
      settlementOnApprove: !(DRY_RUN || !OPERATOR_KEY_RAW || escrowDeploymentConfigured),
    },
  });
});

app.post("/auth/nonce", (req, res) => {
  cleanupExpiredAuthState();

  const accountId = String((req.body as { accountId?: unknown })?.accountId ?? "").trim();
  const walletSource = (req.body as { walletSource?: unknown })?.walletSource;
  const network = (req.body as { network?: unknown })?.network;

  if (!hederaAccountRegex(accountId)) {
    return res.status(400).json({ error: "accountId must be a Hedera account id (0.0.x)" });
  }
  if (!isWalletSource(walletSource)) {
    return res.status(400).json({ error: "walletSource must be hashpack or metamask" });
  }
  if (!isSupportedNetwork(network)) {
    return res.status(400).json({ error: "network must be testnet" });
  }

  const now = Date.now();
  const challenge: AuthChallenge = {
    accountId,
    challengeId: randomUUID(),
    expiresAt: new Date(now + AUTH_CHALLENGE_TTL_MS).toISOString(),
    expiresAtMs: now + AUTH_CHALLENGE_TTL_MS,
    issuedAt: new Date(now).toISOString(),
    network,
    nonce: randomBytes(16).toString("hex"),
    used: false,
    walletSource,
  };

  authChallenges.set(challenge.challengeId, challenge);

  res.status(201).json({
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  });
});

app.post("/auth/verify", async (req, res) => {
  cleanupExpiredAuthState();

  const challengeId = String((req.body as { challengeId?: unknown })?.challengeId ?? "").trim();
  const accountId = String((req.body as { accountId?: unknown })?.accountId ?? "").trim();
  const walletSource = (req.body as { walletSource?: unknown })?.walletSource;
  const network = (req.body as { network?: unknown })?.network;
  const signature = String((req.body as { signature?: unknown })?.signature ?? "").trim();
  const signedPayload = String((req.body as { signedPayload?: unknown })?.signedPayload ?? "");

  if (!challengeId || !signature || !signedPayload) {
    return res.status(400).json({ error: "challengeId, signature, and signedPayload are required" });
  }
  if (!hederaAccountRegex(accountId)) {
    return res.status(400).json({ error: "accountId must be a Hedera account id (0.0.x)" });
  }
  if (!isWalletSource(walletSource)) {
    return res.status(400).json({ error: "walletSource must be hashpack or metamask" });
  }
  if (!isSupportedNetwork(network)) {
    return res.status(400).json({ error: "network must be testnet" });
  }

  const challenge = authChallenges.get(challengeId);
  if (!challenge || challenge.used) {
    return res.status(400).json({ error: "Challenge is missing or already used." });
  }
  if (challenge.expiresAtMs <= Date.now()) {
    authChallenges.delete(challengeId);
    return res.status(400).json({ error: "Challenge expired. Request a fresh sign-in challenge." });
  }
  if (!sameAccount(challenge.accountId, accountId) || challenge.walletSource !== walletSource || challenge.network !== network) {
    authChallenges.delete(challengeId);
    return res.status(400).json({ error: "Challenge does not match the provided account or wallet details." });
  }

  const expectedPayload = buildAuthSignedMessage(challenge);
  if (signedPayload !== expectedPayload) {
    authChallenges.delete(challengeId);
    return res.status(400).json({ error: "Signed payload mismatch." });
  }

  challenge.used = true;
  authChallenges.set(challengeId, challenge);

  try {
    if (walletSource === "hashpack") {
      const publicKey = await fetchAccountPublicKey(accountId, network);
      const valid = verifyHederaSignedMessage(expectedPayload, signature, publicKey);
      if (!valid) {
        authChallenges.delete(challengeId);
        return res.status(401).json({ error: "Signature verification failed." });
      }
    } else {
      const expectedEvm = await mirrorAccountEvm(accountId);
      if (!expectedEvm) {
        authChallenges.delete(challengeId);
        return res.status(400).json({
          error: "This Hedera account has no mirror evm_address. Use an ECDSA account with an EVM alias.",
        });
      }
      let recovered: string;
      try {
        recovered = verifyMessage(expectedPayload, signature);
      } catch {
        authChallenges.delete(challengeId);
        return res.status(401).json({ error: "Invalid EVM signature." });
      }
      if (!addrEq(recovered, expectedEvm)) {
        authChallenges.delete(challengeId);
        return res.status(401).json({ error: "Wallet EVM address does not match this Hedera account." });
      }
    }

    const user: AuthenticatedUser = { accountId, walletSource, network };
    const token = randomBytes(32).toString("hex");
    const expiresAtMs = Date.now() + AUTH_SESSION_TTL_MS;
    authSessions.set(token, { token, user, expiresAtMs });
    authChallenges.delete(challengeId);
    setSessionCookie(res, token, expiresAtMs);

    return res.json({
      user,
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  } catch (error) {
    authChallenges.delete(challengeId);
    console.error("auth verify failed", error);
    return res.status(502).json({ error: readErrorMessage(error) });
  }
});

app.get("/auth/session", (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    clearSessionCookie(res);
    return res.json({ authenticated: false });
  }

  return res.json({
    authenticated: true,
    user: session.user,
  });
});

app.post("/auth/logout", (req, res) => {
  const token = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (token) {
    authSessions.delete(token);
  }
  clearSessionCookie(res);
  res.status(204).end();
});

app.get("/segmentation/projects", (_req, res) => {
  res.json({
    queue: buildProjectSegmentationQueueSummary(),
    submissions: [...projectSubmissions.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(serializeProjectSubmission),
  });
});

app.get("/segmentation/projects/:id", (req, res) => {
  const submission = projectSubmissions.get(String(req.params.id));
  if (!submission) {
    return res.status(404).json({ error: "Project submission not found" });
  }

  return res.json({
    submission: serializeProjectSubmission(submission),
    jobs: [...projectSegmentationJobs.values()]
      .filter((job) => job.submissionId === submission.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(serializeProjectSegmentationJob),
  });
});

app.get("/segmentation/jobs", (_req, res) => {
  res.json({
    queue: buildProjectSegmentationQueueSummary(),
    jobs: [...projectSegmentationJobs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(serializeProjectSegmentationJob),
  });
});

app.post("/segmentation/process", (_req, res) => {
  if (!isOpenAiSegmentationConfigured()) {
    return res.status(503).json({
      error: "OPENAI_API_KEY is not configured.",
      queue: buildProjectSegmentationQueueSummary(),
    });
  }

  void drainProjectSegmentationQueue();
  return res.status(202).json({
    accepted: true,
    queue: buildProjectSegmentationQueueSummary(),
  });
});

app.post("/segmentation/projects", (req, res) => {
  try {
    const { hedera, project, rawPayload } = extractProjectSubmissionRequest(req.body);
    const queued = queueProjectSegmentationSubmission("manual", project, rawPayload, hedera);
    return res.status(queued.duplicate ? 200 : 202).json({
      duplicate: queued.duplicate,
      submission: serializeProjectSubmission(queued.submission),
      job: serializeProjectSegmentationJob(queued.job),
      queue: buildProjectSegmentationQueueSummary(),
    });
  } catch (error) {
    return res.status(400).json({ error: readErrorMessage(error) });
  }
});

app.post("/segmentation/projects/:id/requeue", (req, res) => {
  const submission = projectSubmissions.get(String(req.params.id));
  if (!submission) {
    return res.status(404).json({ error: "Project submission not found" });
  }

  const job = requeueProjectSegmentationSubmission(submission);
  return res.status(202).json({
    submission: serializeProjectSubmission(submission),
    job: serializeProjectSegmentationJob(job),
    queue: buildProjectSegmentationQueueSummary(),
  });
});

app.post("/hedera/project-events", async (req, res) => {
  if (!hasValidHederaQueueSecret(req)) {
    return res.status(401).json({ error: "Invalid Hedera queue secret." });
  }

  try {
    const { hedera, project, rawPayload } = extractProjectSubmissionRequest(req.body);
    const queued = queueProjectSegmentationSubmission("hedera", project, rawPayload, hedera);

    if (!queued.duplicate) {
      await appendHcs({
        type: "project_segmentation_queued",
        submissionId: queued.submission.id,
        source: "hedera",
        at: queued.submission.createdAt,
        projectName: project.projectName,
        ...(hedera ? { hedera } : {}),
      });
    }

    return res.status(queued.duplicate ? 200 : 202).json({
      duplicate: queued.duplicate,
      submission: serializeProjectSubmission(queued.submission),
      job: serializeProjectSegmentationJob(queued.job),
      queue: buildProjectSegmentationQueueSummary(),
    });
  } catch (error) {
    return res.status(400).json({ error: readErrorMessage(error) });
  }
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
  const session = requireAuthSession(req, res);
  if (!session) return;

  const {
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

  if (!worker || !verifier || !paymentToken || amount == null || !workerPreferredToken) {
    return res.status(400).json({ error: "worker, verifier, paymentToken, amount, workerPreferredToken required" });
  }
  for (const label of ["worker", "verifier"] as const) {
    const v = label === "worker" ? worker : verifier;
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
      mirrorAccountEvm(String(session.user.accountId)),
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
    client: session.user.accountId,
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
  if (!requireTaskRole(req, res, t, ["client"])) return;
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
  if (!requireTaskRole(req, res, t, ["worker"])) return;
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
  if (!requireTaskRole(req, res, t, ["verifier"])) return;
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
  if (!requireTaskRole(req, res, t, ["client", "worker"])) return;
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
  console.log(`Project segmentation store: ${PROJECT_SEGMENTATION_STORE_PATH}`);
  console.log(
    `[segmentation] OpenAI ${isOpenAiSegmentationConfigured() ? `enabled (${OPENAI_SEGMENT_MODEL})` : "disabled"} via ${OPENAI_BASE_URL}`,
  );
});
