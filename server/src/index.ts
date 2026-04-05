import cors from "cors";
import express from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { getAddress, id, verifyMessage } from "ethers";
import {
  buildAuthSignedMessage,
  buildAwardApprovalTypedData,
  createHackathonRequestSchema,
  createSubmissionRequestSchema,
  fundHackathonRequestSchema,
  approveAwardRequestSchema,
  type AuthenticatedUser,
  toOnchainId,
} from "../../packages/shared/src/index.js";
import {
  HEDERA_EVM_RPC,
  MIRROR_BASE,
  NETWORK,
  PORT,
  PRIZE_CLAIM_TOKEN_ADDRESS,
  SESSION_COOKIE_NAME,
  TREASURY_CONTRACT_ADDRESS,
} from "./config.js";
import { ensureSchema } from "./db.js";
import { appendHcsAudit } from "./hcs.js";
import {
  createApprovalRequest,
  createHackathon,
  createSubmission,
  enqueueJob,
  getApprovalRequestByAwardId,
  getAwardProposal,
  getHackathon,
  getPrizeClaim,
  getSubmission,
  listApprovalRequests,
  listEvents,
  listHackathons,
  listJobs,
  listPrizeClaims,
  listSubmissions,
  markApprovalApproved,
  markHackathonFunded,
  recordEvent,
  recordHcsAudit,
  updateAwardProposal,
  updateSubmissionStatus,
  upsertPrizeClaim,
} from "./store.js";
import { getTreasuryWriteContract, treasuryInterface, treasuryProvider } from "./treasuryContract.js";

type StoredSession = {
  token: string;
  user: AuthenticatedUser;
  expiresAtMs: number;
};

type AuthChallenge = AuthenticatedUser & {
  challengeId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  expiresAtMs: number;
  used: boolean;
};

const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const authChallenges = new Map<string, AuthChallenge>();
const authSessions = new Map<string, StoredSession>();

function cleanupExpiredAuthState(): void {
  const now = Date.now();
  for (const [id, challenge] of authChallenges.entries()) {
    if (challenge.expiresAtMs <= now || challenge.used) authChallenges.delete(id);
  }
  for (const [token, session] of authSessions.entries()) {
    if (session.expiresAtMs <= now) authSessions.delete(token);
  }
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return acc;
      acc[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
      return acc;
    }, {});
}

function setSessionCookie(res: express.Response, token: string, expiresAtMs: number): void {
  const attrs = [
    "Path=/",
    `Expires=${new Date(expiresAtMs).toUTCString()}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs.join("; ")}`);
}

