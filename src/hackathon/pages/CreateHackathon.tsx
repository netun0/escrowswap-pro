import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { CreateHackathonRequest, Track } from "@shared/treasury";
import { createHackathon } from "@/hackathon/api";
import { formatDateInput, localInputToIso } from "@/hackathon/format";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type TrackDraft = Track & {
  requirementsText: string;
};

function defaultDate(offsetDays: number): string {
  const value = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return formatDateInput(value.toISOString());
}

function makeTrack(index: number): TrackDraft {
  return {
    id: `track-${index + 1}`,
    name: "",
    description: "",
    sponsorName: "",
    prizeAmount: "1000",
    requirements: ["Public GitHub repository", "Working demo"],
    requirementsText: "Public GitHub repository\nWorking demo",
    evaluationPolicy: {
      minQualityScore: 75,
      requiresPublicRepo: true,
      requiresReadme: true,
      requiresDemo: true,
      requiresHashscanVerification: false,
      requiresContracts: false,
    },
  };
}

export default function CreateHackathon() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { authenticated, openAuthDialog, user } = useAuth();

  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [judgeAccountId, setJudgeAccountId] = useState(user?.accountId ?? "");
  const [judgeEvmAddress, setJudgeEvmAddress] = useState(user?.evmAddress ?? "");
  const [payoutTokenId, setPayoutTokenId] = useState("");
  const [payoutTokenEvmAddress, setPayoutTokenEvmAddress] = useState("");
  const [autonomousThreshold, setAutonomousThreshold] = useState("1000");
  const [approvalExpirySeconds, setApprovalExpirySeconds] = useState("604800");
  const [startsAt, setStartsAt] = useState(defaultDate(1));
  const [submissionDeadline, setSubmissionDeadline] = useState(defaultDate(7));
  const [endsAt, setEndsAt] = useState(defaultDate(10));
  const [judgingEndsAt, setJudgingEndsAt] = useState(defaultDate(12));
  const [tracks, setTracks] = useState<TrackDraft[]>([makeTrack(0)]);

  const totalBudget = useMemo(
    () => tracks.reduce((sum, track) => sum + (Number(track.prizeAmount) || 0), 0),
    [tracks],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!authenticated || !user) {
        throw new Error("Sign in as the organizer before creating a hackathon.");
      }

      const payload: CreateHackathonRequest = {
        name,
        tagline,
        organizerAccountId: user.accountId,
        organizerEvmAddress: user.evmAddress,
        judgeAccountId,
        judgeEvmAddress,
        payoutTokenId,
        payoutTokenEvmAddress,
        autonomousThreshold,
        approvalExpirySeconds: Number(approvalExpirySeconds),
        startsAt: localInputToIso(startsAt),
        endsAt: localInputToIso(endsAt),
        submissionDeadline: localInputToIso(submissionDeadline),
        judgingEndsAt: localInputToIso(judgingEndsAt),
        tracks: tracks.map((track) => ({
          ...track,
          requirements: track.requirementsText
            .split("\n")
            .map((entry) => entry.trim())
            .filter(Boolean),
        })),
      };

      return createHackathon(payload);
    },
    onSuccess: async (hackathon) => {
      toast.success("Hackathon created. Next step: fund the treasury on Hedera.");
      await queryClient.invalidateQueries({ queryKey: ["hackathons"] });
      navigate(`/hackathon/live?id=${encodeURIComponent(hackathon.id)}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not create hackathon");
    },
  });

  function updateTrack(index: number, updater: (track: TrackDraft) => TrackDraft) {
    setTracks((current) => current.map((track, trackIndex) => (trackIndex === index ? updater(track) : track)));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-accent">
          <ShieldCheck className="h-4 w-4" />
          <span className="text-[10px] font-mono uppercase tracking-[0.3em]">Organizer Setup</span>
        </div>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-foreground">Create a hackathon treasury</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          This writes the live event definition to Postgres and seeds the worker pipeline. The actual funds move only after you approve token spend and bootstrap the treasury on the detail page.
        </p>
      </div>

      {!authenticated || !user ? (
        <div className="border border-border bg-card p-6 text-sm text-muted-foreground">
          Sign in with the organizer MetaMask account first.
          <div className="mt-3">
            <Button onClick={openAuthDialog}>Sign in</Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.05fr,0.95fr]">
        <section className="space-y-6">
          <div className="border border-border bg-card p-6">
            <h2 className="text-lg font-black text-foreground">Identity and treasury</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Organizer account</Label>
                <Input value={user?.accountId ?? ""} disabled className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label>Organizer EVM</Label>
                <Input value={user?.evmAddress ?? ""} disabled className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label>Judge account</Label>
                <Input value={judgeAccountId} onChange={(event) => setJudgeAccountId(event.target.value)} className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label>Judge EVM</Label>
                <Input value={judgeEvmAddress} onChange={(event) => setJudgeEvmAddress(event.target.value)} className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label>Payout token id</Label>
                <Input
                  value={payoutTokenId}
                  onChange={(event) => setPayoutTokenId(event.target.value)}
                  placeholder="0.0.x"
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>Payout token EVM address</Label>
                <Input
                  value={payoutTokenEvmAddress}
                  onChange={(event) => setPayoutTokenEvmAddress(event.target.value)}
                  placeholder="0x..."
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>Autonomous payout threshold</Label>
                <Input
                  value={autonomousThreshold}
                  onChange={(event) => setAutonomousThreshold(event.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>Approval expiry seconds</Label>
                <Input
                  value={approvalExpirySeconds}
                  onChange={(event) => setApprovalExpirySeconds(event.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
            <div className="mt-4">
              <Button
                variant="outline"
                onClick={() => {
                  if (!user) return;
                  setJudgeAccountId(user.accountId);
                  setJudgeEvmAddress(user.evmAddress);
                }}
              >
                Use my wallet as judge
              </Button>
            </div>
          </div>

          <div className="border border-border bg-card p-6">
            <h2 className="text-lg font-black text-foreground">Schedule and messaging</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Name</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="ETHGlobal Cannes Treasury Tracks" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Tagline</Label>
                <Textarea
                  value={tagline}
                  onChange={(event) => setTagline(event.target.value)}
                  placeholder="Live treasury operations for Hedera, Ledger, and Naryo submissions."
                />
              </div>
              <div className="space-y-2">
                <Label>Starts at</Label>
                <Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Submission deadline</Label>
                <Input type="datetime-local" value={submissionDeadline} onChange={(event) => setSubmissionDeadline(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Hackathon ends</Label>
                <Input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Judging ends</Label>
                <Input type="datetime-local" value={judgingEndsAt} onChange={(event) => setJudgingEndsAt(event.target.value)} />
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-foreground">Tracks</h2>
                <p className="text-sm text-muted-foreground">Each track maps directly to a funded treasury budget and an evaluation policy.</p>
              </div>
              <Button
                variant="outline"
                onClick={() => setTracks((current) => [...current, makeTrack(current.length)])}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add track
              </Button>
            </div>

            <div className="mt-5 space-y-4">
              {tracks.map((track, index) => (
                <div key={track.id} className="border border-border bg-background/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-foreground">Track {index + 1}</h3>
                    {tracks.length > 1 ? (
                      <Button variant="ghost" size="sm" onClick={() => setTracks((current) => current.filter((_, i) => i !== index))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <Label>Track id</Label>
                      <Input
                        value={track.id}
                        onChange={(event) => updateTrack(index, (current) => ({ ...current, id: event.target.value }))}
                        className="font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        value={track.name}
                        onChange={(event) => updateTrack(index, (current) => ({ ...current, name: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Sponsor name</Label>
                      <Input
                        value={track.sponsorName}
                        onChange={(event) => updateTrack(index, (current) => ({ ...current, sponsorName: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Textarea
                        value={track.description}
                        onChange={(event) => updateTrack(index, (current) => ({ ...current, description: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Prize amount</Label>
                      <Input
                        value={track.prizeAmount}
                        onChange={(event) => updateTrack(index, (current) => ({ ...current, prizeAmount: event.target.value }))}
                        className="font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Requirements (one per line)</Label>
                      <Textarea
                        value={track.requirementsText}
                        onChange={(event) => updateTrack(index, (current) => ({ ...current, requirementsText: event.target.value }))}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Min quality score</Label>
                        <Input
                          value={String(track.evaluationPolicy.minQualityScore)}
                          onChange={(event) =>
                            updateTrack(index, (current) => ({
                              ...current,
                              evaluationPolicy: {
                                ...current.evaluationPolicy,
                                minQualityScore: Number(event.target.value || 0),
                              },
                            }))
                          }
                          className="font-mono"
                        />
                      </div>
                      {[
                        ["requiresPublicRepo", "Require public repo"],
                        ["requiresReadme", "Require README"],
                        ["requiresDemo", "Require demo"],
                        ["requiresContracts", "Require deployed contracts"],
                        ["requiresHashscanVerification", "Require HashScan verification"],
                      ].map(([field, label]) => (
                        <label key={field} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={Boolean(track.evaluationPolicy[field as keyof typeof track.evaluationPolicy])}
                            onChange={(event) =>
                              updateTrack(index, (current) => ({
                                ...current,
                                evaluationPolicy: {
                                  ...current.evaluationPolicy,
                                  [field]: event.target.checked,
                                },
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-border bg-card p-6">
            <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Summary</p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tracks</span>
                <span className="font-mono text-foreground">{tracks.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total prize budget</span>
                <span className="font-mono text-foreground">{totalBudget.toLocaleString()} USDC</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Judge signer</span>
                <span className="font-mono text-foreground">{judgeAccountId || "unset"}</span>
              </div>
            </div>
            <Button className="mt-5 w-full" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !authenticated}>
              {createMutation.isPending ? "Creating..." : "Create hackathon"}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
