import { keccak256, toUtf8Bytes } from "ethers";
import { buildClearSigningManifest, validateClearSigningManifest } from "../../packages/ledger-clear-signing/src/index.js";
import {
  buildTreasuryTypedData,
  hashTreasuryTypedData,
  toOnchainId,
  type AwardProposal,
} from "../../packages/shared/src/index.js";
import { WORKER_POLL_INTERVAL_MS } from "../../server/src/config.js";
import { ensureSchema } from "../../server/src/db.js";
import { appendHcsAudit } from "../../server/src/hcs.js";
import {
  claimNextJob,
  completeJob,
  createApprovalRequest,
  createAwardProposal,
  failJob,
  getApprovalRequestByAwardId,
  getAwardProposal,
  getHackathon,
  getLatestTrackAward,
  getPrizeClaim,
  getSubmission,
  recordEvent,
  recordHcsAudit,
  replaceLatestEvaluationRun,
  updateApprovalExecution,
  updateAwardProposal,
  updateSubmissionStatus,
  upsertPrizeClaim,
} from "../../server/src/store.js";
import { getTreasuryWriteContract, hashRepo, treasuryInterface } from "../../server/src/treasuryContract.js";

type RepositoryInfo = {
  exists: boolean;
  publicRepo: boolean;
  hasReadme: boolean;
  hasTests: boolean;
  rootEntries: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function evidenceHash(payload: Record<string, unknown>): `0x${string}` {
  return keccak256(toUtf8Bytes(JSON.stringify(payload))) as `0x${string}`;
}

function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const [owner, repo] = parsed.pathname.replace(/^\/+/, "").split("/");
    if (!owner || !repo) return null;
    return { owner, repo: repo.replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

async function fetchRepositoryInfo(githubUrl: string): Promise<RepositoryInfo> {
  const repo = parseGithubRepo(githubUrl);
  if (!repo) {
    return { exists: false, publicRepo: false, hasReadme: false, hasTests: false, rootEntries: [] };
  }

  const repoResponse = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!repoResponse.ok) {
    return { exists: false, publicRepo: false, hasReadme: false, hasTests: false, rootEntries: [] };
  }
  const repoPayload = (await repoResponse.json()) as { private?: boolean; default_branch?: string };

  const contentsResponse = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  const entries = contentsResponse.ok
    ? ((await contentsResponse.json()) as Array<{ name?: string }>).map((entry) => entry.name ?? "").filter(Boolean)
    : [];

  const hasReadme = entries.some((entry) => /^readme/i.test(entry));
  const hasTests = entries.some((entry) => /(^|[-_])(test|tests|spec|specs)$/i.test(entry) || /playwright|vitest|jest/i.test(entry));

  return {
    exists: true,
    publicRepo: repoPayload.private === false,
    hasReadme,
    hasTests,
    rootEntries: entries,
  };
}

async function urlIsReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "follow" });
    return response.ok;
  } catch {
    return false;
  }
}

async function verifyHashscan(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  return urlIsReachable(url);
}

async function registerSubmissionJob(submissionId: string): Promise<void> {
  const submission = await getSubmission(submissionId);
  if (!submission) throw new Error(`Submission ${submissionId} not found.`);
  const hackathon = await getHackathon(submission.hackathonId);
  if (!hackathon) throw new Error(`Hackathon ${submission.hackathonId} not found.`);

  const treasury = getTreasuryWriteContract();
  const tx = await treasury.registerSubmission(
    toOnchainId(submission.id),
    toOnchainId(submission.hackathonId),
    toOnchainId(submission.trackId),
    submission.payoutEvmAddress,
    hashRepo(submission.githubUrl),
  );
  const receipt = await tx.wait();

  await recordEvent({
    scope: "submission",
    source: "chain",
    type: "submission.registered",
    actor: null,
    hackathonId: submission.hackathonId,
    submissionId: submission.id,
    awardId: null,
    claimId: null,
    txHash: receipt?.hash ?? tx.hash,
    payload: { payoutEvmAddress: submission.payoutEvmAddress },
  });

  const audit = await appendHcsAudit({
    type: "submission.registered",
    submissionId: submission.id,
    hackathonId: submission.hackathonId,
    txHash: receipt?.hash ?? tx.hash,
  });
  await recordHcsAudit({
    type: "submission.registered",
    hackathonId: submission.hackathonId,
    submissionId: submission.id,
    awardId: null,
    txId: audit.txId,
    topicId: null,
    sequenceNumber: audit.sequenceNumber,
    payload: {
      txHash: receipt?.hash ?? tx.hash,
      hcs: {
        ok: audit.ok,
        txId: audit.txId,
        sequenceNumber: audit.sequenceNumber,
        reason: audit.reason ?? null,
      },
    },
  });
}