function clearSessionCookie(res: express.Response): void {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; Expires=${new Date(0).toUTCString()}; HttpOnly; SameSite=Lax`,
  );
}

function getSessionFromRequest(req: express.Request): StoredSession | null {
  cleanupExpiredAuthState();
  const token = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session || session.expiresAtMs <= Date.now()) {
    authSessions.delete(token);
    return null;
  }
  return session;
}

function requireAuthSession(req: express.Request, res: express.Response): StoredSession | null {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Sign in with MetaMask first." });
    return null;
  }
  return session;
}

function sameAccount(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

async function mirrorAccountEvm(accountId: string): Promise<string | null> {
  const response = await fetch(`${MIRROR_BASE}/api/v1/accounts/${accountId}`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { evm_address?: string | null };
  return payload.evm_address ? getAddress(payload.evm_address) : null;
}

async function appendAudit(type: string, payload: Record<string, unknown>) {
  const hcs = await appendHcsAudit({ type, ...payload });
  await recordHcsAudit({
    type,
    hackathonId: typeof payload.hackathonId === "string" ? payload.hackathonId : null,
    submissionId: typeof payload.submissionId === "string" ? payload.submissionId : null,
    awardId: typeof payload.awardId === "string" ? payload.awardId : null,
    txId: hcs.txId,
    topicId: hcs.ok ? "configured" : null,
    sequenceNumber: hcs.sequenceNumber,
    payload,
  });
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    network: NETWORK,
    mirrorBase: MIRROR_BASE,
    hederaEvmRpc: HEDERA_EVM_RPC,
    treasuryContractConfigured: Boolean(TREASURY_CONTRACT_ADDRESS),
    prizeClaimTokenConfigured: Boolean(PRIZE_CLAIM_TOKEN_ADDRESS),
  });
});

app.post("/auth/nonce", async (req, res) => {
  cleanupExpiredAuthState();
  const accountId = String(req.body?.accountId ?? "").trim();
  const evmAddress = String(req.body?.evmAddress ?? "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(accountId)) return res.status(400).json({ error: "accountId must be 0.0.x" });
  if (!/^0x[a-fA-F0-9]{40}$/.test(evmAddress)) return res.status(400).json({ error: "evmAddress is required" });

  const expected = await mirrorAccountEvm(accountId);
  if (!expected || !sameAddress(expected, evmAddress)) {
    return res.status(400).json({ error: "MetaMask EVM address does not match the Hedera account mirror record." });
  }

  const now = Date.now();
  const challenge: AuthChallenge = {
    accountId,
    evmAddress: getAddress(evmAddress),
    walletSource: "metamask",
    network: "testnet",
    challengeId: randomUUID(),
    nonce: randomBytes(16).toString("hex"),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + AUTH_CHALLENGE_TTL_MS).toISOString(),
    expiresAtMs: now + AUTH_CHALLENGE_TTL_MS,
    used: false,
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
  const challengeId = String(req.body?.challengeId ?? "").trim();
  const accountId = String(req.body?.accountId ?? "").trim();
  const evmAddress = String(req.body?.evmAddress ?? "").trim();
  const signature = String(req.body?.signature ?? "").trim();
  const signedPayload = String(req.body?.signedPayload ?? "");
  const challenge = authChallenges.get(challengeId);

  if (!challenge || challenge.used) return res.status(400).json({ error: "Challenge missing or already used." });
  if (!sameAccount(challenge.accountId, accountId) || !sameAddress(challenge.evmAddress, evmAddress)) {
    return res.status(400).json({ error: "Challenge does not match the provided account." });
  }
  if (challenge.expiresAtMs <= Date.now()) {
    authChallenges.delete(challengeId);
    return res.status(400).json({ error: "Challenge expired." });
  }

  const expectedPayload = buildAuthSignedMessage(challenge);
  if (signedPayload !== expectedPayload) {
    authChallenges.delete(challengeId);
    return res.status(400).json({ error: "Signed payload mismatch." });
  }

  const recovered = verifyMessage(signedPayload, signature);
  if (!sameAddress(recovered, evmAddress)) {
    authChallenges.delete(challengeId);
    return res.status(401).json({ error: "Signature recovery failed." });
  }

  challenge.used = true;
  const token = randomBytes(32).toString("hex");
  const expiresAtMs = Date.now() + AUTH_SESSION_TTL_MS;
  authSessions.set(token, { token, user: challenge, expiresAtMs });
  setSessionCookie(res, token, expiresAtMs);

  res.json({
    user: challenge,
    expiresAt: new Date(expiresAtMs).toISOString(),
  });
});

app.get("/auth/session", (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) return res.json({ authenticated: false });
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
  if (!hackathon) return res.status(404).json({ error: "Hackathon not found" });
  const submissions = await listSubmissions(req.params.id);
  const approvals = await listApprovalRequests(req.params.id);
  const claims = await listPrizeClaims(req.params.id);
  res.json({ ...hackathon, submissions, approvals, claims });
});

app.post("/hackathons", async (req, res) => {
  const session = requireAuthSession(req, res);
  if (!session) return;

  const parsed = createHackathonRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!sameAccount(parsed.data.organizerAccountId, session.user.accountId)) {
    return res.status(403).json({ error: "Signed-in organizer account must match organizerAccountId." });
  }
  if (!sameAddress(parsed.data.organizerEvmAddress, session.user.evmAddress)) {
    return res.status(403).json({ error: "Signed-in organizer address must match organizerEvmAddress." });
  }

  const hackathon = await createHackathon(parsed.data);
  await recordEvent({
    scope: "hackathon",
    source: "api",
    type: "hackathon.created",
    actor: session.user.accountId,
    hackathonId: hackathon.id,
    submissionId: null,
    awardId: null,
    claimId: null,
    txHash: null,
    payload: hackathon,
  });
  await appendAudit("hackathon_created", { hackathonId: hackathon.id, organizer: session.user.accountId });
  res.status(201).json(hackathon);
});

app.post("/hackathons/:id/fund", async (req, res) => {
  const session = requireAuthSession(req, res);
  if (!session) return;
  const parsed = fundHackathonRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const hackathon = await getHackathon(req.params.id);
  if (!hackathon) return res.status(404).json({ error: "Hackathon not found" });
  if (!sameAccount(hackathon.organizerAccountId, session.user.accountId)) {
    return res.status(403).json({ error: "Only the organizer can confirm treasury funding." });
  }
  if (!TREASURY_CONTRACT_ADDRESS) {
    return res.status(503).json({ error: "TREASURY_CONTRACT_ADDRESS is not configured" });
  }

  const receipt = await treasuryProvider.getTransactionReceipt(parsed.data.txHash);
  if (!receipt) return res.status(404).json({ error: "Transaction receipt not found" });

  const trackIdsByHash = new Map<string, string>();
  for (const track of hackathon.tracks) {
    trackIdsByHash.set(id(track.id), track.id);
  }
  const expectedHackathonId = id(hackathon.id);
  const deposits: Array<{ trackId: string; amount: string }> = [];
  let createdSeen = false;

  for (const log of receipt.logs) {
    if (!sameAddress(log.address, TREASURY_CONTRACT_ADDRESS)) continue;
    try {
      const parsedLog = treasuryInterface.parseLog(log);
      if (!parsedLog) continue;
      if (parsedLog.name === "HackathonCreated" && parsedLog.args.hackathonId === expectedHackathonId) {
        createdSeen = true;
      }
      if (parsedLog.name === "TreasuryFunded" && parsedLog.args.hackathonId === expectedHackathonId) {
        const trackId = trackIdsByHash.get(parsedLog.args.trackId);
        if (trackId) deposits.push({ trackId, amount: parsedLog.args.amount.toString() });
      }
    } catch {
      // ignore unrelated logs
    }
  }

  if (!createdSeen || deposits.length === 0) {
    return res.status(409).json({ error: "Transaction does not contain the expected treasury bootstrap events." });
  }

  await markHackathonFunded({
    hackathonId: hackathon.id,
    txHash: parsed.data.txHash,
    sponsorAccountId: session.user.accountId,
    sponsorEvmAddress: session.user.evmAddress,
    tokenId: hackathon.payoutTokenId,
    deposits,
  });
  await recordEvent({
    scope: "hackathon",
    source: "chain",
    type: "treasury.funded",
    actor: session.user.accountId,
    hackathonId: hackathon.id,
    submissionId: null,
    awardId: null,
    claimId: null,
    txHash: parsed.data.txHash,
    payload: { deposits },
  });
  await appendAudit("treasury_funded", { hackathonId: hackathon.id, txHash: parsed.data.txHash, deposits });
  res.json({ ok: true, txHash: parsed.data.txHash, deposits });
});

app.get("/submissions", async (req, res) => {
  const hackathonId = String(req.query.h ?? "").trim();
  if (!hackathonId) return res.status(400).json({ error: "h query param is required" });
  res.json(await listSubmissions(hackathonId));
});

app.post("/submissions", async (req, res) => {
  const parsed = createSubmissionRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const submission = await createSubmission(parsed.data);
  const jobId = await enqueueJob("evaluate_submission", { submissionId: submission.id });
  await recordEvent({
    scope: "submission",
    source: "api",
    type: "submission.created",
    actor: parsed.data.teamName,
    hackathonId: submission.hackathonId,
    submissionId: submission.id,
    awardId: null,
    claimId: null,
    txHash: null,
    payload: { jobId },
  });
  await appendAudit("submission_created", { hackathonId: submission.hackathonId, submissionId: submission.id });
  res.status(201).json({ submission, jobId });
});

app.get("/submissions/:id", async (req, res) => {
  const submission = await getSubmission(req.params.id);
  if (!submission) return res.status(404).json({ error: "Submission not found" });
  res.json(submission);
});

app.post("/submissions/:id/evaluate", async (req, res) => {
  const submission = await getSubmission(req.params.id);
  if (!submission) return res.status(404).json({ error: "Submission not found" });
  const jobId = await enqueueJob("evaluate_submission", { submissionId: submission.id, force: Boolean(req.body?.force) });
  await recordEvent({
    scope: "job",
    source: "api",
    type: "evaluation.queued",
    actor: "api",
    hackathonId: submission.hackathonId,
    submissionId: submission.id,
    awardId: null,
    claimId: null,
    txHash: null,
    payload: { jobId },
  });
  res.status(202).json({ ok: true, jobId });
});

app.get("/approvals", async (req, res) => {
  res.json(await listApprovalRequests(String(req.query.h ?? "").trim() || undefined));
});

app.post("/awards/:id/approve", async (req, res) => {
  const session = requireAuthSession(req, res);
  if (!session) return;
  const parsed = approveAwardRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const award = await getAwardProposal(req.params.id);
  if (!award) return res.status(404).json({ error: "Award not found" });
  const hackathon = await getHackathon(award.hackathonId);
  if (!hackathon) return res.status(404).json({ error: "Hackathon not found" });
  const approvalRequest = await getApprovalRequestByAwardId(award.id);
  if (!approvalRequest) return res.status(404).json({ error: "Approval request not found" });

  if (!sameAccount(hackathon.judgeAccountId, session.user.accountId) || !sameAddress(hackathon.judgeEvmAddress, session.user.evmAddress)) {
    return res.status(403).json({ error: "Only the configured judge can approve this award." });
  }

  if (!TREASURY_CONTRACT_ADDRESS) {
    return res.status(503).json({ error: "TREASURY_CONTRACT_ADDRESS is not configured" });
  }

  const typedData = buildAwardApprovalTypedData({
    chainId: 296,
    verifyingContract: TREASURY_CONTRACT_ADDRESS,
    approval: {
      awardId: toOnchainId(parsed.data.approval.awardId),
      hackathonId: toOnchainId(parsed.data.approval.hackathonId),
      submissionId: toOnchainId(parsed.data.approval.submissionId),
      trackId: toOnchainId(parsed.data.approval.trackId),
      winner: parsed.data.approval.winner,
      amount: parsed.data.approval.amount,
      settlementMode: parsed.data.approval.settlementMode,
      expiresAt: parsed.data.approval.expiresAt,
    },
  });

  if (approvalRequest.typedData.digest !== typedData.digest || award.digest !== typedData.digest) {
    return res.status(409).json({ error: "Approval digest mismatch; the award proposal changed after the request was issued." });
  }

  const treasury = getTreasuryWriteContract();
  const tx = await treasury.executeApprovedAward(
    {
      awardId: typedData.value.awardId,
      hackathonId: typedData.value.hackathonId,
      submissionId: typedData.value.submissionId,
      trackId: typedData.value.trackId,
      winner: typedData.value.winner,
      amount: typedData.value.amount,
      settlementMode: typedData.value.settlementMode,
      expiresAt: typedData.value.expiresAt,
    },
    parsed.data.signature,
  );
  const receipt = await tx.wait();

  let mintedSerial: string | null = null;
  for (const log of receipt?.logs ?? []) {
    if (!sameAddress(log.address, TREASURY_CONTRACT_ADDRESS)) continue;
    try {
      const parsedLog = treasuryInterface.parseLog(log);
      if (!parsedLog) continue;
      if (parsedLog.name === "ClaimMinted") {
        mintedSerial = parsedLog.args.serialNumber.toString();
      }
    } catch {
      // ignore unrelated logs
    }
  }

  const nextStatus = parsed.data.approval.settlementMode === "claim_token" ? "claim_minted" : "paid_out";
  await markApprovalApproved({ awardId: award.id, signature: parsed.data.signature, status: "executed" });
  await updateAwardProposal({ id: award.id, status: nextStatus, txHash: receipt?.hash ?? tx.hash });
  if (nextStatus === "paid_out") {
    await updateSubmissionStatus(award.submissionId, "paid");
  } else {
    await upsertPrizeClaim({
      awardId: award.id,
      claimantAccountId: award.winnerAccountId,
      claimantEvmAddress: award.winnerEvmAddress,
      tokenAddress: PRIZE_CLAIM_TOKEN_ADDRESS || null,
      serialNumber: mintedSerial,
      metadataURI: `jb://claim/${award.id}`,
      status: "minted",
      mintedTxHash: receipt?.hash ?? tx.hash,
    });
  }

  await recordEvent({
    scope: "award",
    source: "chain",
    type: "award.approved",
    actor: session.user.accountId,
    hackathonId: award.hackathonId,
    submissionId: award.submissionId,
    awardId: award.id,
    claimId: nextStatus === "claim_minted" ? award.id : null,
    txHash: receipt?.hash ?? tx.hash,
    payload: { settlementMode: parsed.data.approval.settlementMode, digest: typedData.digest },
  });
  await appendAudit("award_approved", {
    hackathonId: award.hackathonId,
    submissionId: award.submissionId,
    awardId: award.id,
    txHash: receipt?.hash ?? tx.hash,
  });
  res.json({ ok: true, txHash: receipt?.hash ?? tx.hash, status: nextStatus });
});

