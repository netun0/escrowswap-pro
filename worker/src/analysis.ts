import {
  buildAwardApprovalTypedData,
  type AwardApproval,
  type HackathonRecord,
  type SubmissionRecord,
  type Track,
  toOnchainId,
} from "../../packages/shared/src/index.js";
import { buildClearSigningManifest } from "../../packages/ledger-clear-signing/src/index.js";
import { HEDERA_EVM_RPC, PRIZE_CLAIM_TOKEN_ADDRESS, TREASURY_CONTRACT_ADDRESS } from "../../server/src/config.js";
import { getTreasuryWriteContract } from "../../server/src/treasuryContract.js";
import { createApprovalRequest, createAwardProposal, recordEvent, recordHcsAudit, replaceLatestEvaluationRun, updateAwardProposal, updateSubmissionStatus, upsertPrizeClaim } from "../../server/src/store.js";
import { appendHcsAudit } from "../../server/src/hcs.js";
import { runStructuredPrompt } from "./openai.js";
import { id, Interface, keccak256, toUtf8Bytes } from "ethers";

type RepoEvidence = {
  publicRepo: boolean;
  defaultBranch: string | null;
  readmePresent: boolean;
  topics: string[];
  rootFiles: string[];
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
};

type EligibilityResult = {
  passed: boolean;
  githubLive: boolean;
  demoPresent: boolean;
  readmePresent: boolean;
  hashscanVerified: boolean;
  rulesMet: boolean;
  notes: string;
};

type TrackFitResult = {
  fit: "high" | "medium" | "low";
  flags: string[];
  reasoning: string;
};

type QualityResult = {
  score: number;
  reasoning: string;
  highlights: string[];
  concerns: string[];
};

type RepoSlug = { owner: string; repo: string };
const HTTP_REQUEST_HEADERS = {
  "User-Agent": "JudgeBuddy-Worker",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function emptyRepoEvidence(): RepoEvidence {
  return {
    publicRepo: false,
    defaultBranch: null,
    readmePresent: false,
    topics: [],
    rootFiles: [],
    stars: 0,
    forks: 0,
    openIssues: 0,
    language: null,
  };
}

function parseGitHubRepo(url: string): RepoSlug | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.hostname !== "github.com" || parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: HTTP_REQUEST_HEADERS,
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status} ${url}`);
  return (await response.json()) as T;
}

function isReachableDemoResponse(status: number): boolean {
  return (status >= 200 && status < 400) || status === 401 || status === 403 || status === 405 || status === 429;
}

async function collectRepoEvidence(githubUrl: string): Promise<RepoEvidence> {
  const slug = parseGitHubRepo(githubUrl);
  if (!slug) return emptyRepoEvidence();

  let repo: any;
  try {
    repo = await fetchJson<any>(`https://api.github.com/repos/${slug.owner}/${slug.repo}`);
  } catch {
    return emptyRepoEvidence();
  }

  let readmePresent = false;
  try {
    await fetchJson<any>(`https://api.github.com/repos/${slug.owner}/${slug.repo}/readme`);
    readmePresent = true;
  } catch {
    readmePresent = false;
  }

  let rootFiles: string[] = [];
  try {
    const contents = await fetchJson<Array<{ name: string }>>(`https://api.github.com/repos/${slug.owner}/${slug.repo}/contents`);
    rootFiles = contents.map((entry) => entry.name);
  } catch {
    rootFiles = [];
  }

  return {
    publicRepo: !repo.private,
    defaultBranch: repo.default_branch ?? null,
    readmePresent,
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    rootFiles,
    stars: Number(repo.stargazers_count ?? 0),
    forks: Number(repo.forks_count ?? 0),
    openIssues: Number(repo.open_issues_count ?? 0),
    language: repo.language ?? null,
  };
}

async function verifyDemo(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "follow", headers: HTTP_REQUEST_HEADERS });
    if (isReachableDemoResponse(response.status)) return true;
  } catch {
    // Fallback to GET for servers that reject HEAD.
  }
  try {
    const response = await fetch(url, { method: "GET", redirect: "follow", headers: HTTP_REQUEST_HEADERS });
    return isReachableDemoResponse(response.status);
  } catch {
    return false;
  }
}

async function verifyHashscan(urls: SubmissionRecord["deployedContracts"]): Promise<boolean> {
  if (!urls.length) return false;
  const checks = await Promise.all(
    urls.map(async (contract) => {
      if (!contract.hashscanUrl) return false;
      try {
        const response = await fetch(contract.hashscanUrl, { method: "GET", redirect: "follow" });
        return response.ok;
      } catch {
        return false;
      }
    }),
  );
  return checks.every(Boolean);
}

