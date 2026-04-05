import { randomBytes, randomUUID } from "node:crypto";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { getAddress, verifyMessage, verifyTypedData } from "ethers";
import { z } from "zod";
import { buildClearSigningManifest, validateClearSigningManifest } from "../../packages/ledger-clear-signing/src/index.js";
import {
  buildAuthSignedMessage,
  buildTreasuryTypedData,
  createHackathonRequestSchema,
  createSubmissionRequestSchema,
  fundHackathonRequestSchema,
  hashTreasuryTypedData,
  queueEvaluationRequestSchema,
  approveAwardRequestSchema,
  redeemClaimRequestSchema,
  toOnchainId,
  type ApprovalRequest,
  type AuthenticatedUser,
  type AwardProposal,
  type HackathonRecord,
} from "../../packages/shared/src/index.js";
import { HCS_TOPIC_ID, MIRROR_BASE, NETWORK, PORT, SESSION_COOKIE_NAME, TREASURY_CONTRACT_ADDRESS } from "./config.js";
import { ensureSchema } from "./db.js";
import { appendHcsAudit } from "./hcs.js";
import {
  claimNextJob,
  completeJob,
  createApprovalRequest,
  createHackathon,
  createSubmission,
  enqueueJob,
  failJob,
  getApprovalRequestByAwardId,
  getAwardProposal,
  getHackathon,
  getPrizeClaim,
  getSubmission,
  listApprovalRequests,
  listEvents,
  listHackathons,
  listHcsAuditEvents,
  listJobs,
  listSubmissions,
  markApprovalApproved,
  markHackathonFunded,
  recordEvent,
  recordHcsAudit,
  updateApprovalExecution,
  updateAwardProposal,
} from "./store.js";
import { treasuryInterface, treasuryProvider } from "./treasuryContract.js";

const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type SupportedNetwork = "testnet";

type AuthChallenge = {
  challengeId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  expiresAtMs: number;
  used: boolean;
  accountId: string;
  evmAddress: string;
  walletSource: "metamask";
  network: SupportedNetwork;
};

type StoredSession = {
  token: string;
  user: AuthenticatedUser;
  expiresAtMs: number;
};

const authChallenges = new Map<string, AuthChallenge>();
const authSessions = new Map<string, StoredSession>();

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hederaAccountRegex(id: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(id);
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

function setSessionCookie(res: Response, token: string, expiresAtMs: number): void {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs.join("; ")}`);
}

function clearSessionCookie(res: Response): void {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; ${attrs.join("; ")}`);
}

function cleanupExpiredAuthState(): void {
  const now = Date.now();
  for (const [id, challenge] of authChallenges.entries()) {
    if (challenge.used || challenge.expiresAtMs <= now) authChallenges.delete(id);
  }
  for (const [token, session] of authSessions.entries()) {
    if (session.expiresAtMs <= now) authSessions.delete(token);
  }
}

function getSessionFromRequest(req: Request): StoredSession | null {
  cleanupExpiredAuthState();
  const token = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session || session.expiresAtMs <= Date.now()) {
    if (session) authSessions.delete(token);
    return null;
  }
  return session;
}

function requireAuthSession(req: Request, res: Response): StoredSession | null {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Sign in with MetaMask on Hedera Testnet first." });
    return null;
  }
  return session;
}

function addrEq(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

async function mirrorAccountEvm(accountId: string): Promise<string | null> {
  try {
    const response = await fetch(`${MIRROR_BASE}/api/v1/accounts/${accountId}`);
    if (!response.ok) return null;
    const payload = (await response.json()) as { evm_address?: string | null };
    const value = payload.evm_address?.trim();
    return value ? getAddress(value) : null;
  } catch {
    return null;
  }
}

function parseBody<TSchema extends z.ZodTypeAny>(schema: TSchema, body: unknown): z.infer<TSchema> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join(", "));
  }
  return parsed.data;
}

