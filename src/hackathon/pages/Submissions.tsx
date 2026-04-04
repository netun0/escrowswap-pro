import { useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { MOCK_HACKATHONS } from "../mockData";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Github,
  Play,
  LayoutGrid,
  List,
  Layers,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { Hackathon, SimilarityCluster, Submission } from "../types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function findHackathonOwningSubmission(submissionId: string): Hackathon | undefined {
  return MOCK_HACKATHONS.find((h) => h.submissions.some((s) => s.id === submissionId));
}

function resolveHackathon(searchParams: URLSearchParams): Hackathon {
  const detailId = searchParams.get("id");
  if (detailId) {
    const owner = findHackathonOwningSubmission(detailId);
    if (owner) return owner;
  }
  const h = searchParams.get("h") ?? "";
  return MOCK_HACKATHONS.find((x) => x.id === h) ?? MOCK_HACKATHONS[0];
}

function timeAgo(ts: number) {
  const diff = Date.now() / 1000 - ts;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function sortSubmissions(subs: Submission[]): Submission[] {
  return [...subs].sort((a, b) => {
    if (a.status === "ineligible" && b.status !== "ineligible") return 1;
    if (b.status === "ineligible" && a.status !== "ineligible") return -1;
    return (b.qualityScore?.score ?? 0) - (a.qualityScore?.score ?? 0);
  });
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

function SubmissionListRow({ sub, hackathonId }: { sub: Submission; hackathonId: string }) {
  const q = new URLSearchParams({ h: hackathonId, id: sub.id });
  return (
    <Link
      to={`/hackathon/submissions?${q.toString()}`}
      className={cn(
        "block border bg-card p-4 hover:border-accent/40 transition-colors group",
        sub.status === "ineligible" ? "border-destructive/20 opacity-60" : "border-border",
      )}
    >
      <div className="flex items-center gap-4">
        {sub.qualityScore ? (
          <span
            className={cn(
              "text-lg font-black font-mono w-10 text-center",
              sub.qualityScore.score >= 85
                ? "text-primary"
                : sub.qualityScore.score >= 70
                  ? "text-accent"
                  : "text-muted-foreground",
            )}
          >
            {sub.qualityScore.score}
          </span>
        ) : sub.status === "ineligible" ? (
          <XCircle className="h-5 w-5 text-destructive mx-2" />
        ) : (
          <span className="text-lg font-mono text-muted-foreground w-10 text-center">—</span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
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
        <div className="flex items-center gap-2 shrink-0">
          {sub.eligibility?.passed && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
          <span className="text-[10px] text-muted-foreground">{timeAgo(sub.submittedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

function ClusterSection({
  cluster,
  subs,
  hackathonId,
}: {
  cluster: SimilarityCluster;
  subs: Submission[];
  hackathonId: string;
}) {
  const sorted = sortSubmissions(subs);
  if (sorted.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="rounded-md border border-violet-500/25 bg-violet-500/[0.06] px-4 py-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-violet-500 shrink-0" />
            <h2 className="text-sm font-bold text-foreground">{cluster.label}</h2>
          </div>
          <span className="text-[9px] font-mono text-muted-foreground">
            Agent {cluster.agentId} · similarity · {timeAgo(cluster.clusteredAt)}
          </span>
        </div>
        <p className="text-[11px] text-secondary-foreground leading-snug">{cluster.theme}</p>
        <p className="text-[10px] text-muted-foreground leading-relaxed border-t border-violet-500/15 pt-2">
          <span className="font-mono text-violet-600 dark:text-violet-400">Converge · </span>
          {cluster.agentRationale}
        </p>
        <p className="text-[9px] font-mono text-muted-foreground">
          {sorted.length} submission{sorted.length === 1 ? "" : "s"} in this theme
        </p>
      </div>
      <div className="space-y-2 pl-1 border-l-2 border-violet-500/30">
        {sorted.map((sub) => (
          <SubmissionListRow key={sub.id} sub={sub} hackathonId={hackathonId} />
        ))}
      </div>
    </section>
  );
}

function SubmissionDetail({
  sub,
  hackathon,
  listQuery,
}: {
  sub: Submission;
  hackathon: Hackathon;
  listQuery: string;
}) {
  const track = hackathon.tracks.find((t) => t.id === sub.trackId);
  const cluster = hackathon.similarityClusters?.find((c) => c.submissionIds.includes(sub.id));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link
        to={`/hackathon/submissions${listQuery}`}
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3 w-3" /> All submissions
      </Link>

      {/* Header */}
      <div className="border border-border bg-card p-6 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-black text-foreground">{sub.projectName}</h1>
            <p className="text-xs text-muted-foreground mt-1">
              by {sub.teamName} · {track?.name}
            </p>
          </div>
          {sub.qualityScore && (
            <div className="text-right">
              <p
                className={cn(
                  "text-3xl font-black font-mono",
                  sub.qualityScore.score >= 85
                    ? "text-primary"
                    : sub.qualityScore.score >= 70
                      ? "text-accent"
                      : "text-muted-foreground",
                )}
              >
                {sub.qualityScore.score}
              </p>
              <p className="text-[9px] font-mono text-muted-foreground">QUALITY SCORE</p>
            </div>
          )}
        </div>
        <p className="text-xs text-secondary-foreground leading-relaxed">{sub.description}</p>
        <div className="flex items-center gap-3">
          {sub.githubUrl && (
            <a
              href={sub.githubUrl}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <Github className="h-3 w-3" /> Repo <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          {sub.demoUrl && (
            <a
              href={sub.demoUrl}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <Play className="h-3 w-3" /> Demo <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          <span className="text-[10px] text-muted-foreground font-mono">Submitted {timeAgo(sub.submittedAt)}</span>
        </div>
      </div>

      {cluster && (
        <div className="rounded-md border border-violet-500/25 bg-violet-500/[0.06] p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            <p className="text-[10px] font-mono uppercase tracking-wider text-violet-600 dark:text-violet-400">
              Similarity group
            </p>
          </div>
          <p className="text-sm font-bold text-foreground">{cluster.label}</p>
          <p className="text-[11px] text-secondary-foreground">{cluster.theme}</p>
        </div>
      )}

      {/* Agent Pipeline */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-foreground">Agent Verification Pipeline</h2>
        <div className="grid grid-cols-3 gap-3">
          {/* Eligibility */}
          <div
            className={cn(
              "border bg-card p-4 space-y-3",
              sub.eligibility?.passed ? "border-primary/30" : sub.eligibility ? "border-destructive/30" : "border-border",
            )}
          >
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
                <span
                  className={cn(
                    "text-xl font-black font-mono",
                    sub.qualityScore.score >= 85
                      ? "text-primary"
                      : sub.qualityScore.score >= 70
                        ? "text-accent"
                        : "text-muted-foreground",
                  )}
                >
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
                      <p key={i} className="text-[10px] text-secondary-foreground">
                        + {h}
                      </p>
                    ))}
                  </div>
                )}
                {sub.qualityScore.concerns.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[9px] font-mono text-accent uppercase">Concerns</p>
                    {sub.qualityScore.concerns.map((c, i) => (
                      <p key={i} className="text-[10px] text-muted-foreground">
                        – {c}
                      </p>
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

function HackathonPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Event</p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-full sm:w-[min(100%,20rem)] text-xs">
          <SelectValue placeholder="Select hackathon" />
        </SelectTrigger>
        <SelectContent>
          {MOCK_HACKATHONS.map((h) => (
            <SelectItem key={h.id} value={h.id} className="text-xs font-mono">
              {h.name} ({h.submissions.length})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function Submissions() {
  const [params, setSearchParams] = useSearchParams();
  const searchKey = params.toString();
  const hackathon = useMemo(() => resolveHackathon(new URLSearchParams(searchKey)), [searchKey]);
  const selectedId = params.get("id");
  const hasClusters = (hackathon.similarityClusters?.length ?? 0) > 0;
  const [view, setView] = useState<"grouped" | "flat">(() => (hasClusters ? "grouped" : "flat"));

  useEffect(() => {
    setView(hasClusters ? "grouped" : "flat");
  }, [hackathon.id, hasClusters]);

  const setHackathonId = (id: string) => {
    setSearchParams({ h: id });
  };

  const clusteredIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of hackathon.similarityClusters ?? []) {
      for (const id of c.submissionIds) ids.add(id);
    }
    return ids;
  }, [hackathon.similarityClusters]);

  const ungroupedSubs = useMemo(
    () => hackathon.submissions.filter((s) => !clusteredIds.has(s.id)),
    [hackathon.submissions, clusteredIds],
  );

  const submissionById = useMemo(() => {
    const m = new Map<string, Submission>();
    for (const s of hackathon.submissions) m.set(s.id, s);
    return m;
  }, [hackathon.submissions]);

  const listQuery = `?${new URLSearchParams({ h: hackathon.id }).toString()}`;

  if (selectedId) {
    const sub = hackathon.submissions.find((s) => s.id === selectedId);
    if (sub) {
      return (
        <div className="max-w-4xl mx-auto space-y-4">
          <HackathonPicker value={hackathon.id} onChange={setHackathonId} />
          <SubmissionDetail sub={sub} hackathon={hackathon} listQuery={listQuery} />
        </div>
      );
    }
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <HackathonPicker value={hackathon.id} onChange={setHackathonId} />
        <p className="text-sm text-muted-foreground">
          No submission <span className="font-mono text-foreground">{selectedId}</span> in this event.
        </p>
        <Link
          to={`/hackathon/submissions${listQuery}`}
          className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to submissions
        </Link>
      </div>
    );
  }

  const sortedFlat = sortSubmissions(hackathon.submissions);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <HackathonPicker value={hackathon.id} onChange={setHackathonId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-black text-foreground">{hackathon.name} — Submissions</h1>
          <p className="text-xs text-muted-foreground mt-1">{hackathon.submissions.length} projects submitted</p>
        </div>
        {hasClusters && (
          <div className="flex rounded-md border border-border bg-muted/30 p-0.5">
            <Button
              type="button"
              variant={view === "grouped" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 text-[10px] font-mono gap-1.5"
              onClick={() => setView("grouped")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              By theme
            </Button>
            <Button
              type="button"
              variant={view === "flat" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 text-[10px] font-mono gap-1.5"
              onClick={() => setView("flat")}
            >
              <List className="h-3.5 w-3.5" />
              All submissions
            </Button>
          </div>
        )}
      </div>

      {hackathon.submissions.length === 0 ? (
        <p className="rounded-md border border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          No submissions for this event yet.
        </p>
      ) : view === "flat" || !hasClusters ? (
        <div className="space-y-2">
          {sortedFlat.map((sub) => (
            <SubmissionListRow key={sub.id} sub={sub} hackathonId={hackathon.id} />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Themes below are produced by the <strong className="text-foreground">Converge</strong> similarity agent (embeddings +
            rationale). Use them to compare projects in the same idea neighborhood before deep-diving each repo.
          </p>
          {(hackathon.similarityClusters ?? []).map((cluster) => {
            const subs = cluster.submissionIds.map((id) => submissionById.get(id)).filter(Boolean) as Submission[];
            return (
              <ClusterSection key={cluster.id} cluster={cluster} subs={subs} hackathonId={hackathon.id} />
            );
          })}
          {ungroupedSubs.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-bold text-foreground">Other submissions</h2>
              <p className="text-[10px] text-muted-foreground">Not assigned to a similarity group yet.</p>
              <div className="space-y-2">
                {sortSubmissions(ungroupedSubs).map((sub) => (
                  <SubmissionListRow key={sub.id} sub={sub} hackathonId={hackathon.id} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
