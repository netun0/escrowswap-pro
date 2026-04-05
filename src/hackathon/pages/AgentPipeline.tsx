import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { approveAward, fetchEvents, fetchHackathon, fetchHackathons, fetchJobs, redeemClaim } from "@/hackathon/api";
import { signAwardApproval } from "@/hackathon/evm";
import { formatDateTime, formatTokenAmount, relativeTime, shorten } from "@/hackathon/format";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { hashscanEvmTxUrl, hashscanTransactionMessageUrl } from "@/contracts/config";

export default function AgentPipeline() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { authenticated, openAuthDialog, user } = useAuth();

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

  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    refetchInterval: 5000,
  });

  const events = useQuery({
    queryKey: ["events", selectedHackathonId],
    queryFn: () => fetchEvents({ hackathonId: selectedHackathonId }),
    enabled: Boolean(selectedHackathonId),
    refetchInterval: 5000,
  });

  const awardsById = useMemo(() => {
    const entries = detail.data?.submissions
      .map((submission) => submission.awardProposal)
      .filter(Boolean)
      .map((award) => [award!.id, award!] as const);
    return new Map(entries ?? []);
  }, [detail.data?.submissions]);

  const approveMutation = useMutation({
    mutationFn: async (awardId: string) => {
      if (!detail.data) throw new Error("Hackathon not loaded");
      const approvalRequest = detail.data.approvals.find((entry) => entry.awardId === awardId);
      const award = awardsById.get(awardId);
      if (!approvalRequest || !award) throw new Error("Approval request or award missing");
      const payload = await signAwardApproval(detail.data, award, approvalRequest);
      return approveAward(awardId, payload);
    },
    onSuccess: async () => {
      toast.success("Award approved and relayed.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["hackathon", selectedHackathonId] }),
        queryClient.invalidateQueries({ queryKey: ["events", selectedHackathonId] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Approval failed");
    },
  });

  const redeemMutation = useMutation({
    mutationFn: async (claimId: string) => redeemClaim(claimId),
    onSuccess: async () => {
      toast.success("Claim redeemed.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["hackathon", selectedHackathonId] }),
        queryClient.invalidateQueries({ queryKey: ["events", selectedHackathonId] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Claim redemption failed");
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

      {!authenticated ? (
        <div className="border border-border bg-card p-6 text-sm text-muted-foreground">
          Sign in with the organizer or judge wallet to run live approval and redemption actions.
          <div className="mt-3">
            <Button onClick={openAuthDialog}>Sign in</Button>
          </div>
        </div>
      ) : null}

      {detail.isLoading ? (
        <div className="flex items-center gap-2 border border-border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading operations
        </div>
      ) : detail.data ? (
        <>
          <section className="border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-accent">
              <ShieldCheck className="h-4 w-4" />
              <span className="text-[10px] font-mono uppercase tracking-[0.3em]">Operations</span>
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-foreground">{detail.data.name}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Approvals are real EIP-712 signatures. If the connected MetaMask account is Ledger-backed, this same flow becomes the Ledger trust layer required by the track.
            </p>
          </section>

          <section className="grid gap-6 lg:grid-cols-[1.05fr,0.95fr]">
            <div className="space-y-6">
              <div className="border border-border bg-card p-6">
                <h2 className="text-lg font-black text-foreground">Approval queue</h2>
                <div className="mt-4 space-y-4">
                  {detail.data.approvals.map((approval) => {
                    const award = awardsById.get(approval.awardId);
                    const canApprove =
                      authenticated &&
                      user &&
                      user.accountId === approval.signerAccountId &&
                      user.evmAddress === approval.signerEvmAddress &&
                      approval.status === "pending";
                    return (
                      <div key={approval.id} className="border border-border bg-background/40 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="font-mono text-sm text-foreground">{approval.actionType}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              signer {approval.signerAccountId} · expires {formatDateTime(approval.expiresAt)}
                            </div>
                          </div>
                          <div className="font-mono text-sm text-foreground">{approval.status}</div>
                        </div>

                        {award ? (
                          <div className="mt-4 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                            <div>
                              Award
                              <div className="font-mono text-foreground">{award.id}</div>
                            </div>
                            <div>
                              Amount
                              <div className="font-mono text-foreground">{formatTokenAmount(award.amount)}</div>
                            </div>
                            <div>
                              Recipient
                              <div className="font-mono text-foreground">{shorten(award.winnerEvmAddress, 10, 8)}</div>
                            </div>
                            <div>
                              Settlement
                              <div className="font-mono text-foreground">{award.settlementMode}</div>
                            </div>
                          </div>
                        ) : null}

                        <pre className="mt-4 overflow-auto rounded-md bg-card p-3 text-[11px] text-muted-foreground">
                          {JSON.stringify(approval.clearSigningManifest, null, 2)}
                        </pre>

                        {canApprove ? (
                          <div className="mt-4">
                            <Button onClick={() => approveMutation.mutate(approval.awardId)} disabled={approveMutation.isPending}>
                              {approveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              Sign and approve
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!detail.data.approvals.length ? (
                    <p className="text-sm text-muted-foreground">No approval requests are pending for this hackathon.</p>
                  ) : null}
                </div>
              </div>

              <div className="border border-border bg-card p-6">
                <h2 className="text-lg font-black text-foreground">Claims</h2>
                <div className="mt-4 space-y-4">
                  {detail.data.claims.map((claim) => {
                    const canRedeem =
                      authenticated &&
                      user &&
                      user.accountId === claim.claimantAccountId &&
                      user.evmAddress === claim.claimantEvmAddress &&
                      claim.status === "minted";
                    return (
                      <div key={claim.id} className="border border-border bg-background/40 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="font-mono text-sm text-foreground">{claim.id}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              claimant {claim.claimantAccountId} · serial {claim.serialNumber ?? "—"}
                            </div>
                          </div>
                          <div className="font-mono text-sm text-foreground">{claim.status}</div>
                        </div>
                        <div className="mt-4 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                          <div>
                            Token
                            <div className="font-mono text-foreground">{shorten(claim.tokenAddress, 10, 8)}</div>
                          </div>
                          <div>
                            Metadata
                            <div className="font-mono text-foreground">{claim.metadataURI ?? "—"}</div>
                          </div>
                        </div>
                        {canRedeem ? (
                          <div className="mt-4">
                            <Button variant="outline" onClick={() => redeemMutation.mutate(claim.id)} disabled={redeemMutation.isPending}>
                              {redeemMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              Redeem claim
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!detail.data.claims.length ? (
                    <p className="text-sm text-muted-foreground">No claim tokens minted yet.</p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="border border-border bg-card p-6">
                <h2 className="text-lg font-black text-foreground">Jobs</h2>
                <div className="mt-4 space-y-3">
                  {(jobs.data ?? [])
                    .filter((job) => !selectedHackathonId || job.payload.submissionId || job.payload.hackathonId)
                    .slice(0, 12)
                    .map((job) => (
                      <div key={job.id} className="border border-border bg-background/40 p-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-mono text-foreground">{job.type}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">{relativeTime(job.createdAt)}</div>
                          </div>
                          <div className="font-mono text-foreground">{job.status}</div>
                        </div>
                        {job.lastError ? <p className="mt-2 text-[11px] text-destructive">{job.lastError}</p> : null}
                      </div>
                    ))}
                </div>
              </div>

              <div className="border border-border bg-card p-6">
                <h2 className="text-lg font-black text-foreground">Event stream</h2>
                <div className="mt-4 space-y-3">
                  {(events.data ?? []).slice(0, 16).map((event) => {
                    const txHref = event.txHash ? hashscanEvmTxUrl(event.txHash) : null;
                    const hcsHref = event.hcsTxId ? hashscanTransactionMessageUrl(event.hcsTxId) : null;
                    const primaryHref = hcsHref ?? txHref;

                    const content = (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-mono text-foreground">{event.type}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {event.source} · {relativeTime(event.createdAt)}
                            </div>
                          </div>
                          {primaryHref ? (
                            <div className="flex flex-col items-end gap-1 text-[11px] text-accent">
                              <span className="inline-flex items-center gap-1">
                                {hcsHref ? "HCS message" : "Tx"}
                                <ExternalLink className="h-3 w-3" />
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-2 text-[11px] text-muted-foreground">{formatDateTime(event.createdAt)}</div>
                        {event.hcsTopicId && event.hcsSequenceNumber ? (
                          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                            topic {event.hcsTopicId} · seq {event.hcsSequenceNumber}
                          </div>
                        ) : null}
                      </>
                    );

                    return primaryHref ? (
                      <a
                        key={event.id}
                        href={primaryHref}
                        target="_blank"
                        rel="noreferrer"
                        className="block border border-border bg-background/40 p-3 text-sm transition-colors hover:border-accent/60 hover:bg-background/70"
                      >
                        {content}
                      </a>
                    ) : (
                      <div key={event.id} className="border border-border bg-background/40 p-3 text-sm">
                        {content}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <div className="border border-border bg-card p-6 text-sm text-destructive">
          {detail.error instanceof Error ? detail.error.message : "Could not load operations"}
        </div>
      )}
    </div>
  );
}
