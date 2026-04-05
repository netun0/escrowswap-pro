import { HEDERA_API_URL } from "@/contracts/env";
import type {
  ApprovalRequest,
  CreateHackathonRequest,
  CreateSubmissionRequest,
  EventEnvelope,
  HackathonRecord,
  SubmissionRecord,
} from "../../packages/shared/src/index";

type PipelineResponse = {
  approvals: ApprovalRequest[];
  events: EventEnvelope[];
  hcsAudit: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
};

function apiBase(): string {
  if (!HEDERA_API_URL) {
    throw new Error("Set VITE_HEDERA_API_URL to use JudgeBuddy.");
  }
  return HEDERA_API_URL.replace(/\/$/, "");
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    credentials: "include",
    ...init,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || response.statusText);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function listHackathons(): Promise<HackathonRecord[]> {
  return readJson<HackathonRecord[]>("/hackathons");
}

export function getHackathon(id: string): Promise<HackathonRecord> {
  return readJson<HackathonRecord>(`/hackathons/${encodeURIComponent(id)}`);
}

export function createHackathon(input: CreateHackathonRequest): Promise<HackathonRecord> {
  return readJson<HackathonRecord>("/hackathons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function fundHackathon(id: string, txHash: string): Promise<{ ok: boolean; txHash: string }> {
  return readJson<{ ok: boolean; txHash: string }>(`/hackathons/${encodeURIComponent(id)}/fund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash }),
  });
}

export function listSubmissions(hackathonId: string): Promise<SubmissionRecord[]> {
  return readJson<SubmissionRecord[]>(`/submissions?hackathonId=${encodeURIComponent(hackathonId)}`);
}

export function getSubmission(id: string): Promise<SubmissionRecord> {
  return readJson<SubmissionRecord>(`/submissions/${encodeURIComponent(id)}`);
}

export function createSubmission(input: CreateSubmissionRequest): Promise<SubmissionRecord> {
  return readJson<SubmissionRecord>("/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function queueEvaluation(submissionId: string, force = false): Promise<{ jobId: string }> {
  return readJson<{ jobId: string }>(`/submissions/${encodeURIComponent(submissionId)}/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force }),
  });
}

export function fetchPipeline(hackathonId?: string): Promise<PipelineResponse> {
  const suffix = hackathonId ? `?hackathonId=${encodeURIComponent(hackathonId)}` : "";
  return readJson<PipelineResponse>(`/pipeline${suffix}`);
}

export function approveAward(awardId: string, approval: ApprovalRequest["typedData"]["message"], signature: string) {
  return readJson<{ jobId: string; digest: string }>(`/awards/${encodeURIComponent(awardId)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      approval,
      signature,
    }),
  });
}

export function redeemClaim(claimId: string): Promise<{ jobId: string }> {
  return readJson<{ jobId: string }>(`/claims/${encodeURIComponent(claimId)}/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claimId }),
  });
}

export function listEvents(hackathonId?: string): Promise<EventEnvelope[]> {
  const suffix = hackathonId ? `?hackathonId=${encodeURIComponent(hackathonId)}` : "";
  return readJson<EventEnvelope[]>(`/events${suffix}`);
}