async function runEligibility(track: Track, submission: SubmissionRecord): Promise<EligibilityResult> {
  const repo = await collectRepoEvidence(submission.githubUrl);
  const demoPresent = await verifyDemo(submission.demoUrl);
  const hashscanVerified = track.evaluationPolicy.requiresHashscanVerification
    ? await verifyHashscan(submission.deployedContracts)
    : true;
  const rulesMet =
    (!track.evaluationPolicy.requiresPublicRepo || repo.publicRepo) &&
    (!track.evaluationPolicy.requiresReadme || repo.readmePresent) &&
    (!track.evaluationPolicy.requiresDemo || demoPresent) &&
    (!track.evaluationPolicy.requiresHashscanVerification || hashscanVerified) &&
    (!track.evaluationPolicy.requiresContracts || submission.deployedContracts.length > 0);

  const notes = [
    repo.publicRepo ? "Public GitHub repo confirmed." : "Repository is private or unreachable.",
    repo.readmePresent ? "README found." : "README missing.",
    demoPresent ? "Demo URL responded successfully." : "Demo URL did not resolve.",
    hashscanVerified ? "Hashscan requirements satisfied." : "Hashscan verification missing.",
  ].join(" ");

  return {
    passed: rulesMet,
    githubLive: repo.publicRepo,
    demoPresent,
    readmePresent: repo.readmePresent,
    hashscanVerified,
    rulesMet,
    notes,
  };
}

function heuristicTrackFit(track: Track, submission: SubmissionRecord): TrackFitResult {
  const haystack = `${submission.projectName}\n${submission.description}\n${submission.githubUrl}`.toLowerCase();
  const hits = track.requirements.filter((requirement) => {
    const terms = requirement
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 4);
    return terms.some((term) => haystack.includes(term));
  });
  const ratio = hits.length / Math.max(track.requirements.length, 1);
  return {
    fit: ratio >= 0.66 ? "high" : ratio >= 0.33 ? "medium" : "low",
    flags: track.requirements.filter((requirement) => !hits.includes(requirement)).slice(0, 3),
    reasoning: hits.length
      ? `Matched ${hits.length} of ${track.requirements.length} explicit requirements from the track description.`
      : "No strong lexical overlap with the track requirements; manual review recommended.",
  };
}

function heuristicQuality(track: Track, submission: SubmissionRecord, eligibility: EligibilityResult): QualityResult {
  const hasContracts = submission.deployedContracts.length > 0 ? 15 : 0;
  const hasDemo = eligibility.demoPresent ? 20 : 0;
  const hasReadme = eligibility.readmePresent ? 15 : 0;
  const hasRepo = eligibility.githubLive ? 20 : 0;
  const descriptionDepth = Math.min(Math.floor(submission.description.length / 40), 20);
  const total = Math.min(100, hasContracts + hasDemo + hasReadme + hasRepo + descriptionDepth);
  const highlights = [
    hasContracts ? "Includes deployed contract artifacts." : null,
    hasDemo ? "Demo URL is reachable." : null,
    hasReadme ? "Repository includes a README." : null,
  ].filter(Boolean) as string[];
  const concerns = [
    !hasContracts && track.evaluationPolicy.requiresContracts ? "Track requires deployed contracts." : null,
    !eligibility.hashscanVerified && track.evaluationPolicy.requiresHashscanVerification ? "Hashscan evidence missing." : null,
  ].filter(Boolean) as string[];
  return {
    score: total,
    reasoning: `Deterministic fallback score based on repository accessibility, track evidence, demo availability, and shipped contract artifacts.`,
    highlights,
    concerns,
  };
}

async function runTrackFit(track: Track, submission: SubmissionRecord): Promise<{ result: TrackFitResult; model: string | null }> {
  try {
    const { output, model } = await runStructuredPrompt<TrackFitResult>({
      name: "track_fit_analysis",
      system:
        "You are scoring a hackathon submission against a sponsor track. Respond with strict JSON only. Prefer conservative fit scores when evidence is weak.",
      user: JSON.stringify({
        track,
        submission: {
          projectName: submission.projectName,
          description: submission.description,
          githubUrl: submission.githubUrl,
          demoUrl: submission.demoUrl,
          deployedContracts: submission.deployedContracts,
        },
      }),
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          fit: { type: "string", enum: ["high", "medium", "low"] },
          flags: { type: "array", items: { type: "string" } },
          reasoning: { type: "string" },
        },
        required: ["fit", "flags", "reasoning"],
      },
    });
    return { result: output, model };
  } catch {
    return { result: heuristicTrackFit(track, submission), model: null };
  }
}