async function evaluateSubmissionJob(submissionId: string): Promise<void> {
  const submission = await getSubmission(submissionId);
  if (!submission) throw new Error(`Submission ${submissionId} not found.`);
  const hackathon = await getHackathon(submission.hackathonId);
  if (!hackathon) throw new Error(`Hackathon ${submission.hackathonId} not found.`);
  const track = hackathon.tracks.find((item) => item.id === submission.trackId);
  if (!track) throw new Error(`Track ${submission.trackId} not found.`);

  const repo = await fetchRepositoryInfo(submission.githubUrl);
  const demoReachable = await urlIsReachable(submission.demoUrl);
  const contractChecks = await Promise.all(
    submission.deployedContracts.map((contract: { hashscanUrl?: string }) => verifyHashscan(contract.hashscanUrl)),
  );
  const hashscanVerified = contractChecks.every(Boolean);

  const eligibility = {
    repoExists: repo.exists,
    publicRepo: repo.publicRepo,
    hasReadme: repo.hasReadme,
    demoReachable,
    hashscanVerified,
    passed:
      repo.exists &&
      (!track.evaluationPolicy.requiresPublicRepo || repo.publicRepo) &&
      (!track.evaluationPolicy.requiresReadme || repo.hasReadme) &&
      (!track.evaluationPolicy.requiresDemo || demoReachable) &&
      (!track.evaluationPolicy.requiresHashscanVerification || hashscanVerified),
  };
  await replaceLatestEvaluationRun({
    submissionId,
    agentRole: "eligibility",
    status: "completed",
    result: eligibility,
    model: "deterministic:network-checks",
  });

  const normalizedText = `${submission.projectName} ${submission.description}`.toLowerCase();
  const requirementHits = track.requirements.filter((requirement: string) =>
    normalizedText.includes(requirement.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim()),
  );
  const trackFit = {
    requirementHits,
    totalRequirements: track.requirements.length,
    fit:
      requirementHits.length >= Math.max(1, Math.ceil(track.requirements.length / 2))
        ? "high"
        : requirementHits.length > 0
          ? "medium"
          : "low",
    passed: requirementHits.length > 0 || track.requirements.length === 0,
  };
  await replaceLatestEvaluationRun({
    submissionId,
    agentRole: "track-fit",
    status: "completed",
    result: trackFit,
    model: "deterministic:requirement-match",
  });

  const qualityScore =
    (repo.hasReadme ? 20 : 0) +
    (repo.hasTests ? 20 : 0) +
    (submission.deployedContracts.length > 0 ? 20 : 0) +
    (demoReachable ? 20 : 0) +
    Math.min(20, requirementHits.length * 10);
  const quality = {
    score: qualityScore,
    hasTests: repo.hasTests,
    rootEntries: repo.rootEntries.slice(0, 15),
    noveltySignals: requirementHits,
  };
  await replaceLatestEvaluationRun({
    submissionId,
    agentRole: "quality",
    status: "completed",
    result: quality,
    model: "deterministic:repo-heuristics",
  });

  const treasury = getTreasuryWriteContract();
  const evaluationEvidence = evidenceHash({
    eligibility,
    trackFit,
    quality,
  });
  const recordEvaluationTx = await treasury.recordEvaluation(
    toOnchainId(submission.id),
    eligibility.passed,
    qualityScore,
    evaluationEvidence,
  );
  const evaluationReceipt = await recordEvaluationTx.wait();
  await recordEvent({
    scope: "submission",
    source: "chain",
    type: "evaluation.finalized",
    actor: null,
    hackathonId: submission.hackathonId,
    submissionId: submission.id,
    awardId: null,
    claimId: null,
    txHash: evaluationReceipt?.hash ?? recordEvaluationTx.hash,
    payload: { eligibility, trackFit, quality },
  });

  if (!eligibility.passed || !trackFit.passed || qualityScore < track.evaluationPolicy.minQualityScore) {
    await updateSubmissionStatus(submission.id, eligibility.passed ? "evaluated" : "ineligible");
    await replaceLatestEvaluationRun({
      submissionId,
      agentRole: "treasury",
      status: "completed",
      result: { action: "skip", reason: "submission did not satisfy award threshold" },
      model: "deterministic:treasury-policy",
    });
    return;
  }

  const existingTrackAward = await getLatestTrackAward(submission.hackathonId, submission.trackId);
  if (existingTrackAward && existingTrackAward.status !== "failed") {
    await replaceLatestEvaluationRun({
      submissionId,
      agentRole: "treasury",
      status: "completed",
      result: { action: "skip", reason: `track already has active award ${existingTrackAward.id}` },
      model: "deterministic:treasury-policy",
    });
    await updateSubmissionStatus(submission.id, "evaluated");
    return;
  }

  const amount = track.prizeAmount;
  const settlementMode =
    BigInt(amount) > BigInt(hackathon.autonomousThreshold) ? "claim_token" : "autonomous_payout";

  const award = await createAwardProposal({
    hackathonId: submission.hackathonId,
    submissionId: submission.id,
    trackId: submission.trackId,
    winnerAccountId: submission.payoutAccountId,
    winnerEvmAddress: submission.payoutEvmAddress,
    amount,
    settlementMode,
    status: settlementMode === "claim_token" ? "awaiting_approval" : "recommended",
    reason: `Eligibility passed, quality ${qualityScore}, requirements hit ${requirementHits.length}/${track.requirements.length}.`,
    machinePolicy: {
      autonomousThreshold: hackathon.autonomousThreshold,
      qualityScore,
      minimumQuality: track.evaluationPolicy.minQualityScore,
    },
  });

  const proposeEvidence = evidenceHash({
    awardId: award.id,
    reason: award.reason,
    settlementMode,
  });
  const proposeAwardTx = await treasury.proposeAward(
    toOnchainId(award.id),
    toOnchainId(submission.id),
    submission.payoutEvmAddress,
    BigInt(amount),
    settlementMode === "claim_token" ? 1 : 0,
    proposeEvidence,
  );
  const proposeReceipt = await proposeAwardTx.wait();
  await updateAwardProposal({
    awardId: award.id,
    status: settlementMode === "claim_token" ? "awaiting_approval" : "recommended",
    txHash: proposeReceipt?.hash ?? proposeAwardTx.hash,
  });

  if (settlementMode === "claim_token") {
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
      verifyingContract: (await treasury.getAddress()) as string,
    });
    const digest = hashTreasuryTypedData("approve_award", approvalPayload, {
      chainId: 296,
      verifyingContract: (await treasury.getAddress()) as string,
    });
    const manifest = buildClearSigningManifest({
      action: "approve_award",
      chainId: 296,
      contractAddress: await treasury.getAddress(),
      payload: approvalPayload,
    });
    const validation = validateClearSigningManifest(manifest);
    if (!validation.ok) {
      throw new Error(`Clear-signing manifest validation failed: ${validation.errors.join(", ")}`);
    }

    await createApprovalRequest({
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

    await replaceLatestEvaluationRun({
      submissionId,
      agentRole: "treasury",
      status: "completed",
      result: {
        action: "awaiting_approval",
        awardId: award.id,
        digest,
        signer: hackathon.judgeEvmAddress,
      },
      model: "deterministic:treasury-policy",
    });
    await replaceLatestEvaluationRun({
      submissionId,
      agentRole: "policy-explainer",
      status: "completed",
      result: {
        summary: manifest.summary,
        digest,
        functionName: manifest.functionName,
        claimMetadata: manifest.claimMetadata ?? null,
      },
      model: "deterministic:clear-signing-manifest",
    });

    await recordEvent({
      scope: "award",
      source: "worker",
      type: "award.awaiting_approval",
      actor: null,
      hackathonId: award.hackathonId,
      submissionId: award.submissionId,
      awardId: award.id,
      claimId: null,
      txHash: proposeReceipt?.hash ?? proposeAwardTx.hash,
      payload: {
        digest,
        signer: hackathon.judgeEvmAddress,
        summary: manifest.summary,
      },
    });
    await updateSubmissionStatus(submission.id, "awarded");
    return;
  }

  const executeTx = await treasury.executeAutonomousPayout(toOnchainId(award.id));
  const executeReceipt = await executeTx.wait();
  await updateAwardProposal({
    awardId: award.id,
    status: "paid_out",
    txHash: executeReceipt?.hash ?? executeTx.hash,
  });
  await replaceLatestEvaluationRun({
    submissionId,
    agentRole: "treasury",
    status: "completed",
    result: {
      action: "autonomous_payout",
      txHash: executeReceipt?.hash ?? executeTx.hash,
    },
    model: "deterministic:treasury-policy",
  });
  await replaceLatestEvaluationRun({
    submissionId,
    agentRole: "policy-explainer",
    status: "completed",
    result: {
      summary: `Autonomous payout executed for ${award.amount} units to ${award.winnerEvmAddress}.`,
      txHash: executeReceipt?.hash ?? executeTx.hash,
    },
    model: "deterministic:clear-signing-manifest",
  });
  await updateSubmissionStatus(submission.id, "paid");
}

