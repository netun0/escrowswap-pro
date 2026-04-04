import { MOCK_AGENT_ACTIVITY, MOCK_HACKATHONS } from "../mockData";
import { Bot, CheckCircle2, Shield, Sparkles, ExternalLink, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentRole } from "../types";

function timeAgo(ts: number) {
  const diff = Date.now() / 1000 - ts;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const agentConfig: Record<AgentRole, { label: string; desc: string; icon: typeof Bot; color: string }> = {
  eligibility: {
    label: "Sentinel",
    desc: "Checks repo, demo, and rule compliance. Binary pass/fail.",
    icon: CheckCircle2,
    color: "text-primary",
  },
  "track-fit": {
    label: "TrackFit",
    desc: "Reads track requirements and scores project alignment.",
    icon: Shield,
    color: "text-accent",
  },
  quality: {
    label: "Oracle",
    desc: "LLM trained on every ETH Global winner. Scores 0–100 with reasoning.",
    icon: Sparkles,
    color: "text-[hsl(var(--state-submitted))]",
  },
  payout: {
    label: "Settler",
    desc: "Executes USDC payout via smart contract on winner confirmation.",
    icon: Bot,
    color: "text-[hsl(var(--state-verified))]",
  },
  clustering: {
    label: "Converge",
    desc: "Embedding similarity + LLM labels group submissions by project theme for judges.",
    icon: Layers,
    color: "text-violet-500",
  },
};

const PIPELINE_AGENT_ROLES = ["eligibility", "track-fit", "quality", "clustering"] as const satisfies readonly AgentRole[];

function agentBadgeIndex(role: AgentRole): string {
  const order: Record<(typeof PIPELINE_AGENT_ROLES)[number], string> = {
    eligibility: "1",
    "track-fit": "2",
    quality: "3",
    clustering: "4",
  };
  return order[role as keyof typeof order] ?? "?";
}

function agentProgressClass(role: AgentRole): string {
  if (role === "eligibility") return "bg-primary";
  if (role === "track-fit") return "bg-accent";
  if (role === "quality") return "bg-[hsl(var(--state-submitted))]";
  if (role === "clustering") return "bg-violet-500";
  return "bg-muted-foreground";
}

export default function AgentPipeline() {
  const hackathon = MOCK_HACKATHONS[0];
  const totalChecked = hackathon.submissions.filter((s) => s.eligibility).length;
  const totalScored = hackathon.submissions.filter((s) => s.qualityScore).length;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-black text-foreground">Agent Pipeline</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Four autonomous agents verify, score, and group submissions. Humans make the final call.
        </p>
      </div>

      {/* Agent cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {PIPELINE_AGENT_ROLES.map((role) => {
          const cfg = agentConfig[role];
          const Icon = cfg.icon;
          const activity = MOCK_AGENT_ACTIVITY.filter((a) => a.agentRole === role);
          const denom =
            role === "clustering" && hackathon.similarityClusters?.length
              ? hackathon.submissions.length
              : Math.max(hackathon.submissions.length, 1);
          const numer =
            role === "clustering" && hackathon.similarityClusters?.length
              ? hackathon.submissions.length
              : activity.length;
          return (
            <div key={role} className="border border-border bg-card p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", cfg.color)} />
                    <p className="text-sm font-bold text-foreground">{cfg.label}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">{cfg.desc}</p>
                </div>
                <span className="text-[9px] font-mono px-1.5 py-0.5 bg-secondary text-secondary-foreground">
                  Agent {agentBadgeIndex(role)}
                </span>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">{role === "clustering" ? "Runs" : "Processed"}</span>
                  <span className="font-mono text-foreground">
                    {role === "clustering" && hackathon.similarityClusters?.length
                      ? `${hackathon.similarityClusters.length} groups`
                      : `${activity.length} submissions`}
                  </span>
                </div>
                <div className="h-1 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", agentProgressClass(role))}
                    style={{ width: `${(numer / denom) * 100}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Recent activity</p>
                {activity.slice(0, 3).map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground">{timeAgo(a.timestamp)}</span>
                    <span className="text-secondary-foreground truncate flex-1">{a.action}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pipeline visualization */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-foreground">Verification Flow</h2>
        <div className="border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            {[
              { label: "Submitted", count: hackathon.submissions.length, color: "bg-muted-foreground" },
              { label: "Eligibility Check", count: totalChecked, color: "bg-primary" },
              { label: "Track Fit Scored", count: hackathon.submissions.filter((s) => s.trackFit).length, color: "bg-accent" },
              { label: "Quality Scored", count: totalScored, color: "bg-[hsl(var(--state-submitted))]" },
              { label: "Ready for Judges", count: totalScored, color: "bg-primary" },
            ].map((step, i, arr) => (
              <div key={step.label} className="flex items-center gap-3">
                <div className="text-center space-y-1">
                  <div className={cn("h-8 w-8 rounded-full flex items-center justify-center mx-auto", step.color)}>
                    <span className="text-xs font-black text-background">{step.count}</span>
                  </div>
                  <p className="text-[9px] text-muted-foreground max-w-[80px]">{step.label}</p>
                </div>
                {i < arr.length - 1 && (
                  <div className="h-px w-8 bg-border" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Audit trail */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-foreground">Hedera Audit Trail</h2>
          <span className="text-[9px] font-mono px-1.5 py-0.5 bg-secondary text-secondary-foreground">HCS</span>
        </div>
        <div className="border border-border bg-card divide-y divide-border">
          {MOCK_AGENT_ACTIVITY.sort((a, b) => b.timestamp - a.timestamp).map((a) => {
            const cfg = agentConfig[a.agentRole];
            const Icon = cfg.icon;
            return (
              <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.color)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-foreground">{a.agentName}</span>
                    <span className="text-[10px] text-secondary-foreground truncate">{a.action}</span>
                  </div>
                </div>
                <span className="text-[9px] text-muted-foreground shrink-0">{timeAgo(a.timestamp)}</span>
                <a
                  href="#"
                  className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground hover:text-foreground shrink-0"
                  title={a.hederaTxId}
                >
                  HCS <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
