import { Pool } from "pg";
import { DATABASE_URL } from "./config.js";

export const pool = new Pool({
  connectionString: DATABASE_URL,
});

export async function ensureSchema(): Promise<void> {
  await pool.query(`
    create table if not exists hackathons (
      id text primary key,
      name text not null,
      tagline text not null,
      organizer_account_id text not null,
      organizer_evm_address text not null,
      judge_account_id text not null,
      judge_evm_address text not null,
      payout_token_id text not null,
      payout_token_evm_address text not null,
      autonomous_threshold numeric(78,0) not null,
      approval_expiry_seconds integer not null,
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      submission_deadline timestamptz not null,
      judging_ends_at timestamptz not null,
      treasury_tx_hash text,
      treasury_contract_address text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists sponsors (
      id text primary key,
      hackathon_id text not null references hackathons(id) on delete cascade,
      name text not null,
      account_id text,
      evm_address text,
      created_at timestamptz not null default now()
    );

    create table if not exists tracks (
      id text primary key,
      hackathon_id text not null references hackathons(id) on delete cascade,
      name text not null,
      description text not null,
      sponsor_name text not null,
      prize_amount numeric(78,0) not null,
      requirements jsonb not null,
      evaluation_policy jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists sponsor_deposits (
      id text primary key,
      hackathon_id text not null references hackathons(id) on delete cascade,
      track_id text not null references tracks(id) on delete cascade,
      sponsor_account_id text,
      sponsor_evm_address text,
      token_id text not null,
      amount numeric(78,0) not null,
      tx_hash text not null,
      status text not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists submissions (
      id text primary key,
      hackathon_id text not null references hackathons(id) on delete cascade,
      track_id text not null references tracks(id) on delete cascade,
      project_name text not null,
      team_name text not null,
      team_members jsonb not null,
      github_url text not null,
      demo_url text not null,
      description text not null,
      payout_account_id text not null,
      payout_evm_address text not null,
      deployed_contracts jsonb not null default '[]'::jsonb,
      status text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists evaluation_runs (
      id text primary key,
      submission_id text not null references submissions(id) on delete cascade,
      agent_role text not null,
      status text not null,
      result jsonb,
      model text,
      error text,
      started_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz not null default now()
    );

    create table if not exists award_proposals (
      id text primary key,
      hackathon_id text not null references hackathons(id) on delete cascade,
      submission_id text not null references submissions(id) on delete cascade,
      track_id text not null references tracks(id) on delete cascade,
      winner_account_id text not null,
      winner_evm_address text not null,
      amount numeric(78,0) not null,
      settlement_mode text not null,
      status text not null,
      reason text not null,
      machine_policy jsonb not null default '{}'::jsonb,
      digest text,
      tx_hash text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists approval_requests (
      id text primary key,
      award_id text not null unique references award_proposals(id) on delete cascade,
      action_type text not null,
      signer_account_id text not null,
      signer_evm_address text not null,
      status text not null,
      digest text not null,
      typed_data jsonb not null,
      clear_signing_manifest jsonb not null,
      calldata text,
      signature text,
      expires_at timestamptz not null,
      approved_at timestamptz,
      executed_at timestamptz,
      execution_tx_hash text,
      error text,
      created_at timestamptz not null default now()
    );

    create table if not exists prize_claims (
      id text primary key,
      award_id text not null unique references award_proposals(id) on delete cascade,
      claimant_account_id text not null,
      claimant_evm_address text not null,
      token_address text,
      serial_number text,
      metadata_uri text,
      status text not null,
      minted_tx_hash text,
      redeemed_tx_hash text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists events (
      id text primary key,
      scope text not null,
      source text not null,
      type text not null,
      actor text,
      hackathon_id text,
      submission_id text,
      award_id text,
      claim_id text,
      tx_hash text,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists hcs_audit_events (
      id text primary key,
      type text not null,
      hackathon_id text,
      submission_id text,
      award_id text,
      tx_id text,
      topic_id text,
      sequence_number text,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists jobs (
      id text primary key,
      type text not null,
      status text not null,
      payload jsonb not null,
      attempts integer not null default 0,
      lease_owner text,
      lease_expires_at timestamptz,
      last_error text,
      run_after timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    alter table approval_requests add column if not exists digest text;
    alter table approval_requests add column if not exists calldata text;
    alter table approval_requests add column if not exists execution_tx_hash text;
    alter table approval_requests add column if not exists error text;
    update approval_requests set digest = '0x' || repeat('0', 64) where digest is null;
    alter table approval_requests alter column digest set not null;
  `);
}
