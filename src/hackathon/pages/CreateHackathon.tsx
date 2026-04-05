import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { createHackathon } from "@/hackathon/api";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type TrackDraft = {
  id: string;
  sponsorName: string;
  name: string;
  description: string;
  prizeAmount: string;
  requirements: string;
};

function makeTrack(): TrackDraft {
  return {
    id: `track_${crypto.randomUUID()}`,
    sponsorName: "",
    name: "",
    description: "",
    prizeAmount: "",
    requirements: "",
  };
}

function toIso(value: string): string {
  return new Date(value).toISOString();
}

export default function CreateHackathon() {
  const navigate = useNavigate();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [tracks, setTracks] = useState<TrackDraft[]>([makeTrack()]);
  const [form, setForm] = useState({
    name: "",
    tagline: "",
    judgeAccountId: "",
    judgeEvmAddress: "",
    payoutTokenId: "",
    payoutTokenEvmAddress: "",
    autonomousThreshold: "",
    approvalExpirySeconds: "604800",
    startsAt: "",
    endsAt: "",
    submissionDeadline: "",
    judgingEndsAt: "",
  });

  const mutation = useMutation({
    mutationFn: createHackathon,
    onSuccess: async (hackathon) => {
      await queryClient.invalidateQueries({ queryKey: ["hackathons"] });
      toast.success("Hackathon created. Fund the treasury next.");
      navigate(`/hackathon/live?id=${encodeURIComponent(hackathon.id)}`);
    },
  });

  const organizer = useMemo(
    () => ({
      accountId: auth.user?.accountId ?? "",
      evmAddress: auth.user?.evmAddress ?? "",
    }),
    [auth.user?.accountId, auth.user?.evmAddress],
  );

  function updateTrack(id: string, key: keyof TrackDraft, value: string) {
    setTracks((current) => current.map((track) => (track.id === id ? { ...track, [key]: value } : track)));
  }

  async function handleSubmit() {
    if (!auth.authenticated || !organizer.accountId || !organizer.evmAddress) {
      toast.error("Connect the organizer MetaMask wallet first.");
      return;
    }
    if (tracks.some((track) => !track.name || !track.prizeAmount || !track.sponsorName)) {
      toast.error("Each track needs a sponsor, name, and prize amount.");
      return;
    }

    mutation.mutate({
      name: form.name,
      tagline: form.tagline,
      organizerAccountId: organizer.accountId,
      organizerEvmAddress: organizer.evmAddress,
      judgeAccountId: form.judgeAccountId,
      judgeEvmAddress: form.judgeEvmAddress,
      payoutTokenId: form.payoutTokenId,
      payoutTokenEvmAddress: form.payoutTokenEvmAddress,
      autonomousThreshold: form.autonomousThreshold,
      approvalExpirySeconds: Number(form.approvalExpirySeconds),
      startsAt: toIso(form.startsAt),
      endsAt: toIso(form.endsAt),
      submissionDeadline: toIso(form.submissionDeadline),
      judgingEndsAt: toIso(form.judgingEndsAt),
      tracks: tracks.map((track) => ({
        id: track.id,
        sponsorName: track.sponsorName,
        name: track.name,
        description: track.description,
        prizeAmount: track.prizeAmount,
        requirements: track.requirements
          .split(/\n+/)
          .map((value) => value.trim())
          .filter(Boolean),
        evaluationPolicy: {
          minQualityScore: 70,
          requiresPublicRepo: true,
          requiresReadme: true,
          requiresDemo: true,
          requiresHashscanVerification: true,
          requiresContracts: true,
        },
      })),
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-accent">Organizer Flow</p>
        <h1 className="mt-2 text-3xl font-black text-foreground">Create a live treasury-backed hackathon</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This creates the draft record in Postgres. Funding happens from the organizer wallet on the next screen against the Hedera treasury contract.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Tagline</Label>
            <Input value={form.tagline} onChange={(event) => setForm((current) => ({ ...current, tagline: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Organizer account</Label>
            <Input value={organizer.accountId} readOnly />
          </div>
          <div className="space-y-2">
            <Label>Organizer EVM</Label>
            <Input value={organizer.evmAddress} readOnly />
          </div>
          <div className="space-y-2">
            <Label>Judge account</Label>
            <Input value={form.judgeAccountId} onChange={(event) => setForm((current) => ({ ...current, judgeAccountId: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Judge EVM address</Label>
            <Input value={form.judgeEvmAddress} onChange={(event) => setForm((current) => ({ ...current, judgeEvmAddress: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Payout token id</Label>
            <Input value={form.payoutTokenId} onChange={(event) => setForm((current) => ({ ...current, payoutTokenId: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Payout token EVM address</Label>
            <Input value={form.payoutTokenEvmAddress} onChange={(event) => setForm((current) => ({ ...current, payoutTokenEvmAddress: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Autonomous threshold</Label>
            <Input value={form.autonomousThreshold} onChange={(event) => setForm((current) => ({ ...current, autonomousThreshold: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Approval expiry seconds</Label>
            <Input value={form.approvalExpirySeconds} onChange={(event) => setForm((current) => ({ ...current, approvalExpirySeconds: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Starts at</Label>
            <Input type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Ends at</Label>
            <Input type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Submission deadline</Label>
            <Input
              type="datetime-local"
              value={form.submissionDeadline}
              onChange={(event) => setForm((current) => ({ ...current, submissionDeadline: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Judging ends</Label>
            <Input
              type="datetime-local"
              value={form.judgingEndsAt}
              onChange={(event) => setForm((current) => ({ ...current, judgingEndsAt: event.target.value }))}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Tracks</h2>
            <p className="text-sm text-muted-foreground">Each track becomes a treasury budget line and evaluation policy target.</p>
          </div>
          <Button variant="outline" onClick={() => setTracks((current) => [...current, makeTrack()])}>
            <Plus className="mr-2 h-4 w-4" />
            Add track
          </Button>
        </div>

        <div className="mt-4 space-y-4">
          {tracks.map((track) => (
            <div key={track.id} className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{track.id}</p>
                {tracks.length > 1 ? (
                  <Button variant="ghost" size="icon" onClick={() => setTracks((current) => current.filter((item) => item.id !== track.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Sponsor</Label>
                  <Input value={track.sponsorName} onChange={(event) => updateTrack(track.id, "sponsorName", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Track name</Label>
                  <Input value={track.name} onChange={(event) => updateTrack(track.id, "name", event.target.value)} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Description</Label>
                  <Textarea value={track.description} onChange={(event) => updateTrack(track.id, "description", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Prize amount</Label>
                  <Input value={track.prizeAmount} onChange={(event) => updateTrack(track.id, "prizeAmount", event.target.value)} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Requirements, one per line</Label>
                  <Textarea value={track.requirements} onChange={(event) => updateTrack(track.id, "requirements", event.target.value)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Button onClick={() => void handleSubmit()} disabled={mutation.isPending}>
        {mutation.isPending ? "Creating hackathon…" : "Create hackathon"}
      </Button>
    </div>
  );
}
