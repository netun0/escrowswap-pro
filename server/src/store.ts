import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "./db.js";
import {
  type ApprovalRequest,
  type AwardProposal,
  type CreateHackathonRequest,
  type CreateSubmissionRequest,
  type EventEnvelope,
  type EvaluationRun,
  type HackathonRecord,
  type PrizeClaim,
  type SubmissionRecord,
  type Track,
  makeId,
} from "../../packages/shared/src/index.js";

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function computeHackathonStatus(row: QueryResultRow): HackathonRecord["status"] {
  const now = Date.now();
  const endsAt = new Date(row.ends_at).getTime();
  const judgingEndsAt = new Date(row.judging_ends_at).getTime();
  if (!row.treasury_tx_hash) return "funding";
  if (now >= judgingEndsAt) return "completed";
  if (now >= endsAt) return "judging";
  return "live";
}

function mapTrack(row: QueryResultRow): Track {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sponsorName: row.sponsor_name,
    prizeAmount: String(row.prize_amount),
    requirements: row.requirements ?? [],
    evaluationPolicy: row.evaluation_policy ?? {},
  };
}

function mapHackathon(row: QueryResultRow, tracks: Track[]): HackathonRecord {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    organizerAccountId: row.organizer_account_id,
    organizerEvmAddress: row.organizer_evm_address,
    judgeAccountId: row.judge_account_id,
    judgeEvmAddress: row.judge_evm_address,
    payoutTokenId: row.payout_token_id,
    payoutTokenEvmAddress: row.payout_token_evm_address,
    autonomousThreshold: String(row.autonomous_threshold),
    approvalExpirySeconds: row.approval_expiry_seconds,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    submissionDeadline: new Date(row.submission_deadline).toISOString(),
    judgingEndsAt: new Date(row.judging_ends_at).toISOString(),
    status: computeHackathonStatus(row),
    treasuryTxHash: row.treasury_tx_hash ?? null,
    tracks,
  };
}

function mapEvaluationRun(row: QueryResultRow): EvaluationRun {
  return {
    id: row.id,
    submissionId: row.submission_id,
    agentRole: row.agent_role,
    status: row.status,
    result: row.result ?? null,
    error: row.error ?? null,
    startedAt: toIso(row.started_at),
    completedAt: toIso(row.completed_at),
  };
}