function approvalExpiresAtToUnix(expiresAt: string): number {
  return Math.floor(new Date(expiresAt).getTime() / 1000);
}

function buildAwardApprovalPayload(award: AwardProposal, approvalRequest: ApprovalRequest) {
  return {
    awardId: award.id,
    hackathonId: award.hackathonId,
    submissionId: award.submissionId,
    trackId: award.trackId,
    winner: award.winnerEvmAddress,
    amount: award.amount,
    settlementMode: award.settlementMode,
    expiresAt: approvalExpiresAtToUnix(approvalRequest.expiresAt),
  } as const;
}

function requireHackathonOperator(session: StoredSession, hackathon: HackathonRecord): void {
  const sameAccount = session.user.accountId === hackathon.organizerAccountId || session.user.accountId === hackathon.judgeAccountId;
  const sameAddress =
    addrEq(session.user.evmAddress, hackathon.organizerEvmAddress) || addrEq(session.user.evmAddress, hackathon.judgeEvmAddress);
  if (!sameAccount || !sameAddress) {
    throw new Error("Only the configured organizer or judge can perform this action.");
  }
}

async function appendAudit(params: {
  type: string;
  payload: Record<string, unknown>;
  hackathonId?: string;
  submissionId?: string;
  awardId?: string;
}): Promise<void> {
  const audit = await appendHcsAudit({
    ...params.payload,
    type: params.type,
    at: new Date().toISOString(),
  });
  await recordHcsAudit({
    type: params.type,
    hackathonId: params.hackathonId ?? null,
    submissionId: params.submissionId ?? null,
    awardId: params.awardId ?? null,
    txId: audit.txId,
    topicId: HCS_TOPIC_ID || null,
    sequenceNumber: audit.sequenceNumber,
    payload: {
      ...params.payload,
      hcs: {
        ok: audit.ok,
        txId: audit.txId,
        sequenceNumber: audit.sequenceNumber,
        reason: audit.reason ?? null,
      },
    },
  });
}

async function buildApprovalArtifacts(hackathon: HackathonRecord, award: AwardProposal) {
  const approvalPayload = {
    awardId: award.id,
    hackathonId: award.hackathonId,
    submissionId: award.submissionId,
    trackId: award.trackId,
    winner: award.winnerEvmAddress,
    amount: award.amount,
    settlementMode: award.settlementMode,
    expiresAt: Math.floor(Date.now() / 1000) + hackathon.approvalExpirySeconds,
  } as const;
  const typedData = buildTreasuryTypedData("approve_award", approvalPayload, {
    chainId: 296,
    verifyingContract: TREASURY_CONTRACT_ADDRESS,
  });
  const digest = hashTreasuryTypedData("approve_award", approvalPayload, {
    chainId: 296,
    verifyingContract: TREASURY_CONTRACT_ADDRESS,
  });
  const manifest = buildClearSigningManifest({
    action: "approve_award",
    chainId: 296,
    contractAddress: TREASURY_CONTRACT_ADDRESS,
    payload: approvalPayload,
  });
  const validation = validateClearSigningManifest(manifest);
  if (!validation.ok) {
    throw new Error(`Invalid clear-signing manifest: ${validation.errors.join(", ")}`);
  }
  return { approvalPayload, typedData, digest, manifest };
}