async function executeApprovedAwardJob(awardId: string): Promise<void> {
  const award = await getAwardProposal(awardId);
  if (!award) throw new Error(`Award ${awardId} not found.`);
  const approval = await getApprovalRequestByAwardId(awardId);
  if (!approval || !approval.signature) throw new Error(`Approved signature for award ${awardId} not found.`);

  const payload = {
    awardId: award.id,
    hackathonId: award.hackathonId,
    submissionId: award.submissionId,
    trackId: award.trackId,
    winner: award.winnerEvmAddress,
    amount: award.amount,
    settlementMode: award.settlementMode,
    expiresAt: Math.floor(new Date(approval.expiresAt).getTime() / 1000),
  } as const;

  const treasury = getTreasuryWriteContract();
  const tx = await treasury.executeApprovedAward(
    {
      awardId: toOnchainId(payload.awardId),
      hackathonId: toOnchainId(payload.hackathonId),
      submissionId: toOnchainId(payload.submissionId),
      trackId: toOnchainId(payload.trackId),
      winner: payload.winner,
      amount: BigInt(payload.amount),
      settlementMode: payload.settlementMode === "claim_token" ? 1 : 0,
      expiresAt: BigInt(payload.expiresAt),
    },
    approval.signature,
  );
  const receipt = await tx.wait();

  let nextStatus: AwardProposal["status"] = "paid_out";
  let claimRecord: {
    tokenAddress: string | null;
    serialNumber: string | null;
    metadataURI: string | null;
  } = { tokenAddress: null, serialNumber: null, metadataURI: null };

  for (const log of receipt?.logs ?? []) {
    let parsed: ReturnType<typeof treasuryInterface.parseLog> | null = null;
    try {
      parsed = treasuryInterface.parseLog(log);
    } catch {
      parsed = null;
    }
    if (!parsed) continue;
    if (parsed.name === "ClaimMinted") {
      nextStatus = "claim_minted";
      claimRecord = {
        tokenAddress: parsed.args.claimToken,
        serialNumber: parsed.args.serialNumber.toString(),
        metadataURI: parsed.args.metadataURI,
      };
    }
  }

  await updateAwardProposal({ awardId, status: nextStatus, txHash: receipt?.hash ?? tx.hash });
  await updateApprovalExecution({
    awardId,
    status: "executed",
    executionTxHash: receipt?.hash ?? tx.hash,
  });

  if (nextStatus === "claim_minted") {
    await upsertPrizeClaim({
      awardId,
      claimantAccountId: award.winnerAccountId,
      claimantEvmAddress: award.winnerEvmAddress,
      tokenAddress: claimRecord.tokenAddress,
      serialNumber: claimRecord.serialNumber,
      metadataURI: claimRecord.metadataURI,
      status: "minted",
      mintedTxHash: receipt?.hash ?? tx.hash,
    });
  }

  await recordEvent({
    scope: "award",
    source: "chain",
    type: nextStatus === "claim_minted" ? "claim.minted" : "award.executed",
    actor: null,
    hackathonId: award.hackathonId,
    submissionId: award.submissionId,
    awardId,
    claimId: null,
    txHash: receipt?.hash ?? tx.hash,
    payload: {
      status: nextStatus,
      claim: claimRecord,
    },
  });
}