async function runQuality(track: Track, submission: SubmissionRecord, eligibility: EligibilityResult): Promise<{ result: QualityResult; model: string | null }> {
  try {
    const repo = await collectRepoEvidence(submission.githubUrl);
    const { output, model } = await runStructuredPrompt<QualityResult>({
      name: "quality_analysis",
      system:
        "You review hackathon projects for execution quality. Score 0-100 based on evidence only. Reward deployability, tests, architecture coherence, and completeness.",
      user: JSON.stringify({
        track,
        submission: {
          projectName: submission.projectName,
          description: submission.description,
          teamName: submission.teamName,
          githubUrl: submission.githubUrl,
          demoUrl: submission.demoUrl,
          deployedContracts: submission.deployedContracts,
        },
        repo,
        eligibility,
      }),
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          score: { type: "integer", minimum: 0, maximum: 100 },
          reasoning: { type: "string" },
          highlights: { type: "array", items: { type: "string" } },
          concerns: { type: "array", items: { type: "string" } },
        },
        required: ["score", "reasoning", "highlights", "concerns"],
      },
    });
    return { result: output, model };
  } catch {
    return { result: heuristicQuality(track, submission, eligibility), model: null };
  }
}

async function appendAuditEvent(type: string, payload: Record<string, unknown>) {
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

export async function evaluateSubmission(params: {
  hackathon: HackathonRecord;
  track: Track;
  submission: SubmissionRecord;
}): Promise<void> {
  const { hackathon, track, submission } = params;

  const eligibility = await runEligibility(track, submission);
  await replaceLatestEvaluationRun({
    submissionId: submission.id,
    agentRole: "eligibility",
    status: "completed",
    result: eligibility,
  });
  await recordEvent({
    scope: "submission",
    source: "worker",
    type: "eligibility.completed",
    actor: "eligibility-agent",
    hackathonId: hackathon.id,
    submissionId: submission.id,
    awardId: null,
    claimId: null,
    txHash: null,
    payload: eligibility,
  });
  await appendAuditEvent("eligibility_completed", { hackathonId: hackathon.id, submissionId: submission.id, eligibility });

  if (!eligibility.passed) {
    await updateSubmissionStatus(submission.id, "ineligible");
    return;
  }

  const trackFit = await runTrackFit(track, submission);
  await replaceLatestEvaluationRun({
    submissionId: submission.id,
    agentRole: "track-fit",
    status: "completed",
    result: trackFit.result,
    model: trackFit.model,
  });

  const quality = await runQuality(track, submission, eligibility);
  await replaceLatestEvaluationRun({
    submissionId: submission.id,
    agentRole: "quality",
    status: "completed",
    result: quality.result,
    model: quality.model,
  });
  await updateSubmissionStatus(submission.id, "evaluated");
  await recordEvent({
    scope: "submission",
    source: "worker",
    type: "quality.completed",
    actor: "quality-agent",
    hackathonId: hackathon.id,
    submissionId: submission.id,
    awardId: null,
    claimId: null,
    txHash: null,
    payload: { trackFit: trackFit.result, quality: quality.result },
  });

  if (quality.result.score < track.evaluationPolicy.minQualityScore) {
    return;
  }

  const settlementMode =
    BigInt(track.prizeAmount) <= BigInt(hackathon.autonomousThreshold) ? "autonomous_payout" : "claim_token";
  const award = await createAwardProposal({
    hackathonId: hackathon.id,
    submissionId: submission.id,
    trackId: submission.trackId,
    winnerAccountId: submission.payoutAccountId,
    winnerEvmAddress: submission.payoutEvmAddress,
    amount: track.prizeAmount,
    settlementMode,
    status: settlementMode === "autonomous_payout" ? "recommended" : "awaiting_approval",
    reason: quality.result.reasoning,
    machinePolicy: {
      eligibility,
      trackFit: trackFit.result,
      quality: quality.result,
    },
  });

  await recordEvent({
    scope: "award",
    source: "worker",
    type: "award.recommended",
    actor: "treasury-agent",
    hackathonId: hackathon.id,
    submissionId: submission.id,
    awardId: award.id,
    claimId: null,
    txHash: null,
    payload: award,
  });

  if (!TREASURY_CONTRACT_ADDRESS) {
    return;
  }

  const treasury = getTreasuryWriteContract();
  const submissionOnchainId = id(submission.id);
  const hackathonOnchainId = id(hackathon.id);
  const trackOnchainId = id(submission.trackId);
  const awardOnchainId = id(award.id);
  const repoHash = keccak256(toUtf8Bytes(submission.githubUrl));

  const registerTx = await treasury.registerSubmission(
    submissionOnchainId,
    hackathonOnchainId,
    trackOnchainId,
    submission.payoutEvmAddress,
    repoHash,
  );
  await registerTx.wait();

  const evaluationTx = await treasury.recordEvaluation(
    submissionOnchainId,
    true,
    quality.result.score,
    keccak256(toUtf8Bytes(JSON.stringify({ eligibility, trackFit: trackFit.result, quality: quality.result }))),
  );
  await evaluationTx.wait();

  const settlementModeInt = settlementMode === "claim_token" ? 1 : 0;
  const proposalTx = await treasury.proposeAward(
    awardOnchainId,
    submissionOnchainId,
    submission.payoutEvmAddress,
    track.prizeAmount,
    settlementModeInt,
    keccak256(toUtf8Bytes(quality.result.reasoning)),
  );
  const proposalReceipt = await proposalTx.wait();
  await updateAwardProposal({ id: award.id, txHash: proposalReceipt?.hash ?? proposalTx.hash });

  if (settlementMode === "autonomous_payout") {
    const payoutTx = await treasury.executeAutonomousPayout(awardOnchainId);
    const payoutReceipt = await payoutTx.wait();
    await updateAwardProposal({ id: award.id, status: "paid_out", txHash: payoutReceipt?.hash ?? payoutTx.hash });
    await updateSubmissionStatus(submission.id, "paid");
    await recordEvent({
      scope: "award",
      source: "chain",
      type: "award.autonomous_paid",
      actor: "treasury-agent",
      hackathonId: hackathon.id,
      submissionId: submission.id,
      awardId: award.id,
      claimId: null,
      txHash: payoutReceipt?.hash ?? payoutTx.hash,
      payload: { amount: track.prizeAmount },
    });
    await appendAuditEvent("autonomous_payout_released", {
      hackathonId: hackathon.id,
      submissionId: submission.id,
      awardId: award.id,
      txHash: payoutReceipt?.hash ?? payoutTx.hash,
    });
    return;
  }

  const expiresAt = Math.floor(Date.now() / 1000) + hackathon.approvalExpirySeconds;
  const approval = {
    awardId: award.id,
    hackathonId: hackathon.id,
    submissionId: submission.id,
    trackId: submission.trackId,
    winner: submission.payoutEvmAddress,
    amount: track.prizeAmount,
    settlementMode,
    expiresAt,
  } satisfies AwardApproval;

  const typedData = buildAwardApprovalTypedData({
    chainId: 296,
    verifyingContract: TREASURY_CONTRACT_ADDRESS,
    approval: {
      awardId: toOnchainId(approval.awardId),
      hackathonId: toOnchainId(approval.hackathonId),
      submissionId: toOnchainId(approval.submissionId),
      trackId: toOnchainId(approval.trackId),
      winner: approval.winner,
      amount: approval.amount,
      settlementMode: approval.settlementMode,
      expiresAt,
    },
  });

  const manifest = buildClearSigningManifest({
    action: "approve_award",
    chainId: 296,
    contractAddress: TREASURY_CONTRACT_ADDRESS,
    contractName: "HackathonTreasury",
    digest: typedData.digest,
    approval,
    calldataPreview: new Interface([
      "function executeApprovedAward((bytes32 awardId, bytes32 hackathonId, bytes32 submissionId, bytes32 trackId, address winner, uint256 amount, uint8 settlementMode, uint256 expiresAt) approval, bytes signature) external",
    ]).encodeFunctionData("executeApprovedAward", [
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
      "0x",
    ]),
  });

  await createApprovalRequest({
    awardId: award.id,
    actionType: "approve_award",
    signerAccountId: hackathon.judgeAccountId,
    signerEvmAddress: hackathon.judgeEvmAddress,
    typedData,
    clearSigningManifest: manifest,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  });
  await updateAwardProposal({ id: award.id, digest: typedData.digest, status: "awaiting_approval" });
}