async function parseFundingReceipt(hackathon: HackathonRecord, txHash: string, expectedSender: string) {
  const receipt = await treasuryProvider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error("Transaction receipt not found on Hedera JSON-RPC.");
  }
  const tx = await treasuryProvider.getTransaction(txHash);
  if (!tx || !tx.from || !addrEq(tx.from, expectedSender)) {
    throw new Error("Funding transaction sender does not match the signed-in organizer wallet.");
  }
  if (!TREASURY_CONTRACT_ADDRESS || !receipt.to || !addrEq(receipt.to, TREASURY_CONTRACT_ADDRESS)) {
    throw new Error("Funding transaction was not sent to the configured treasury contract.");
  }

  const onchainHackathonId = toOnchainId(hackathon.id);
  const trackIdsByOnchainId = new Map<string, string>(
    hackathon.tracks.map((track: HackathonRecord["tracks"][number]) => [toOnchainId(track.id), track.id]),
  );
  const deposits: Array<{ trackId: string; amount: string }> = [];
  let created = false;

  for (const log of receipt.logs) {
    let parsed: ReturnType<typeof treasuryInterface.parseLog> | null = null;
    try {
      parsed = treasuryInterface.parseLog(log);
    } catch {
      parsed = null;
    }
    if (!parsed) continue;

    if (parsed.name === "HackathonCreated" && parsed.args.hackathonId === onchainHackathonId) {
      created = true;
    }
    if (parsed.name === "TreasuryFunded" && parsed.args.hackathonId === onchainHackathonId) {
      const trackId = trackIdsByOnchainId.get(parsed.args.trackId);
      if (trackId) {
        deposits.push({ trackId, amount: parsed.args.amount.toString() });
      }
    }
  }

  if (!created) {
    throw new Error("The transaction did not emit HackathonCreated for this hackathon.");
  }
  if (deposits.length === 0) {
    throw new Error("The transaction did not emit TreasuryFunded events for the configured tracks.");
  }

  return { receipt, deposits };
}

