import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Play, RefreshCw } from "lucide-react";
import { getSubmission, getHackathon, listHackathons, listSubmissions, queueEvaluation, redeemClaim } from "@/hackathon/api";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import type { EvaluationRun } from "@/hackathon/types";
import { toast } from "sonner";

function runTitle(role: EvaluationRun["agentRole"]): string {
  switch (role) {
    case "eligibility":
      return "Eligibility";
    case "track-fit":
      return "Track fit";
    case "quality":
      return "Quality";
    case "treasury":
      return "Treasury";
    case "policy-explainer":
      return "Policy explainer";
  }
}

export default function Submissions() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const hackathonId = searchParams.get("h") ?? "";
  const submissionId = searchParams.get("id") ?? "";

  const hackathonsQuery = useQuery({
    queryKey: ["hackathons"],
    queryFn: listHackathons,
  });

  const resolvedHackathonId = useMemo(() => hackathonId || hackathonsQuery.data?.[0]?.id || "", [hackathonId, hackathonsQuery.data]);
  const hackathonQuery = useQuery({
    queryKey: ["hackathon", resolvedHackathonId],
    queryFn: () => getHackathon(resolvedHackathonId),
    enabled: Boolean(resolvedHackathonId),
  });
  const submissionsQuery = useQuery({
    queryKey: ["submissions", resolvedHackathonId],
    queryFn: () => listSubmissions(resolvedHackathonId),
    enabled: Boolean(resolvedHackathonId),
    refetchInterval: 5000,
  });
  const detailQuery = useQuery({
    queryKey: ["submission", submissionId],
    queryFn: () => getSubmission(submissionId),
    enabled: Boolean(submissionId),
    refetchInterval: 5000,
  });

  const evaluateMutation = useMutation({
    mutationFn: (id: string) => queueEvaluation(id, true),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["submissions", resolvedHackathonId] });
      if (submissionId) {
        await queryClient.invalidateQueries({ queryKey: ["submission", submissionId] });
      }
      toast.success("Evaluation job queued.");
    },
  });

  const redeemMutation = useMutation({
    mutationFn: (claimId: string) => redeemClaim(claimId),
    onSuccess: async () => {
      if (submissionId) {
        await queryClient.invalidateQueries({ queryKey: ["submission", submissionId] });
      }
      toast.success("Claim redemption queued.");
    },
  });

  const hackathon = hackathonQuery.data;
  const submissions = submissionsQuery.data ?? [];
  const detail = detailQuery.data;
  const isOperator =
    Boolean(auth.user && hackathon) &&
    (auth.user?.accountId === hackathon?.organizerAccountId || auth.user?.accountId === hackathon?.judgeAccountId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-accent">Evaluation Console</p>
          <h1 className="mt-2 text-3xl font-black text-foreground">{hackathon?.name ?? "Submissions"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Live repo checks, worker evaluations, award state, and claim redemption.</p>
        </div>
        {isOperator && detail ? (
          <Button onClick={() => evaluateMutation.mutate(detail.id)} disabled={evaluateMutation.isPending}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Re-run evaluation
          </Button>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        <aside className="space-y-3">
          {submissions.map((submission) => (
            <Link
              key={submission.id}
              to={`/hackathon/submissions?h=${encodeURIComponent(submission.hackathonId)}&id=${encodeURIComponent(submission.id)}`}
              className="block rounded-xl border border-border bg-card p-4"
            >
              <p className="text-sm font-bold text-foreground">{submission.projectName}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{submission.teamName}</p>
              <p className="mt-3 text-[11px] text-muted-foreground">Status: {submission.status}</p>
              {submission.awardProposal ? (
                <p className="mt-1 text-[11px] text-primary">Award {submission.awardProposal.status}</p>
              ) : null}
            </Link>
          ))}
        </aside>

        <section className="space-y-4">
          {detail ? (
            <>
              <article className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">{detail.projectName}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{detail.description}</p>
                  </div>
                  <span className="rounded-full bg-secondary px-3 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-secondary-foreground">
                    {detail.status}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-3 text-sm">
                  <a href={detail.githubUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    Repo <ExternalLink className="h-3 w-3" />
                  </a>
                  <a href={detail.demoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    Demo <Play className="h-3 w-3" />
                  </a>
                </div>
              </article>

              <article className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-lg font-bold text-foreground">Agent runs</h3>
                <div className="mt-4 space-y-3">
                  {detail.evaluationRuns.map((run) => (
                    <div key={run.id} className="rounded-lg border border-border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-foreground">{runTitle(run.agentRole)}</p>
                        <span className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">{run.status}</span>
                      </div>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                        {JSON.stringify(run.result, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </article>

              {detail.awardProposal ? (
                <article className="rounded-xl border border-border bg-card p-5">
                  <h3 className="text-lg font-bold text-foreground">Award proposal</h3>
                  <pre className="mt-4 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                    {JSON.stringify(detail.awardProposal, null, 2)}
                  </pre>
                  {detail.claim ? (
                    <div className="mt-4 rounded-lg border border-border p-4">
                      <p className="text-sm font-medium text-foreground">Prize claim</p>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                        {JSON.stringify(detail.claim, null, 2)}
                      </pre>
                      {detail.claim.status === "minted" ? (
                        <Button className="mt-3" onClick={() => redeemMutation.mutate(detail.claim!.id)} disabled={redeemMutation.isPending}>
                          Redeem claim
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ) : null}

              {detail.approvalRequest ? (
                <article className="rounded-xl border border-border bg-card p-5">
                  <h3 className="text-lg font-bold text-foreground">Approval request</h3>
                  <pre className="mt-4 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                    {JSON.stringify(detail.approvalRequest, null, 2)}
                  </pre>
                  <Link to={`/hackathon/agents?h=${encodeURIComponent(detail.hackathonId)}`}>
                    <Button className="mt-3">Open approval queue</Button>
                  </Link>
                </article>
              ) : null}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-10 text-sm text-muted-foreground">
              Select a submission to inspect live evaluation state.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
