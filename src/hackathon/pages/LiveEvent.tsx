import { useSearchParams } from "react-router-dom";
import { MOCK_HACKATHONS } from "../mockData";
import { Trophy, Lock, Shield, Clock, Users, CheckCircle2, XCircle, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

function formatUSD(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function timeRemaining(ts: number) {
  const diff = ts - Date.now() / 1000;
  if (diff <= 0) return "Ended";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

export default function LiveEvent() {
  const [params] = useSearchParams();
  const hackathon = MOCK_HACKATHONS.find((h) => h.id === params.get("id")) ?? MOCK_HACKATHONS[0];

  const eligible = hackathon.submissions.filter((s) => s.eligibility?.passed);
  const scored = hackathon.submissions.filter((s) => s.qualityScore);
  const ineligible = hackathon.submissions.filter((s) => s.status === "ineligible");

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="border border-border bg-card p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-black text-foreground">{hackathon.name}</h1>
            <p className="text-xs text-muted-foreground">{hackathon.tagline}</p>
          </div>
          <div className="flex items-center gap-2 bg-primary/10 border border-primary/30 px-3 py-2">
            <Lock className="h-3.5 w-3.5 text-primary" />
            <div className="text-right">
              <p className="text-lg font-black font-mono text-foreground">{formatUSD(hackathon.prizePool)}</p>
              <p className="text-[9px] font-mono text-primary">LOCKED IN ESCROW</p>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Submissions", value: hackathon.submissions.length, icon: Users },
            { label: "Eligible", value: eligible.length, icon: CheckCircle2 },
            { label: "Scored", value: scored.length, icon: Shield },
            { label: "Judging Ends", value: timeRemaining(hackathon.judgingEndsAt), icon: Clock },
          ].map((s) => (
            <div key={s.label} className="bg-secondary/50 p-3 space-y-1">
              <div className="flex items-center gap-1.5">
                <s.icon className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">{s.label}</span>
              </div>
              <p className="text-sm font-bold font-mono text-foreground">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tracks */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-foreground">Tracks & Prizes</h2>
        <div className="grid grid-cols-3 gap-3">
          {hackathon.tracks.map((track) => {
            const trackSubs = hackathon.submissions.filter((s) => s.trackId === track.id);
            const topSub = trackSubs
              .filter((s) => s.qualityScore)
              .sort((a, b) => (b.qualityScore?.score ?? 0) - (a.qualityScore?.score ?? 0))[0];
            return (
              <div key={track.id} className="border border-border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-bold text-foreground">{track.name}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{track.description}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Trophy className="h-3 w-3 text-accent" />
                    <span className="text-xs font-black font-mono text-accent">{formatUSD(track.prize)}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] font-mono text-muted-foreground uppercase">Requirements</p>
                  {track.requirements.map((r, i) => (
                    <p key={i} className="text-[10px] text-secondary-foreground flex items-center gap-1.5">
                      <span className="h-1 w-1 bg-primary rounded-full shrink-0" />
                      {r}
                    </p>
                  ))}
                </div>
                {topSub && (
                  <div className="border-t border-border pt-2 mt-2">
                    <p className="text-[9px] text-muted-foreground mb-1">Leading</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-foreground">{topSub.projectName}</span>
                      <span className="text-[10px] font-mono text-accent">{topSub.qualityScore?.score}/100</span>
                    </div>
                  </div>
                )}
                <p className="text-[9px] text-muted-foreground">{trackSubs.length} submission{trackSubs.length !== 1 ? "s" : ""}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Ranked submissions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">Agent-Ranked Submissions</h2>
          <Link to="/hackathon/submissions" className="text-[10px] text-accent hover:underline flex items-center gap-1">
            View all <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="space-y-2">
          {hackathon.submissions
            .filter((s) => s.qualityScore)
            .sort((a, b) => (b.qualityScore?.score ?? 0) - (a.qualityScore?.score ?? 0))
            .map((sub, idx) => (
              <Link
                key={sub.id}
                to={`/hackathon/submissions?id=${sub.id}`}
                className="block border border-border bg-card p-4 hover:border-accent/40 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <span className={cn(
                    "text-lg font-black font-mono w-8 text-center",
                    idx === 0 ? "text-accent" : "text-muted-foreground"
                  )}>
                    #{idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-foreground group-hover:text-accent transition-colors">
                        {sub.projectName}
                      </span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 bg-secondary text-secondary-foreground">
                        {sub.teamName}
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground">
                        {hackathon.tracks.find((t) => t.id === sub.trackId)?.name}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub.description}</p>
                  </div>
                  <div className="text-right space-y-0.5">
                    <p className={cn(
                      "text-lg font-black font-mono",
                      (sub.qualityScore?.score ?? 0) >= 85 ? "text-primary" :
                      (sub.qualityScore?.score ?? 0) >= 70 ? "text-accent" : "text-muted-foreground"
                    )}>
                      {sub.qualityScore?.score}
                    </p>
                    <p className="text-[9px] text-muted-foreground font-mono">/ 100</p>
                  </div>
                </div>
              </Link>
            ))}

          {/* Ineligible */}
          {ineligible.map((sub) => (
            <div
              key={sub.id}
              className="border border-destructive/20 bg-destructive/5 p-4 opacity-60"
            >
              <div className="flex items-center gap-4">
                <XCircle className="h-4 w-4 text-destructive shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground">{sub.projectName}</span>
                    <span className="text-[9px] font-mono text-destructive">INELIGIBLE</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{sub.eligibility?.notes}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