function mapAward(row: QueryResultRow | undefined): AwardProposal | null {
  if (!row) return null;
  return {
    id: row.id,
    hackathonId: row.hackathon_id,
    submissionId: row.submission_id,
    trackId: row.track_id,
    winnerAccountId: row.winner_account_id,
    winnerEvmAddress: row.winner_evm_address,
    amount: String(row.amount),
    settlementMode: row.settlement_mode,
    status: row.status,
    reason: row.reason,
    machinePolicy: row.machine_policy ?? {},
    digest: row.digest ?? null,
    txHash: row.tx_hash ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapClaim(row: QueryResultRow | undefined): PrizeClaim | null {
  if (!row) return null;
  return {
    id: row.id,
    awardId: row.award_id,
    claimantAccountId: row.claimant_account_id,
    claimantEvmAddress: row.claimant_evm_address,
    tokenAddress: row.token_address ?? null,
    serialNumber: row.serial_number ?? null,
    metadataURI: row.metadata_uri ?? null,
    status: row.status,
    mintedTxHash: row.minted_tx_hash ?? null,
    redeemedTxHash: row.redeemed_tx_hash ?? null,
  };
}

function mapApproval(row: QueryResultRow): ApprovalRequest {
  return {
    id: row.id,
    awardId: row.award_id,
    actionType: row.action_type,
    signerAccountId: row.signer_account_id,
    signerEvmAddress: row.signer_evm_address,
    status: row.status,
    digest: row.digest,
    typedData: row.typed_data ?? {},
    clearSigningManifest: row.clear_signing_manifest ?? {},
    calldata: row.calldata ?? null,
    signature: row.signature ?? null,
    expiresAt: new Date(row.expires_at).toISOString(),
    approvedAt: toIso(row.approved_at),
    executedAt: toIso(row.executed_at),
    executionTxHash: row.execution_tx_hash ?? null,
    error: row.error ?? null,
  };
}

export async function listHackathons(): Promise<HackathonRecord[]> {
  const hacks = await pool.query("select * from hackathons order by created_at desc");
  if (hacks.rowCount === 0) return [];
  const trackRows = await pool.query("select * from tracks where hackathon_id = any($1::text[]) order by created_at asc", [
    hacks.rows.map((row) => row.id),
  ]);
  const tracksByHackathon = new Map<string, Track[]>();
  for (const row of trackRows.rows) {
    const next = tracksByHackathon.get(row.hackathon_id) ?? [];
    next.push(mapTrack(row));
    tracksByHackathon.set(row.hackathon_id, next);
  }
  return hacks.rows.map((row) => mapHackathon(row, tracksByHackathon.get(row.id) ?? []));
}

export async function getHackathon(id: string): Promise<HackathonRecord | null> {
  const hack = await pool.query("select * from hackathons where id = $1", [id]);
  if (hack.rowCount === 0) return null;
  const tracks = await pool.query("select * from tracks where hackathon_id = $1 order by created_at asc", [id]);
  return mapHackathon(hack.rows[0], tracks.rows.map(mapTrack));
}

export async function createHackathon(input: CreateHackathonRequest): Promise<HackathonRecord> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into hackathons (
        id, name, tagline, organizer_account_id, organizer_evm_address, judge_account_id, judge_evm_address,
        payout_token_id, payout_token_evm_address, autonomous_threshold, approval_expiry_seconds,
        starts_at, ends_at, submission_deadline, judging_ends_at, treasury_contract_address
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        makeId("hackathon"),
        input.name,
        input.tagline,
        input.organizerAccountId,
        input.organizerEvmAddress,
        input.judgeAccountId,
        input.judgeEvmAddress,
        input.payoutTokenId,
        input.payoutTokenEvmAddress,
        input.autonomousThreshold,
        input.approvalExpirySeconds,
        input.startsAt,
        input.endsAt,
        input.submissionDeadline,
        input.judgingEndsAt,
        null,
      ],
    );

    const hackRow = await client.query("select * from hackathons where organizer_account_id = $1 order by created_at desc limit 1", [
      input.organizerAccountId,
    ]);
    const hackathonId = hackRow.rows[0].id as string;

    for (const track of input.tracks) {
      await client.query(
        `insert into tracks (id, hackathon_id, name, description, sponsor_name, prize_amount, requirements, evaluation_policy)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          track.id,
          hackathonId,
          track.name,
          track.description,
          track.sponsorName,
          track.prizeAmount,
          JSON.stringify(track.requirements),
          JSON.stringify(track.evaluationPolicy),
        ],
      );
    }
    await client.query("commit");
    const created = await getHackathon(hackathonId);
    if (!created) throw new Error("Failed to load created hackathon");
    return created;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function markHackathonFunded(params: {
  hackathonId: string;
  txHash: string;
  sponsorAccountId: string;
  sponsorEvmAddress: string;
  tokenId: string;
  deposits: Array<{ trackId: string; amount: string }>;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "update hackathons set treasury_tx_hash = $2, treasury_contract_address = coalesce(treasury_contract_address, treasury_contract_address), updated_at = now() where id = $1",
      [params.hackathonId, params.txHash],
    );
    for (const deposit of params.deposits) {
      await client.query(
        `insert into sponsor_deposits (
          id, hackathon_id, track_id, sponsor_account_id, sponsor_evm_address, token_id, amount, tx_hash, status, metadata
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed',$9)`,
        [
          makeId("deposit"),
          params.hackathonId,
          deposit.trackId,
          params.sponsorAccountId,
          params.sponsorEvmAddress,
          params.tokenId,
          deposit.amount,
          params.txHash,
          JSON.stringify({ source: "bootstrap" }),
        ],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createSubmission(input: CreateSubmissionRequest): Promise<SubmissionRecord> {
  const id = makeId("submission");
  await pool.query(
    `insert into submissions (
      id, hackathon_id, track_id, project_name, team_name, team_members, github_url, demo_url, description,
      payout_account_id, payout_evm_address, deployed_contracts, status
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending')`,
    [
      id,
      input.hackathonId,
      input.trackId,
      input.projectName,
      input.teamName,
      JSON.stringify(input.teamMembers),
      input.githubUrl,
      input.demoUrl,
      input.description,
      input.payoutAccountId,
      input.payoutEvmAddress,
      JSON.stringify(input.deployedContracts),
    ],
  );
  const submission = await getSubmission(id);
  if (!submission) throw new Error("Failed to load submission");
  return submission;
}

export async function listSubmissions(hackathonId: string): Promise<SubmissionRecord[]> {
  const submissions = await pool.query("select * from submissions where hackathon_id = $1 order by created_at desc", [hackathonId]);
  return Promise.all(submissions.rows.map((row) => hydrateSubmission(row.id)));
}

export async function getSubmission(id: string): Promise<SubmissionRecord | null> {
  const row = await pool.query("select * from submissions where id = $1", [id]);
  if (row.rowCount === 0) return null;
  return hydrateSubmission(id);
}

async function hydrateSubmission(id: string): Promise<SubmissionRecord> {
  const submission = await pool.query("select * from submissions where id = $1", [id]);
  const runRows = await pool.query("select * from evaluation_runs where submission_id = $1 order by created_at asc", [id]);
  const awardRow = await pool.query("select * from award_proposals where submission_id = $1 order by created_at desc limit 1", [id]);
  const approvalRow =
    awardRow.rowCount === 0
      ? { rows: [] as QueryResultRow[] }
      : await pool.query("select * from approval_requests where award_id = $1 limit 1", [awardRow.rows[0].id]);
  const claimRow =
    awardRow.rowCount === 0
      ? { rows: [] as QueryResultRow[] }
      : await pool.query("select * from prize_claims where award_id = $1 limit 1", [awardRow.rows[0].id]);

  const row = submission.rows[0];
  return {
    id: row.id,
    hackathonId: row.hackathon_id,
    trackId: row.track_id,
    projectName: row.project_name,
    teamName: row.team_name,
    teamMembers: row.team_members ?? [],
    githubUrl: row.github_url,
    demoUrl: row.demo_url,
    description: row.description,
    payoutAccountId: row.payout_account_id,
    payoutEvmAddress: row.payout_evm_address,
    deployedContracts: row.deployed_contracts ?? [],
    status: row.status,
    evaluationRuns: runRows.rows.map(mapEvaluationRun),
    awardProposal: mapAward(awardRow.rows[0]),
    approvalRequest: approvalRow.rows[0] ? mapApproval(approvalRow.rows[0]) : null,
    claim: mapClaim(claimRow.rows[0]),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function enqueueJob(type: string, payload: Record<string, unknown>): Promise<string> {
  const id = makeId("job");
  await pool.query("insert into jobs (id, type, status, payload) values ($1,$2,'queued',$3)", [id, type, JSON.stringify(payload)]);
  return id;
}

export async function createEvaluationRun(params: {
  submissionId: string;
  agentRole: EvaluationRun["agentRole"];
  status: EvaluationRun["status"];
  result?: Record<string, unknown> | null;
  error?: string | null;
}): Promise<void> {
  await pool.query(
    `insert into evaluation_runs (id, submission_id, agent_role, status, result, error, started_at, completed_at)
     values ($1,$2,$3,$4,$5,$6, case when $4 = 'running' then now() else null end, case when $4 in ('completed','failed') then now() else null end)`,
    [makeId("run"), params.submissionId, params.agentRole, params.status, params.result ?? null, params.error ?? null],
  );
}

export async function replaceLatestEvaluationRun(params: {
  submissionId: string;
  agentRole: EvaluationRun["agentRole"];
  status: EvaluationRun["status"];
  result?: Record<string, unknown> | null;
  error?: string | null;
  model?: string | null;
}): Promise<void> {
  await pool.query("delete from evaluation_runs where submission_id = $1 and agent_role = $2", [params.submissionId, params.agentRole]);
  await pool.query(
    `insert into evaluation_runs (id, submission_id, agent_role, status, result, error, model, started_at, completed_at)
     values ($1,$2,$3,$4,$5,$6,$7, now(), case when $4 in ('completed','failed') then now() else null end)`,
    [
      makeId("run"),
      params.submissionId,
      params.agentRole,
      params.status,
      params.result ?? null,
      params.error ?? null,
      params.model ?? null,
    ],
  );
}

export async function updateSubmissionStatus(id: string, status: SubmissionRecord["status"]): Promise<void> {
  await pool.query("update submissions set status = $2, updated_at = now() where id = $1", [id, status]);
}

export async function createAwardProposal(params: {
  hackathonId: string;
  submissionId: string;
  trackId: string;
  winnerAccountId: string;
  winnerEvmAddress: string;
  amount: string;
  settlementMode: AwardProposal["settlementMode"];
  status: AwardProposal["status"];
  reason: string;
  machinePolicy: Record<string, unknown>;
  digest?: string | null;
  txHash?: string | null;
}): Promise<AwardProposal> {
  const id = makeId("award");
  await pool.query(
    `insert into award_proposals (
      id, hackathon_id, submission_id, track_id, winner_account_id, winner_evm_address, amount, settlement_mode,
      status, reason, machine_policy, digest, tx_hash
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      params.hackathonId,
      params.submissionId,
      params.trackId,
      params.winnerAccountId,
      params.winnerEvmAddress,
      params.amount,
      params.settlementMode,
      params.status,
      params.reason,
      JSON.stringify(params.machinePolicy),
      params.digest ?? null,
      params.txHash ?? null,
    ],
  );
  const row = await pool.query("select * from award_proposals where id = $1", [id]);
  return mapAward(row.rows[0])!;
}

export async function getAwardProposal(id: string): Promise<AwardProposal | null> {
  const row = await pool.query("select * from award_proposals where id = $1", [id]);
  return mapAward(row.rows[0]);
}

export async function getLatestTrackAward(hackathonId: string, trackId: string): Promise<AwardProposal | null> {
  const row = await pool.query(
    "select * from award_proposals where hackathon_id = $1 and track_id = $2 order by created_at desc limit 1",
    [hackathonId, trackId],
  );
  return mapAward(row.rows[0]);
}

export async function listApprovalRequests(hackathonId?: string): Promise<ApprovalRequest[]> {
  const rows = hackathonId
    ? await pool.query(
        `select ar.* from approval_requests ar
         join award_proposals ap on ap.id = ar.award_id
         where ap.hackathon_id = $1
         order by ar.created_at desc`,
        [hackathonId],
      )
    : await pool.query("select * from approval_requests order by created_at desc");
  return rows.rows.map(mapApproval);
}

export async function createApprovalRequest(params: {
  awardId: string;
  actionType: ApprovalRequest["actionType"];
  signerAccountId: string;
  signerEvmAddress: string;
  digest: string;
  typedData: Record<string, unknown>;
  clearSigningManifest: Record<string, unknown>;
  calldata?: string | null;
  expiresAt: string;
}): Promise<ApprovalRequest> {
  const id = makeId("approval");
  await pool.query(
    `insert into approval_requests (
      id, award_id, action_type, signer_account_id, signer_evm_address, status, digest, typed_data, clear_signing_manifest, calldata, expires_at
    ) values ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10)`,
    [
      id,
      params.awardId,
      params.actionType,
      params.signerAccountId,
      params.signerEvmAddress,
      params.digest,
      JSON.stringify(params.typedData),
      JSON.stringify(params.clearSigningManifest),
      params.calldata ?? null,
      params.expiresAt,
    ],
  );
  const row = await pool.query("select * from approval_requests where id = $1", [id]);
  return mapApproval(row.rows[0]);
}

export async function markApprovalApproved(params: {
  awardId: string;
  signature: string;
  status: ApprovalRequest["status"];
  error?: string | null;
}): Promise<void> {
  await pool.query(
    `update approval_requests
     set signature = $2,
         status = $3,
         approved_at = case when $3 in ('approved', 'executed') then now() else approved_at end,
         executed_at = case when $3 = 'executed' then now() else executed_at end,
         error = $4
     where award_id = $1`,
    [params.awardId, params.signature, params.status, params.error ?? null],
  );
}

export async function updateApprovalExecution(params: {
  awardId: string;
  status: ApprovalRequest["status"];
  executionTxHash?: string | null;
  error?: string | null;
}): Promise<void> {
  await pool.query(
    `update approval_requests
     set status = $2,
         executed_at = case when $2 = 'executed' then now() else executed_at end,
         execution_tx_hash = coalesce($3, execution_tx_hash),
         error = $4
     where award_id = $1`,
    [params.awardId, params.status, params.executionTxHash ?? null, params.error ?? null],
  );
}

export async function getApprovalRequestByAwardId(awardId: string): Promise<ApprovalRequest | null> {
  const row = await pool.query("select * from approval_requests where award_id = $1 limit 1", [awardId]);
  if (row.rowCount === 0) return null;
  return mapApproval(row.rows[0]);
}

export async function updateAwardProposal(params: {
  awardId: string;
  status?: AwardProposal["status"];
  digest?: string | null;
  txHash?: string | null;
}): Promise<void> {
  await pool.query(
    `update award_proposals
     set status = coalesce($2, status),
         digest = coalesce($3, digest),
         tx_hash = coalesce($4, tx_hash),
         updated_at = now()
     where id = $1`,
    [params.awardId, params.status ?? null, params.digest ?? null, params.txHash ?? null],
  );
}

export async function upsertPrizeClaim(params: {
  awardId: string;
  claimantAccountId: string;
  claimantEvmAddress: string;
  tokenAddress?: string | null;
  serialNumber?: string | null;
  metadataURI?: string | null;
  status: PrizeClaim["status"];
  mintedTxHash?: string | null;
  redeemedTxHash?: string | null;
}): Promise<void> {
  await pool.query(
    `insert into prize_claims (
      id, award_id, claimant_account_id, claimant_evm_address, token_address, serial_number, metadata_uri, status, minted_tx_hash, redeemed_tx_hash
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    on conflict (award_id) do update set
      claimant_account_id = excluded.claimant_account_id,
      claimant_evm_address = excluded.claimant_evm_address,
      token_address = excluded.token_address,
      serial_number = excluded.serial_number,
      metadata_uri = excluded.metadata_uri,
      status = excluded.status,
      minted_tx_hash = coalesce(excluded.minted_tx_hash, prize_claims.minted_tx_hash),
      redeemed_tx_hash = coalesce(excluded.redeemed_tx_hash, prize_claims.redeemed_tx_hash),
      updated_at = now()`,
    [
      makeId("claim"),
      params.awardId,
      params.claimantAccountId,
      params.claimantEvmAddress,
      params.tokenAddress ?? null,
      params.serialNumber ?? null,
      params.metadataURI ?? null,
      params.status,
      params.mintedTxHash ?? null,
      params.redeemedTxHash ?? null,
    ],
  );
}

export async function getPrizeClaim(id: string): Promise<PrizeClaim | null> {
  const row = await pool.query("select * from prize_claims where id = $1 limit 1", [id]);
  if (row.rowCount === 0) return null;
  return mapClaim(row.rows[0]);
}

export async function recordEvent(input: Omit<EventEnvelope, "id" | "createdAt">): Promise<void> {
  await pool.query(
    `insert into events (id, scope, source, type, actor, hackathon_id, submission_id, award_id, claim_id, tx_hash, payload)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      makeId("event"),
      input.scope,
      input.source,
      input.type,
      input.actor ?? null,
      input.hackathonId ?? null,
      input.submissionId ?? null,
      input.awardId ?? null,
      input.claimId ?? null,
      input.txHash ?? null,
      JSON.stringify(input.payload),
    ],
  );
}

export async function recordHcsAudit(input: {
  type: string;
  hackathonId?: string | null;
  submissionId?: string | null;
  awardId?: string | null;
  txId: string | null;
  topicId: string | null;
  sequenceNumber: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `insert into hcs_audit_events (id, type, hackathon_id, submission_id, award_id, tx_id, topic_id, sequence_number, payload)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      makeId("hcs"),
      input.type,
      input.hackathonId ?? null,
      input.submissionId ?? null,
      input.awardId ?? null,
      input.txId,
      input.topicId,
      input.sequenceNumber,
      JSON.stringify(input.payload),
    ],
  );
}

export async function listEvents(filters: {
  hackathonId?: string | null;
  submissionId?: string | null;
  scope?: EventEnvelope["scope"] | null;
}): Promise<EventEnvelope[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.hackathonId) {
    params.push(filters.hackathonId);
    clauses.push(`hackathon_id = $${params.length}`);
  }
  if (filters.submissionId) {
    params.push(filters.submissionId);
    clauses.push(`submission_id = $${params.length}`);
  }
  if (filters.scope) {
    params.push(filters.scope);
    clauses.push(`scope = $${params.length}`);
  }
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const rows = await pool.query(`select * from events ${where} order by created_at desc limit 250`, params);
  return rows.rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    source: row.source,
    type: row.type,
    actor: row.actor ?? null,
    hackathonId: row.hackathon_id ?? null,
    submissionId: row.submission_id ?? null,
    awardId: row.award_id ?? null,
    claimId: row.claim_id ?? null,
    txHash: row.tx_hash ?? null,
    payload: row.payload ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function listHcsAuditEvents(filters: {
  hackathonId?: string | null;
  submissionId?: string | null;
  awardId?: string | null;
}): Promise<Array<Record<string, unknown>>> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.hackathonId) {
    params.push(filters.hackathonId);
    clauses.push(`hackathon_id = $${params.length}`);
  }
  if (filters.submissionId) {
    params.push(filters.submissionId);
    clauses.push(`submission_id = $${params.length}`);
  }
  if (filters.awardId) {
    params.push(filters.awardId);
    clauses.push(`award_id = $${params.length}`);
  }
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const rows = await pool.query(`select * from hcs_audit_events ${where} order by created_at desc limit 250`, params);
  return rows.rows.map((row) => ({
    id: row.id,
    type: row.type,
    hackathonId: row.hackathon_id ?? null,
    submissionId: row.submission_id ?? null,
    awardId: row.award_id ?? null,
    txId: row.tx_id ?? null,
    topicId: row.topic_id ?? null,
    sequenceNumber: row.sequence_number ?? null,
    payload: row.payload ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function listJobs(limit = 100): Promise<Array<Record<string, unknown>>> {
  const rows = await pool.query("select * from jobs order by created_at desc limit $1", [limit]);
  return rows.rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    payload: row.payload ?? {},
    attempts: row.attempts,
    lastError: row.last_error ?? null,
    leaseOwner: row.lease_owner ?? null,
    runAfter: toIso(row.run_after),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }));
}

export async function claimNextJob(workerId: string): Promise<{ id: string; type: string; payload: Record<string, unknown> } | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const job = await client.query(
      `select * from jobs
       where status = 'queued' and run_after <= now() and (lease_expires_at is null or lease_expires_at < now())
       order by created_at asc
       limit 1
       for update skip locked`,
    );
    if (job.rowCount === 0) {
      await client.query("commit");
      return null;
    }
    const row = job.rows[0];
    await client.query(
      `update jobs
       set status = 'running', attempts = attempts + 1, lease_owner = $2, lease_expires_at = now() + interval '5 minutes', updated_at = now()
       where id = $1`,
      [row.id, workerId],
    );
    await client.query("commit");
    return { id: row.id, type: row.type, payload: row.payload ?? {} };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function completeJob(id: string): Promise<void> {
  await pool.query("update jobs set status = 'completed', lease_owner = null, lease_expires_at = null, updated_at = now() where id = $1", [id]);
}

export async function failJob(id: string, error: string): Promise<void> {
  await pool.query(
    "update jobs set status = 'failed', last_error = $2, lease_owner = null, lease_expires_at = null, updated_at = now() where id = $1",
    [id, error],
  );
}

export async function getJobState(id: string): Promise<QueryResultRow | null> {
  const row = await pool.query("select * from jobs where id = $1", [id]);
  return row.rows[0] ?? null;
}
