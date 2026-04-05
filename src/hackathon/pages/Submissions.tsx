import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchHackathon, fetchHackathons, queueEvaluation } from "@/hackathon/api";
import { formatDateTime, formatTokenAmount, relativeTime, shorten } from "@/hackathon/format";

function readScore(result: Record<string, unknown> | null | undefined): number | null {
  if (!result || typeof result.score !== "number") return null;
  return result.score;
}

export default function Submissions() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();

  const hackathons = useQuery({
    queryKey: ["hackathons"],
    queryFn: fetchHackathons,
  });

  const selectedHackathonId = useMemo(() => {
    const fromQuery = params.get("h");
    if (fromQuery) return fromQuery;
    return hackathons.data?.[0]?.id ?? "";
  }, [hackathons.data, params]);

  useEffect(() => {
    if (!params.get("h") && hackathons.data?.[0]?.id) {
      setParams({ h: hackathons.data[0].id });
    }
  }, [hackathons.data, params, setParams]);

  const detail = useQuery({
    queryKey: ["hackathon", selectedHackathonId],
    queryFn: () => fetchHackathon(selectedHackathonId),
    enabled: Boolean(selectedHackathonId),
    refetchInterval: 8000,
  });

  const selectedSubmissionId = params.get("id");
  const selectedSubmission = useMemo(
    () => detail.data?.submissions.find((submission) => submission.id === selectedSubmissionId) ?? detail.data?.submissions[0] ?? null,
    [detail.data?.submissions, selectedSubmissionId],
  );

  const queueMutation = useMutation({
    mutationFn: async (submissionId: string) => queueEvaluation(submissionId, true),
    onSuccess: async () => {
      toast.success("Evaluation queued.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["hackathon", selectedHackathonId] }),
        queryClient.invalidateQueries({ queryKey: ["events", selectedHackathonId] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not queue evaluation");
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>

        <select
          value={selectedHackathonId}
          onChange={(event) => setParams({ h: event.target.value })}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {(hackathons.data ?? []).map((hackathon) => (
            <option key={hackathon.id} value={hackathon.id}>
              {hackathon.name}
            </option>
          ))}
        </select>
      </div>

      {detail.isLoading ? (
        <div className="flex items-center gap-2 border border-border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading submissions
        </div>
      ) : detail.data ? (
        <div className="grid gap-6 lg:grid-cols-[0.9fr,1.1fr]">
          <section className="space-y-4">
            <div className="border border-border bg-card p-6">
              <h1 className="text-2xl font-black tracking-tight text-foreground">Submissions</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {detail.data.name} · {detail.data.submissions.length} total
              </p>
            </div>

            <div className="space-y-3">
              {detail.data.submissions.map((submission) => {
                const qualityRun = submission.evaluationRuns.find((run) => run.agentRole === "quality");
                const score = readScore(qualityRun?.result);
                return (
                  <button
                    key={submission.id}
                    type="button"
                    onClick={() => setParams({ h: selectedHackathonId, id: submission.id })}
                    className={`w-full border bg-card p-4 text-left transition-colors ${
                      selectedSubmission?.id === submission.id ? "border-accent" : "border-border hover:border-accent/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-bold text-foreground">{submission.projectName}</h2>
                        <p className="mt-1 text-[11px] text-muted-foreground">{submission.teamName}</p>
                        <p className="mt-2 text-[11px] text-muted-foreground">{submission.status}</p>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg text-foreground">{score ?? "—"}</div>
                        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">quality</div>
                      </div>
                    </div>
                  </button>
                );
              })}

              {!detail.data.submissions.length ? (
                <div className="border border-border bg-card p-6 text-sm text-muted-foreground">
                  No submissions yet. Share the submit link with teams once the treasury is funded.
                </div>
              ) : null}
            </div>
          </section>

          <section className="space-y-4">
            {selectedSubmission ? (
              <>
                <div className="border border-border bg-card p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-2xl font-black tracking-tight text-foreground">{selectedSubmission.projectName}</h2>
                      <p className="mt-2 text-sm text-muted-foreground">{selectedSubmission.description}</p>
                    </div>
                    <Button onClick={() => queueMutation.mutate(selectedSubmission.id)} disabled={queueMutation.isPending}>
                      {queueMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Re-run evaluation
                    </Button>
                  </div>

                  <div className="mt-5 grid gap-3 text-[11px] text-muted-foreground sm:grid-cols-2">
                    <div>
                      Team
                      <div className="font-mono text-foreground">{selectedSubmission.teamName}</div>
                    </div>
                    <div>
                      Track
                      <div className="font-mono text-foreground">{selectedSubmission.trackId}</div>
                    </div>
                    <div>
                      Payout account
                      <div className="font-mono text-foreground">{selectedSubmission.payoutAccountId}</div>
                    </div>
                    <div>
                      Payout EVM
                      <div className="font-mono text-foreground">{shorten(selectedSubmission.payoutEvmAddress, 10, 8)}</div>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button variant="outline" asChild>
                      <a href={selectedSubmission.githubUrl} target="_blank" rel="noreferrer">
                        GitHub
                        <ExternalLink className="ml-2 h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button variant="outline" asChild>
                      <a href={selectedSubmission.demoUrl} target="_blank" rel="noreferrer">
                        Demo
                        <ExternalLink className="ml-2 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="border border-border bg-card p-6">
                  <h3 className="text-lg font-black text-foreground">Agent runs</h3>
                  <div className="mt-4 space-y-3">
                    {selectedSubmission.evaluationRuns.map((run) => (
                      <div key={run.id} className="border border-border bg-background/40 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-mono text-sm text-foreground">{run.agentRole}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {run.status} · {run.completedAt ? relativeTime(run.completedAt) : "pending"}
                            </div>
                          </div>
                          <div className="text-right text-[11px] text-muted-foreground">
                            {run.completedAt ? formatDateTime(run.completedAt) : "—"}
                          </div>
                        </div>
                        {run.result ? (
                          <pre className="mt-3 overflow-auto rounded-md bg-card p-3 text-[11px] text-muted-foreground">
                            {JSON.stringify(run.result, null, 2)}
                          </pre>
                        ) : null}
                        {run.error ? <p className="mt-3 text-[11px] text-destructive">{run.error}</p> : null}
                      </div>
                    ))}
                    {!selectedSubmission.evaluationRuns.length ? (
                      <p className="text-sm text-muted-foreground">No evaluation runs stored yet.</p>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="border border-border bg-card p-6">
                    <h3 className="text-lg font-black text-foreground">Award proposal</h3>
                    {selectedSubmission.awardProposal ? (
                      <div className="mt-4 space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Status</span>
                          <span className="font-mono text-foreground">{selectedSubmission.awardProposal.status}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Settlement</span>
                          <span className="font-mono text-foreground">{selectedSubmission.awardProposal.settlementMode}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Amount</span>
                          <span className="font-mono text-foreground">{formatTokenAmount(selectedSubmission.awardProposal.amount)}</span>
                        </div>
                        <p className="pt-2 text-[11px] text-muted-foreground">{selectedSubmission.awardProposal.reason}</p>
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-muted-foreground">No award has been proposed for this submission yet.</p>
                    )}
                  </div>

                  <div className="border border-border bg-card p-6">
                    <h3 className="text-lg font-black text-foreground">Claim</h3>
                    {selectedSubmission.claim ? (
                      <div className="mt-4 space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Status</span>
                          <span className="font-mono text-foreground">{selectedSubmission.claim.status}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Token</span>
                          <span className="font-mono text-foreground">{shorten(selectedSubmission.claim.tokenAddress, 10, 8)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Serial</span>
                          <span className="font-mono text-foreground">{selectedSubmission.claim.serialNumber ?? "—"}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">Redeemed tx: {shorten(selectedSubmission.claim.redeemedTxHash, 10, 8)}</div>
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-muted-foreground">No claim token exists for this submission.</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="border border-border bg-card p-6 text-sm text-muted-foreground">
                Select a submission to inspect its evaluation and award state.
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="border border-border bg-card p-6 text-sm text-destructive">
          {detail.error instanceof Error ? detail.error.message : "Could not load submissions"}
        </div>
      )}
    </div>
  );
}
