import { useSearchParams } from "react-router-dom";
import { MOCK_HACKATHONS } from "../mockData";
import { CheckCircle2, XCircle, AlertTriangle, ArrowLeft, ExternalLink, Github, Play } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { Submission } from "../types";

function timeAgo(ts: number) {
  const diff = Date.now() / 1000 - ts;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function FitBadge({ fit }: { fit: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-primary/15 text-primary border-primary/30",
    medium: "bg-accent/15 text-accent border-accent/30",
    low: "bg-destructive/15 text-destructive border-destructive/30",
  };
  return (
    <span className={cn("text-[9px] font-mono uppercase px-1.5 py-0.5 border", styles[fit])}>
      {fit} fit
    </span>
  );
}

function SubmissionDetail({ sub, hackathon }: { sub: Submission; hackathon: typeof MOCK_HACKATHONS[0] }) {
  const track = hackathon.tracks.find((t) => t.id === sub.trackId);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link to="/hackathon/submissions" className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3 w-3" /> All submissions
      </Link>

      {/* Header */}
      <div className="border border-border bg-card p-6 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-black text-foreground">{sub.projectName}</h1>
            <p className="text-xs text-muted-foreground mt-1">by {sub.teamName} · {track?.name}</p>
          </div>
          {sub.qualityScore && (
            <div className="text-right">
              <p className={cn(
                "text-3xl font-black font-mono",
                sub.qualityScore.score >= 85 ? "text-primary" :
                sub.qualityScore.score >= 70 ? "text-accent" : "text-muted-foreground"
              )}>
                {sub.qualityScore.score}
              </p>
              <p className="text-[9px] font-mono text-muted-foreground">QUALITY SCORE</p>
            </div>
          )}
        </div>
        <p className="text-xs text-secondary-foreground leading-relaxed">{sub.description}</p>
        <div className="flex items-center gap-3">
          {sub.githubUrl && (
            <a href={sub.githubUrl} target="_blank" rel="noopener" className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
              <Github className="h-3 w-3" /> Repo <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          {sub.demoUrl && (
            <a href={sub.demoUrl} target="_blank" rel="noopener" className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
              <Play className="h-3 w-3" /> Demo <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          <span className="text-[10px] text-muted-foreground font-mono">Submitted {timeAgo(sub.submittedAt)}</span>
        </div>
      </div>

      {/* Agent Pipeline */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-foreground">Agent Verification Pipeline</h2>
        <div className="grid grid-cols-3 gap-3">
          {/* Eligibility */}
          <div className={cn(
            "border bg-card p-4 space-y-3",
            sub.eligibility?.passed ? "border-primary/30" : sub.eligibility ? "border-destructive/30" : "border-border"
          )}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Agent 1 · Eligibility</p>
                <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{sub.eligibility?.agentId ?? "—"}</p>
              </div>
              {sub.eligibility?.passed ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : sub.eligibility ? (
                <XCircle className="h-5 w-5 text-destructive" />
              ) : (
                <div className="h-5 w-5 border border-border rounded-full" />
              )}
            </div>
            {sub.eligibility && (
              <>
                <div className="space-y-1.5">
                  {[
                    { label: "GitHub live", ok: sub.eligibility.githubLive },
                    { label: "Demo present", ok: sub.eligibility.demoPresent },
                    { label: "Rules met", ok: sub.eligibility.rulesMet },
                  ].map((c) => (
                    <div key={c.label} className="flex items-center gap-2">
                      {c.ok ? (
                        <CheckCircle2 className="h-3 w-3 text-primary" />
                      ) : (
                        <XCircle className="h-3 w-3 text-destructive" />
                      )}
                      <span className="text-[10px] text-secondary-foreground">{c.label}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{sub.eligibility.notes}</p>
              </>
            )}
          </div>

          {/* Track Fit */}
          <div className={cn("border bg-card p-4 space-y-3", sub.trackFit ? "border-accent/30" : "border-border")}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Agent 2 · Track Fit</p>
                <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{sub.trackFit?.agentId ?? "—"}</p>
              </div>
              {sub.trackFit ? <FitBadge fit={sub.trackFit.fit} /> : <div className="h-5 w-5 border border-border rounded-full" />}
            </div>
            {sub.trackFit && (
              <>
                <p className="text-[10px] text-secondary-foreground leading-relaxed">{sub.trackFit.reasoning}</p>
                {sub.trackFit.flags.length > 0 && (
                  <div className="space-y-1">
                    {sub.trackFit.flags.map((f, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[10px] text-accent">
                        <AlertTriangle className="h-3 w-3" /> {f}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Quality */}
          <div className={cn("border bg-card p-4 space-y-3", sub.qualityScore ? "border-primary/30" : "border-border")}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Agent 3 · Quality</p>
                <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{sub.qualityScore?.agentId ?? "—"}</p>
              </div>
              {sub.qualityScore && (
                <span className={cn(
                  "text-xl font-black font-mono",
                  sub.qualityScore.score >= 85 ? "text-primary" :
                  sub.qualityScore.score >= 70 ? "text-accent" : "text-muted-foreground"
                )}>
                  {sub.qualityScore.score}
                </span>
              )}
            </div>
            {sub.qualityScore && (
              <>
                <p className="text-[10px] text-secondary-foreground leading-relaxed">{sub.qualityScore.reasoning}</p>
                {sub.qualityScore.highlights.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[9px] font-mono text-primary uppercase">Highlights</p>
                    {sub.qualityScore.highlights.map((h, i) => (
                      <p key={i} className="text-[10px] text-secondary-foreground">+ {h}</p>
                    ))}
                  </div>
                )}
                {sub.qualityScore.concerns.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[9px] font-mono text-accent uppercase">Concerns</p>
                    {sub.qualityScore.concerns.map((c, i) => (
                      <p key={i} className="text-[10px] text-muted-foreground">– {c}</p>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Submissions() {
  const [params] = useSearchParams();
  const hackathon = MOCK_HACKATHONS[0];
  const selectedId = params.get("id");

  if (selectedId) {
    const sub = hackathon.submissions.find((s) => s.id === selectedId);
    if (sub) return <SubmissionDetail sub={sub} hackathon={hackathon} />;
  }

  const sorted = [...hackathon.submissions].sort((a, b) => {
    if (a.status === "ineligible" && b.status !== "ineligible") return 1;
    if (b.status === "ineligible" && a.status !== "ineligible") return -1;
    return (b.qualityScore?.score ?? 0) - (a.qualityScore?.score ?? 0);
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-black text-foreground">{hackathon.name} — Submissions</h1>
        <p className="text-xs text-muted-foreground mt-1">{hackathon.submissions.length} projects submitted</p>
      </div>

      <div className="space-y-2">
        {sorted.map((sub) => (
          <Link
            key={sub.id}
            to={`/hackathon/submissions?id=${sub.id}`}
            className={cn(
              "block border bg-card p-4 hover:border-accent/40 transition-colors group",
              sub.status === "ineligible" ? "border-destructive/20 opacity-60" : "border-border"
            )}
          >
            <div className="flex items-center gap-4">
              {sub.qualityScore ? (
                <span className={cn(
                  "text-lg font-black font-mono w-10 text-center",
                  sub.qualityScore.score >= 85 ? "text-primary" :
                  sub.qualityScore.score >= 70 ? "text-accent" : "text-muted-foreground"
                )}>
                  {sub.qualityScore.score}
                </span>
              ) : sub.status === "ineligible" ? (
                <XCircle className="h-5 w-5 text-destructive mx-2" />
              ) : (
                <span className="text-lg font-mono text-muted-foreground w-10 text-center">—</span>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-foreground group-hover:text-accent transition-colors">
                    {sub.projectName}
                  </span>
                  <span className="text-[9px] font-mono text-muted-foreground">{sub.teamName}</span>
                  {sub.trackFit && <FitBadge fit={sub.trackFit.fit} />}
                  {sub.status === "ineligible" && (
                    <span className="text-[9px] font-mono text-destructive uppercase">Ineligible</span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {sub.eligibility?.passed && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                <span className="text-[10px] text-muted-foreground">{timeAgo(sub.submittedAt)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
