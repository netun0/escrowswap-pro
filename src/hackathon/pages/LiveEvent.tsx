import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2, Receipt, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  confirmHackathonFunding,
  fetchEvents,
  fetchHackathon,
  fetchHackathons,
  TREASURY_BROWSER_CONTRACT_ADDRESS,
} from "@/hackathon/api";
import { bootstrapHackathonTreasury, approveTreasuryFunding, readTreasuryAllowance } from "@/hackathon/evm";
import { formatDateTime, formatTokenAmount, relativeTime, shorten } from "@/hackathon/format";
import { useAuth } from "@/auth/useAuth";

export default function LiveEvent() {
  const [params, setParams] = useSearchParams();
  const [manualTxHash, setManualTxHash] = useState("");
  const queryClient = useQueryClient();
  const { authenticated, openAuthDialog, user } = useAuth();

  const hackathons = useQuery({
    queryKey: ["hackathons"],
    queryFn: fetchHackathons,
  });

  const selectedHackathonId = useMemo(() => {
    const fromQuery = params.get("id");
    if (fromQuery) return fromQuery;
    return hackathons.data?.[0]?.id ?? "";
  }, [hackathons.data, params]);

  useEffect(() => {
    if (!params.get("id") && hackathons.data?.[0]?.id) {
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set("id", hackathons.data[0].id);
        return next;
      });
    }
  }, [hackathons.data, params, setParams]);

  const detail = useQuery({
    queryKey: ["hackathon", selectedHackathonId],
    queryFn: () => fetchHackathon(selectedHackathonId),
    enabled: Boolean(selectedHackathonId),
  });

  const events = useQuery({
    queryKey: ["events", selectedHackathonId],
    queryFn: () => fetchEvents({ hackathonId: selectedHackathonId }),
    enabled: Boolean(selectedHackathonId),
  });

  const canFund =
    authenticated &&
    user &&
    detail.data &&
    user.accountId === detail.data.organizerAccountId &&
    user.evmAddress === detail.data.organizerEvmAddress;

  const totalBudget = useMemo(
    () => detail.data?.tracks.reduce((sum, track) => sum + BigInt(track.prizeAmount), 0n) ?? 0n,
    [detail.data],
  );

  const allowance = useQuery({
    queryKey: ["treasury-allowance", detail.data?.id, user?.evmAddress],
    queryFn: () => readTreasuryAllowance(detail.data!.payoutTokenEvmAddress),
    enabled: Boolean(canFund && detail.data && !detail.data.treasuryTxHash && TREASURY_BROWSER_CONTRACT_ADDRESS),
    retry: false,
  });

  const approveFunding = useMutation({
    mutationFn: async () => {
      if (!detail.data) throw new Error("Hackathon not loaded");
      return approveTreasuryFunding(detail.data.payoutTokenEvmAddress, totalBudget.toString());
    },
    onSuccess: (txHash) => {
      toast.success(`Payout token approval submitted: ${shorten(txHash, 10, 8)}`);
      void queryClient.invalidateQueries({ queryKey: ["treasury-allowance", detail.data?.id, user?.evmAddress] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Approval failed");
    },
  });

  const bootstrap = useMutation({
    mutationFn: async () => {
      if (!detail.data) throw new Error("Hackathon not loaded");
      const txHash = await bootstrapHackathonTreasury(detail.data);
      await confirmHackathonFunding(detail.data.id, txHash);
      return txHash;
    },
    onSuccess: async (txHash) => {
      toast.success(`Treasury funded with tx ${shorten(txHash, 10, 8)}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["hackathons"] }),
        queryClient.invalidateQueries({ queryKey: ["hackathon", detail.data?.id] }),
        queryClient.invalidateQueries({ queryKey: ["events", detail.data?.id] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Funding failed");
    },
  });

  const confirmExternal = useMutation({
    mutationFn: async () => {
      if (!detail.data) throw new Error("Hackathon not loaded");
      if (!manualTxHash.trim()) throw new Error("Paste a Hedera EVM transaction hash first.");
      return confirmHackathonFunding(detail.data.id, manualTxHash.trim());
    },
    onSuccess: async () => {
      toast.success("Funding confirmed from on-chain events.");
      setManualTxHash("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["hackathons"] }),
        queryClient.invalidateQueries({ queryKey: ["hackathon", detail.data?.id] }),
        queryClient.invalidateQueries({ queryKey: ["events", detail.data?.id] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Funding confirmation failed");
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

        <div className="flex items-center gap-2">
          <select
            value={selectedHackathonId}
            onChange={(event) => setParams({ id: event.target.value })}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {(hackathons.data ?? []).map((hackathon) => (
              <option key={hackathon.id} value={hackathon.id}>
                {hackathon.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {detail.isLoading ? (
        <div className="flex items-center gap-2 border border-border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading hackathon detail
        </div>
      ) : detail.data ? (
        <>
          <section className="grid gap-4 lg:grid-cols-[1.3fr,0.7fr]">
            <div className="border border-border bg-card p-6">
              <div className="flex items-center gap-2 text-accent">
                <ShieldCheck className="h-4 w-4" />
                <span className="text-[10px] font-mono uppercase tracking-[0.3em]">Hackathon Treasury</span>
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-foreground">{detail.data.name}</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail.data.tagline}</p>

              <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">Organizer</div>
                  <div className="font-mono text-foreground">{detail.data.organizerAccountId}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Judge</div>
                  <div className="font-mono text-foreground">{detail.data.judgeAccountId}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Starts</div>
                  <div className="font-mono text-foreground">{formatDateTime(detail.data.startsAt)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Judging ends</div>
                  <div className="font-mono text-foreground">{formatDateTime(detail.data.judgingEndsAt)}</div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="outline" asChild>
                  <Link to={`/hackathon/submissions?h=${encodeURIComponent(detail.data.id)}`}>Open submissions</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to={`/hackathon/agents?h=${encodeURIComponent(detail.data.id)}`}>Open operations</Link>
                </Button>
                <Button variant="ghost" asChild>
                  <Link to={`/hackathon/submit?h=${encodeURIComponent(detail.data.id)}`}>Submit project</Link>
                </Button>
              </div>
            </div>

            <div className="border border-border bg-card p-6">
              <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Status</p>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Lifecycle</span>
                  <span className="font-mono text-foreground">{detail.data.status}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Treasury tx</span>
                  <span className="font-mono text-foreground">{shorten(detail.data.treasuryTxHash, 10, 8)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Payout token</span>
                  <span className="font-mono text-foreground">{detail.data.payoutTokenId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Autonomous threshold</span>
                  <span className="font-mono text-foreground">{formatTokenAmount(detail.data.autonomousThreshold)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Claims minted</span>
                  <span className="font-mono text-foreground">{detail.data.claims.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Submissions</span>
                  <span className="font-mono text-foreground">{detail.data.submissions.length}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.05fr,0.95fr]">
            <div className="border border-border bg-card p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Tracks</p>
                  <h2 className="mt-1 text-xl font-black text-foreground">Prize budgets and policies</h2>
                </div>
                <div className="font-mono text-sm text-foreground">{formatTokenAmount(totalBudget)}</div>
              </div>

              <div className="mt-5 space-y-4">
                {detail.data.tracks.map((track) => (
                  <div key={track.id} className="border border-border bg-background/40 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-foreground">{track.name}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">{track.description}</p>
                        <p className="mt-2 text-[11px] font-mono text-muted-foreground">{track.sponsorName}</p>
                      </div>
                      <div className="font-mono text-sm text-foreground">{formatTokenAmount(track.prizeAmount)}</div>
                    </div>

                    <div className="mt-4 grid gap-4 text-[11px] md:grid-cols-2">
                      <div>
                        <div className="font-mono uppercase tracking-widest text-muted-foreground">Requirements</div>
                        <ul className="mt-2 space-y-1 text-muted-foreground">
                          {track.requirements.map((requirement) => (
                            <li key={requirement}>• {requirement}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="font-mono uppercase tracking-widest text-muted-foreground">Policy</div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <div>Min quality: <span className="font-mono text-foreground">{track.evaluationPolicy.minQualityScore}</span></div>
                          <div>Public repo: <span className="font-mono text-foreground">{track.evaluationPolicy.requiresPublicRepo ? "yes" : "no"}</span></div>
                          <div>README: <span className="font-mono text-foreground">{track.evaluationPolicy.requiresReadme ? "yes" : "no"}</span></div>
                          <div>Demo: <span className="font-mono text-foreground">{track.evaluationPolicy.requiresDemo ? "yes" : "no"}</span></div>
                          <div>Contracts: <span className="font-mono text-foreground">{track.evaluationPolicy.requiresContracts ? "yes" : "no"}</span></div>
                          <div>Hashscan: <span className="font-mono text-foreground">{track.evaluationPolicy.requiresHashscanVerification ? "yes" : "no"}</span></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="border border-border bg-card p-6">
                <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Funding</p>
                <h2 className="mt-1 text-xl font-black text-foreground">Organizer treasury actions</h2>

                {detail.data.treasuryTxHash ? (
                  <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2 text-primary">
                      <Receipt className="h-4 w-4" />
                      Treasury funding confirmed
                    </div>
                    <p className="mt-2 font-mono text-foreground">{detail.data.treasuryTxHash}</p>
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    {!canFund ? (
                      <div className="rounded-md border border-border bg-background/40 p-4 text-sm text-muted-foreground">
                        Sign in as the organizer account <span className="font-mono text-foreground">{detail.data.organizerAccountId}</span> to approve spend and bootstrap the treasury.
                        <div className="mt-3">
                          <Button onClick={openAuthDialog}>
                            <Wallet className="mr-2 h-4 w-4" />
                            Sign in
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="rounded-md border border-border bg-background/40 p-4 text-sm">
                          <p className="font-medium text-foreground">1. Approve payout token spend</p>
                          <p className="mt-1 text-muted-foreground">
                            Total budget required: <span className="font-mono text-foreground">{formatTokenAmount(totalBudget)}</span>
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            Current allowance:{" "}
                            <span className="font-mono text-foreground">
                              {allowance.isLoading ? "loading" : allowance.data !== undefined ? formatTokenAmount(allowance.data) : "unavailable"}
                            </span>
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button onClick={() => approveFunding.mutate()} disabled={approveFunding.isPending}>
                              {approveFunding.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              Approve token spend
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-md border border-border bg-background/40 p-4 text-sm">
                          <p className="font-medium text-foreground">2. Bootstrap the on-chain treasury</p>
                          <p className="mt-1 text-muted-foreground">
                            This calls <code className="font-mono">bootstrapHackathon</code> on the treasury contract and then confirms the emitted events against the API.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button onClick={() => bootstrap.mutate()} disabled={bootstrap.isPending || !TREASURY_BROWSER_CONTRACT_ADDRESS}>
                              {bootstrap.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              Bootstrap treasury
                            </Button>
                          </div>
                        </div>
                      </>
                    )}

                    <div className="rounded-md border border-border bg-background/40 p-4 text-sm">
                      <p className="font-medium text-foreground">External bootstrap fallback</p>
                      <p className="mt-1 text-muted-foreground">
                        If you funded the treasury from another signer or script, paste the transaction hash here and JudgeBuddy will confirm the emitted Hedera EVM events.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Input
                          value={manualTxHash}
                          onChange={(event) => setManualTxHash(event.target.value)}
                          placeholder="0x..."
                          className="font-mono"
                        />
                        <Button variant="outline" onClick={() => confirmExternal.mutate()} disabled={confirmExternal.isPending}>
                          {confirmExternal.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Confirm
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="border border-border bg-card p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Timeline</p>
                    <h2 className="mt-1 text-xl font-black text-foreground">Recent events</h2>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/hackathon/agents?h=${encodeURIComponent(detail.data.id)}`}>Full operations</Link>
                  </Button>
                </div>

                <div className="mt-5 space-y-3">
                  {(events.data ?? []).slice(0, 8).map((event) => (
                    <div key={event.id} className="border border-border bg-background/40 p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-foreground">{event.type}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {event.source} · {relativeTime(event.createdAt)}
                          </div>
                        </div>
                        {event.txHash ? (
                          <a
                            href={`https://hashscan.io/testnet/transaction/${event.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-accent"
                          >
                            HashScan
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {!events.data?.length ? (
                    <p className="text-sm text-muted-foreground">No events recorded for this hackathon yet.</p>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <div className="border border-border bg-card p-6 text-sm text-destructive">
          {detail.error instanceof Error ? detail.error.message : "Hackathon not found"}
        </div>
      )}
    </div>
  );
}