async function redeemClaimJob(claimId: string, awardId: string): Promise<void> {
  const claim = await getPrizeClaim(claimId);
  if (!claim) throw new Error(`Claim ${claimId} not found.`);

  const treasury = getTreasuryWriteContract();
  const tx = await treasury.redeemClaim(toOnchainId(awardId));
  const receipt = await tx.wait();

  await upsertPrizeClaim({
    awardId,
    claimantAccountId: claim.claimantAccountId,
    claimantEvmAddress: claim.claimantEvmAddress,
    tokenAddress: claim.tokenAddress,
    serialNumber: claim.serialNumber,
    metadataURI: claim.metadataURI,
    status: "redeemed",
    mintedTxHash: claim.mintedTxHash,
    redeemedTxHash: receipt?.hash ?? tx.hash,
  });
  await updateAwardProposal({ awardId, status: "redeemed", txHash: receipt?.hash ?? tx.hash });
  await recordEvent({
    scope: "claim",
    source: "chain",
    type: "claim.redeemed",
    actor: null,
    hackathonId: null,
    submissionId: null,
    awardId,
    claimId,
    txHash: receipt?.hash ?? tx.hash,
    payload: {
      claimant: claim.claimantEvmAddress,
    },
  });
}

async function processJob(job: { id: string; type: string; payload: Record<string, unknown> }) {
  switch (job.type) {
    case "register_submission":
      await registerSubmissionJob(String(job.payload.submissionId));
      return;
    case "evaluate_submission":
      await evaluateSubmissionJob(String(job.payload.submissionId));
      return;
    case "execute_approved_award":
      await executeApprovedAwardJob(String(job.payload.awardId));
      return;
    case "redeem_claim":
      await redeemClaimJob(String(job.payload.claimId), String(job.payload.awardId));
      return;
    default:
      throw new Error(`Unsupported job type ${job.type}`);
  }
}

async function main() {
  await ensureSchema();
  const workerId = `worker_${process.pid}`;
  console.log(`[worker] started as ${workerId}`);

  while (true) {
    const job = await claimNextJob(workerId);
    if (!job) {
      await sleep(WORKER_POLL_INTERVAL_MS);
      continue;
    }

    try {
      await processJob(job);
      await completeJob(job.id);
      console.log(`[worker] completed ${job.type} (${job.id})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const awardId = typeof job.payload.awardId === "string" ? job.payload.awardId : undefined;
      if (awardId) {
        await updateApprovalExecution({
          awardId,
          status: "failed",
          error: message,
        });
      }
      await failJob(job.id, message);
      console.error(`[worker] failed ${job.type} (${job.id}): ${message}`);
    }
  }
}

void main();
