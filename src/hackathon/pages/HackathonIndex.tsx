import { Link } from "react-router-dom";
import { MOCK_HACKATHONS } from "../mockData";
import { Trophy, Lock, Clock, Users, ArrowRight, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
  upcoming: { label: "Upcoming", color: "text-[hsl(var(--state-open))]", dot: "bg-[hsl(var(--state-open))]" },
  live: { label: "Live Now", color: "text-[hsl(var(--state-funded))]", dot: "bg-[hsl(var(--state-funded))]" },
  judging: { label: "Judging", color: "text-[hsl(var(--accent))]", dot: "bg-accent" },
  completed: { label: "Completed", color: "text-[hsl(var(--state-verified))]", dot: "bg-[hsl(var(--state-verified))]" },
};

function formatUSD(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function HackathonIndex() {
  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-accent" />
          <span className="text-[10px] font-mono text-accent uppercase tracking-widest">Hackathon boost</span>
        </div>
        <h1 className="text-3xl font-black text-foreground tracking-tight">
          JudgeBuddy
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
          Prize pools locked in escrow. Agent-verified submissions. Automatic USDC payouts.
          No delays, no trust issues, no drama.
        </p>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { step: "01", title: "Escrow Lock", desc: "Prize pool locked onchain. Trustless guarantee." },
          { step: "02", title: "Agent Verify", desc: "3 agents check eligibility, fit, and quality." },
          { step: "03", title: "Human Judge", desc: "Ranked list, not 500 raw submissions." },
          { step: "04", title: "Auto Payout", desc: "USDC released instantly on confirmation." },
        ].map((s) => (
          <div key={s.step} className="border border-border bg-card p-4 space-y-2">
            <span className="text-[10px] font-mono text-accent">{s.step}</span>
            <p className="text-xs font-bold text-foreground">{s.title}</p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>

      {/* Hackathon list */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-foreground">Events</h2>
        <div className="space-y-3">
          {MOCK_HACKATHONS.map((h) => {
            const cfg = statusConfig[h.status];
            return (
              <Link
                key={h.id}
                to={`/hackathon/live?id=${h.id}`}
                className="block border border-border bg-card p-5 hover:border-accent/40 transition-colors group"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-bold text-foreground group-hover:text-accent transition-colors">
                        {h.name}
                      </h3>
                      <div className="flex items-center gap-1.5">
                        <div className={cn("h-1.5 w-1.5 rounded-full animate-pulse", cfg.dot)} />
                        <span className={cn("text-[10px] font-mono uppercase", cfg.color)}>{cfg.label}</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{h.tagline}</p>
                    <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(h.startsAt)} — {formatDate(h.endsAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {h.submissions.length} submissions
                      </span>
                      <span className="flex items-center gap-1 font-mono text-muted-foreground">
                        {h.organizer}
                      </span>
                    </div>
                  </div>
                  <div className="text-right space-y-2">
                    <div className="flex items-center gap-2">
                      {h.escrowLocked && <Lock className="h-3 w-3 text-primary" />}
                      <div className="flex items-center gap-1">
                        <Trophy className="h-3.5 w-3.5 text-accent" />
                        <span className="text-sm font-black font-mono text-foreground">
                          {formatUSD(h.prizePool)}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] text-primary font-mono">
                      {h.escrowLocked ? "Escrowed ✓" : "Pending"}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {h.tracks.map((t) => (
                    <span
                      key={t.id}
                      className="text-[9px] font-mono px-2 py-0.5 bg-secondary text-secondary-foreground"
                    >
                      {t.name} · {formatUSD(t.prize)}
                    </span>
                  ))}
                  <ArrowRight className="h-3 w-3 text-muted-foreground ml-auto group-hover:text-accent transition-colors" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