app.get("/claims", async (req, res) => {
  res.json(await listPrizeClaims(String(req.query.h ?? "").trim() || undefined));
});

app.post("/claims/:id/redeem", async (req, res) => {
  const session = requireAuthSession(req, res);
  if (!session) return;
  if (!TREASURY_CONTRACT_ADDRESS) {
    return res.status(503).json({ error: "TREASURY_CONTRACT_ADDRESS is not configured" });
  }
  const claim = await getPrizeClaim(req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found" });
  const award = await getAwardProposal(claim.awardId);
  if (!award) return res.status(404).json({ error: "Award not found" });
  if (!sameAccount(claim.claimantAccountId, session.user.accountId)) {
    return res.status(403).json({ error: "Only the claimant can redeem this claim." });
  }

  const treasury = getTreasuryWriteContract();
  const tx = await treasury.redeemClaim(id(claim.id));
  const receipt = await tx.wait();

  await upsertPrizeClaim({
    awardId: claim.id,
    claimantAccountId: claim.claimantAccountId,
    claimantEvmAddress: claim.claimantEvmAddress,
    tokenAddress: claim.tokenAddress,
    serialNumber: claim.serialNumber,
    metadataURI: claim.metadataURI,
    status: "redeemed",
    mintedTxHash: claim.mintedTxHash,
    redeemedTxHash: receipt?.hash ?? tx.hash,
  });
  await updateAwardProposal({ id: award.id, status: "redeemed", txHash: receipt?.hash ?? tx.hash });
  await updateSubmissionStatus(award.submissionId, "paid");
  await recordEvent({
    scope: "claim",
    source: "chain",
    type: "claim.redeemed",
    actor: session.user.accountId,
    hackathonId: award.hackathonId,
    submissionId: award.submissionId,
    awardId: award.id,
    claimId: claim.id,
    txHash: receipt?.hash ?? tx.hash,
    payload: {},
  });
  await appendAudit("claim_redeemed", {
    hackathonId: award.hackathonId,
    submissionId: award.submissionId,
    awardId: award.id,
    txHash: receipt?.hash ?? tx.hash,
  });
  res.json({ ok: true, txHash: receipt?.hash ?? tx.hash });
});

app.get("/jobs", async (_req, res) => {
  res.json(await listJobs());
});

app.get("/events", async (req, res) => {
  res.json(
    await listEvents({
      hackathonId: String(req.query.h ?? "").trim() || undefined,
      submissionId: String(req.query.s ?? "").trim() || undefined,
      scope: (String(req.query.scope ?? "").trim() || undefined) as any,
    }),
  );
});

app.post("/events/naryo", async (req, res) => {
  const items = Array.isArray(req.body?.events) ? req.body.events : Array.isArray(req.body) ? req.body : [req.body];
  for (const item of items) {
    await recordEvent({
      scope: "system",
      source: "naryo",
      type: String(item?.eventName ?? item?.type ?? "naryo.event"),
      actor: null,
      hackathonId: typeof item?.hackathonId === "string" ? item.hackathonId : null,
      submissionId: typeof item?.submissionId === "string" ? item.submissionId : null,
      awardId: typeof item?.awardId === "string" ? item.awardId : null,
      claimId: typeof item?.claimId === "string" ? item.claimId : null,
      txHash: typeof item?.transactionHash === "string" ? item.transactionHash : null,
      payload: item ?? {},
    });
  }
  res.status(202).json({ accepted: items.length });
});

async function main() {
  await ensureSchema();
  app.listen(PORT, () => {
    console.log(`JudgeBuddy API listening on http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