export async function createApp() {
  await ensureSchema();

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    res.json({
      ok: true,
      network: NETWORK,
      port: PORT,
      mirrorBase: MIRROR_BASE,
      treasuryContractAddress: TREASURY_CONTRACT_ADDRESS || null,
      hcsTopicId: HCS_TOPIC_ID || null,
    });
  });

  app.post("/auth/nonce", async (req, res) => {
    cleanupExpiredAuthState();
    const accountId = String((req.body as { accountId?: unknown })?.accountId ?? "").trim();
    const network = String((req.body as { network?: unknown })?.network ?? "").trim();
    const walletSource = String((req.body as { walletSource?: unknown })?.walletSource ?? "").trim();
    const evmAddressRaw = String((req.body as { evmAddress?: unknown })?.evmAddress ?? "").trim();

    if (!hederaAccountRegex(accountId)) {
      return res.status(400).json({ error: "accountId must be a Hedera account id (0.0.x)" });
    }
    if (walletSource !== "metamask") {
      return res.status(400).json({ error: "JudgeBuddy treasury auth currently requires MetaMask." });
    }
    if (network !== "testnet") {
      return res.status(400).json({ error: "network must be testnet" });
    }

    let evmAddress: string;
    try {
      evmAddress = getAddress(evmAddressRaw);
    } catch {
      return res.status(400).json({ error: "evmAddress must be a valid EVM address." });
    }

    const mirrorEvmAddress = await mirrorAccountEvm(accountId);
    if (!mirrorEvmAddress || !addrEq(mirrorEvmAddress, evmAddress)) {
      return res.status(400).json({
        error: "The supplied MetaMask address does not match the Hedera account's mirror evm_address.",
      });
    }

    const now = Date.now();
    const challenge: AuthChallenge = {
      challengeId: randomUUID(),
      nonce: randomBytes(16).toString("hex"),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + AUTH_CHALLENGE_TTL_MS).toISOString(),
      expiresAtMs: now + AUTH_CHALLENGE_TTL_MS,
      used: false,
      accountId,
      evmAddress,
      walletSource: "metamask",
      network: "testnet",
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
    const signature = String((req.body as { signature?: unknown })?.signature ?? "").trim();
    const signedPayload = String((req.body as { signedPayload?: unknown })?.signedPayload ?? "");

    if (!challengeId || !signature || !signedPayload) {
      return res.status(400).json({ error: "challengeId, signature, and signedPayload are required." });
    }

    const challenge = authChallenges.get(challengeId);
    if (!challenge || challenge.used || challenge.expiresAtMs <= Date.now()) {
      return res.status(400).json({ error: "Challenge missing or expired." });
    }

    const expectedPayload = buildAuthSignedMessage({
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
      accountId: challenge.accountId,
      evmAddress: challenge.evmAddress,
      walletSource: challenge.walletSource,
      network: challenge.network,
    });

    if (signedPayload !== expectedPayload) {
      authChallenges.delete(challengeId);
      return res.status(400).json({ error: "Signed payload mismatch." });
    }

    let recovered: string;
    try {
      recovered = verifyMessage(expectedPayload, signature);
    } catch {
      authChallenges.delete(challengeId);
      return res.status(401).json({ error: "Invalid MetaMask signature." });
    }

    if (!addrEq(recovered, challenge.evmAddress)) {
      authChallenges.delete(challengeId);
      return res.status(401).json({ error: "Recovered signer does not match the requested wallet." });
    }

    challenge.used = true;
    authChallenges.set(challengeId, challenge);

    const user: AuthenticatedUser = {
      accountId: challenge.accountId,
      walletSource: "metamask",
      network: challenge.network,
      evmAddress: challenge.evmAddress,
    };
    const token = randomBytes(32).toString("hex");
    const expiresAtMs = Date.now() + AUTH_SESSION_TTL_MS;
    authSessions.set(token, { token, user, expiresAtMs });
    authChallenges.delete(challengeId);
    setSessionCookie(res, token, expiresAtMs);

    res.json({
      authenticated: true,
      user,
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  });

  app.get("/auth/session", (req, res) => {
    const session = getSessionFromRequest(req);
    if (!session) {
      clearSessionCookie(res);
      return res.json({ authenticated: false });
    }
    res.json({ authenticated: true, user: session.user });
  });

  app.post("/auth/logout", (req, res) => {
    const token = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE_NAME];
    if (token) authSessions.delete(token);
    clearSessionCookie(res);
    res.status(204).end();
  });

  app.get("/hackathons", async (_req, res) => {
    res.json(await listHackathons());
  });

  app.get("/hackathons/:id", async (req, res) => {
    const hackathon = await getHackathon(req.params.id);
    if (!hackathon) return res.status(404).json({ error: "Hackathon not found." });
    res.json(hackathon);
  });

  app.post("/hackathons", async (req, res) => {
    const session = requireAuthSession(req, res);
    if (!session) return;
    try {
      const input = parseBody(createHackathonRequestSchema, req.body);
      if (session.user.accountId !== input.organizerAccountId || !addrEq(session.user.evmAddress, input.organizerEvmAddress)) {
        return res.status(403).json({ error: "The signed-in organizer does not match the request payload." });
      }
      const hackathon = await createHackathon(input);
      await recordEvent({
        scope: "hackathon",
        source: "api",
        type: "hackathon.created",
        actor: session.user.evmAddress,
        hackathonId: hackathon.id,
        submissionId: null,
        awardId: null,
        claimId: null,
        txHash: null,
        payload: hackathon,
      });
      await appendAudit({
        type: "hackathon.created",
        hackathonId: hackathon.id,
        payload: {
          organizer: session.user.evmAddress,
          tracks: hackathon.tracks.map((track: HackathonRecord["tracks"][number]) => ({ id: track.id, amount: track.prizeAmount })),
        },
      });
      res.status(201).json(hackathon);
    } catch (error) {
      res.status(400).json({ error: readErrorMessage(error) });
    }
  });

  app.post("/hackathons/:id/fund", async (req, res) => {
    const session = requireAuthSession(req, res);
    if (!session) return;
    try {
      const input = parseBody(fundHackathonRequestSchema, req.body);
      const hackathon = await getHackathon(req.params.id);
      if (!hackathon) return res.status(404).json({ error: "Hackathon not found." });
      if (!addrEq(session.user.evmAddress, hackathon.organizerEvmAddress)) {
        return res.status(403).json({ error: "Only the configured organizer can sync treasury funding." });
      }
      const { deposits } = await parseFundingReceipt(hackathon, input.txHash, session.user.evmAddress);
      await markHackathonFunded({
        hackathonId: hackathon.id,
        txHash: input.txHash,
        sponsorAccountId: session.user.accountId,
        sponsorEvmAddress: session.user.evmAddress,
        tokenId: hackathon.payoutTokenId,
        deposits,
      });
      await recordEvent({
        scope: "hackathon",
        source: "chain",
        type: "hackathon.funded",
        actor: session.user.evmAddress,
        hackathonId: hackathon.id,
        submissionId: null,
        awardId: null,
        claimId: null,
        txHash: input.txHash,
        payload: { deposits },
      });
      await appendAudit({
        type: "hackathon.funded",
        hackathonId: hackathon.id,
        payload: { txHash: input.txHash, deposits },
      });
      res.status(202).json({ ok: true, txHash: input.txHash, deposits });
    } catch (error) {
      res.status(400).json({ error: readErrorMessage(error) });
    }
  });

  app.get("/submissions", async (req, res) => {
    const hackathonId = String(req.query.hackathonId ?? "").trim();
    if (!hackathonId) {
      return res.status(400).json({ error: "hackathonId query param is required." });
    }
    res.json(await listSubmissions(hackathonId));
  });

  app.get("/submissions/:id", async (req, res) => {
    const submission = await getSubmission(req.params.id);
    if (!submission) return res.status(404).json({ error: "Submission not found." });
    res.json(submission);
  });

  app.post("/submissions", async (req, res) => {
    const session = requireAuthSession(req, res);
    if (!session) return;
    try {
      const input = parseBody(createSubmissionRequestSchema, req.body);
      if (session.user.accountId !== input.payoutAccountId || !addrEq(session.user.evmAddress, input.payoutEvmAddress)) {
        return res.status(403).json({ error: "Submission payout wallet must match the signed-in MetaMask user." });
      }
      const hackathon = await getHackathon(input.hackathonId);
      if (!hackathon) return res.status(404).json({ error: "Hackathon not found." });
      const submission = await createSubmission(input);
      await enqueueJob("register_submission", { submissionId: submission.id });
      await recordEvent({
        scope: "submission",
        source: "api",
        type: "submission.created",
        actor: session.user.evmAddress,
        hackathonId: submission.hackathonId,
        submissionId: submission.id,
        awardId: null,
        claimId: null,
        txHash: null,
        payload: submission,
      });
      await appendAudit({
        type: "submission.created",
        hackathonId: submission.hackathonId,
        submissionId: submission.id,
        payload: {
          githubUrl: submission.githubUrl,
          payoutEvmAddress: submission.payoutEvmAddress,
          trackId: submission.trackId,
        },
      });
      res.status(201).json(submission);
    } catch (error) {
      res.status(400).json({ error: readErrorMessage(error) });
    }
  });

  app.post("/submissions/:id/evaluate", async (req, res) => {
    const session = requireAuthSession(req, res);
    if (!session) return;
    try {
      const submission = await getSubmission(req.params.id);
      if (!submission) return res.status(404).json({ error: "Submission not found." });
      const hackathon = await getHackathon(submission.hackathonId);
      if (!hackathon) return res.status(404).json({ error: "Hackathon not found." });
      requireHackathonOperator(session, hackathon);
      const input = parseBody(queueEvaluationRequestSchema, {
        ...(req.body ?? {}),
        submissionId: req.params.id,
      });
      const jobId = await enqueueJob("evaluate_submission", input);
      await recordEvent({
        scope: "job",
        source: "api",
        type: "evaluation.queued",
        actor: session.user.evmAddress,
        hackathonId: submission.hackathonId,
        submissionId: submission.id,
        awardId: null,
        claimId: null,
        txHash: null,
        payload: { jobId, force: input.force },
      });
      res.status(202).json({ jobId });
    } catch (error) {
      res.status(400).json({ error: readErrorMessage(error) });
    }
  });

  app.get("/approvals", async (req, res) => {
    const hackathonId = typeof req.query.hackathonId === "string" ? req.query.hackathonId : undefined;
    res.json(await listApprovalRequests(hackathonId));
  });

  app.post("/awards/:id/approve", async (req, res) => {
    const session = requireAuthSession(req, res);
    if (!session) return;
    try {
      const input = parseBody(approveAwardRequestSchema, req.body);
      if (req.params.id !== input.approval.awardId) {
        return res.status(400).json({ error: "Route award id does not match the signed approval payload." });
      }

      const award = await getAwardProposal(req.params.id);
      if (!award) return res.status(404).json({ error: "Award proposal not found." });
      const approvalRequest = await getApprovalRequestByAwardId(award.id);
      if (!approvalRequest) return res.status(404).json({ error: "Approval request not found." });
      if (approvalRequest.status !== "pending") {
        return res.status(409).json({ error: `Approval request is already ${approvalRequest.status}.` });
      }
      if (!addrEq(session.user.evmAddress, approvalRequest.signerEvmAddress)) {
        return res.status(403).json({ error: "The connected MetaMask account is not the required policy signer." });
      }

      const currentPayload = buildAwardApprovalPayload(award, approvalRequest);
      if (JSON.stringify(currentPayload) !== JSON.stringify(input.approval)) {
        return res.status(409).json({ error: "The award changed after the approval digest was generated. Refresh the queue and sign again." });
      }

      const typedData = buildTreasuryTypedData("approve_award", currentPayload, {
        chainId: 296,
        verifyingContract: TREASURY_CONTRACT_ADDRESS,
      });
      const digest = hashTreasuryTypedData("approve_award", currentPayload, {
        chainId: 296,
        verifyingContract: TREASURY_CONTRACT_ADDRESS,
      });
      if (digest !== approvalRequest.digest) {
        return res.status(409).json({ error: "Stored digest no longer matches the current award payload." });
      }

      const recovered = verifyTypedData(typedData.domain, typedData.types, typedData.message, input.signature);
      if (!addrEq(recovered, approvalRequest.signerEvmAddress)) {
        return res.status(401).json({ error: "Signature does not recover to the required signer address." });
      }

      await markApprovalApproved({
        awardId: award.id,
        signature: input.signature,
        status: "approved",
      });
      await updateAwardProposal({ awardId: award.id, status: "approved", digest });
      const jobId = await enqueueJob("execute_approved_award", { awardId: award.id });
      await recordEvent({
        scope: "award",
        source: "api",
        type: "award.approved",
        actor: session.user.evmAddress,
        hackathonId: award.hackathonId,
        submissionId: award.submissionId,
        awardId: award.id,
        claimId: null,
        txHash: null,
        payload: { approvalId: approvalRequest.id, digest, jobId },
      });
      await appendAudit({
        type: "award.approved",
        hackathonId: award.hackathonId,
        submissionId: award.submissionId,
        awardId: award.id,
        payload: { approvalId: approvalRequest.id, digest, signer: session.user.evmAddress, jobId },
      });
      res.status(202).json({ jobId, digest });
    } catch (error) {
      res.status(400).json({ error: readErrorMessage(error) });
    }
  });

  app.post("/claims/:id/redeem", async (req, res) => {
    const session = requireAuthSession(req, res);
    if (!session) return;
    try {
      parseBody(redeemClaimRequestSchema, { ...(req.body ?? {}), claimId: req.params.id });
      const claim = await getPrizeClaim(req.params.id);
      if (!claim) return res.status(404).json({ error: "Prize claim not found." });
      if (!addrEq(session.user.evmAddress, claim.claimantEvmAddress)) {
        return res.status(403).json({ error: "Only the configured claimant can redeem this prize claim." });
      }
      const jobId = await enqueueJob("redeem_claim", { claimId: claim.id, awardId: claim.awardId });
      await recordEvent({
        scope: "claim",
        source: "api",
        type: "claim.redeem_queued",
        actor: session.user.evmAddress,
        hackathonId: null,
        submissionId: null,
        awardId: claim.awardId,
        claimId: claim.id,
        txHash: null,
        payload: { jobId },
      });
      res.status(202).json({ jobId });
    } catch (error) {
      res.status(400).json({ error: readErrorMessage(error) });
    }
  });

  app.get("/events", async (req, res) => {
    const hackathonId = typeof req.query.hackathonId === "string" ? req.query.hackathonId : null;
    const submissionId = typeof req.query.submissionId === "string" ? req.query.submissionId : null;
    const scope = typeof req.query.scope === "string" ? (req.query.scope as Parameters<typeof listEvents>[0]["scope"]) : null;
    res.json(await listEvents({ hackathonId, submissionId, scope }));
  });

  app.get("/pipeline", async (req, res) => {
    const hackathonId = typeof req.query.hackathonId === "string" ? req.query.hackathonId : null;
    res.json({
      approvals: await listApprovalRequests(hackathonId ?? undefined),
      events: await listEvents({ hackathonId, submissionId: null, scope: null }),
      hcsAudit: await listHcsAuditEvents({ hackathonId, submissionId: null, awardId: null }),
      jobs: await listJobs(),
    });
  });

  app.post("/internal/approval-requests", async (req, res) => {
    try {
      const awardId = String((req.body as { awardId?: unknown })?.awardId ?? "").trim();
      if (!awardId) return res.status(400).json({ error: "awardId is required." });
      const award = await getAwardProposal(awardId);
      if (!award) return res.status(404).json({ error: "Award proposal not found." });
      const hackathon = await getHackathon(award.hackathonId);
      if (!hackathon) return res.status(404).json({ error: "Hackathon not found." });

      const existing = await getApprovalRequestByAwardId(award.id);
      if (existing) return res.status(409).json({ error: "Approval request already exists for this award." });

      const { approvalPayload, typedData, digest, manifest } = await buildApprovalArtifacts(hackathon, award);
      const created = await createApprovalRequest({
        awardId: award.id,
        actionType: "approve_award",
        signerAccountId: hackathon.judgeAccountId,
        signerEvmAddress: hackathon.judgeEvmAddress,
        digest,
        typedData,
        clearSigningManifest: manifest,
        calldata: manifest.calldataPreview,
        expiresAt: new Date(approvalPayload.expiresAt * 1000).toISOString(),
      });
      await updateAwardProposal({ awardId: award.id, status: "awaiting_approval", digest });
      res.status(201).json(created);
    } catch (error) {
      res.status(400).json({ error: readErrorMessage(error) });
    }
  });

  app.post("/internal/jobs/:id/complete", async (req, res) => {
    await completeJob(req.params.id);
    res.status(204).end();
  });

  app.post("/internal/jobs/:id/fail", async (req, res) => {
    const error = String((req.body as { error?: unknown })?.error ?? "unknown worker failure");
    const awardId = String((req.body as { awardId?: unknown })?.awardId ?? "").trim();
    await failJob(req.params.id, error);
    if (awardId) {
      await updateApprovalExecution({ awardId, status: "failed", error });
    }
    res.status(204).end();
  });

  app.get("/internal/jobs/claim", async (req, res) => {
    const workerId = String(req.query.workerId ?? "").trim() || `worker_${randomUUID()}`;
    const job = await claimNextJob(workerId);
    if (!job) return res.status(204).end();
    res.json(job);
  });

  return app;
}
