export type HackathonStatus = "upcoming" | "live" | "judging" | "completed";
export type SubmissionStatus = "pending" | "eligible" | "ineligible" | "scored" | "winner";
export type AgentRole = "eligibility" | "track-fit" | "quality" | "payout";

export interface Hackathon {
  id: string;
  name: string;
  tagline: string;
  prizePool: number; // in USDC
  prizeToken: string;
  status: HackathonStatus;
  tracks: Track[];
  startsAt: number;
  endsAt: number;
  submissionDeadline: number;
  judgingEndsAt: number;
  submissions: Submission[];
  escrowLocked: boolean;
  escrowTxHash: string;
  organizer: string;
}

export interface Track {
  id: string;
  name: string;
  description: string;
  prize: number;
  requirements: string[];
}

export interface Submission {
  id: string;
  hackathonId: string;
  trackId: string;
  projectName: string;
  team: string[];
  teamName: string;
  githubUrl: string;
  demoUrl: string;
  description: string;
  submittedAt: number;
  status: SubmissionStatus;
  eligibility: EligibilityCheck | null;
  trackFit: TrackFitScore | null;
  qualityScore: QualityScore | null;
  finalRank: number | null;
  payoutTxHash: string | null;
}

export interface EligibilityCheck {
  agentId: string;
  timestamp: number;
  githubLive: boolean;
  demoPresent: boolean;
  rulesMet: boolean;
  passed: boolean;
  notes: string;
}

export interface TrackFitScore {
  agentId: string;
  timestamp: number;
  fit: "high" | "medium" | "low";
  flags: string[];
  reasoning: string;
}

export interface QualityScore {
  agentId: string;
  timestamp: number;
  score: number; // 0-100
  reasoning: string;
  highlights: string[];
  concerns: string[];
}

export interface AgentActivity {
  id: string;
  agentName: string;
  agentRole: AgentRole;
  action: string;
  submissionId: string;
  timestamp: number;
  hederaTxId: string;
}
