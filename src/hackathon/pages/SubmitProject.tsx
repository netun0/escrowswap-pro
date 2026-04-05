import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSubmission, listHackathons } from "@/hackathon/api";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function SubmitProject() {
  const navigate = useNavigate();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    hackathonId: "",
    trackId: "",
    projectName: "",
    teamName: "",
    teamMembers: "",
    githubUrl: "",
    demoUrl: "",
    description: "",
    deployedContracts: "",
  });

  const hackathonsQuery = useQuery({
    queryKey: ["hackathons"],
    queryFn: listHackathons,
  });

  const currentHackathon = useMemo(
    () => hackathonsQuery.data?.find((hackathon) => hackathon.id === form.hackathonId) ?? null,
    [form.hackathonId, hackathonsQuery.data],
  );

  const mutation = useMutation({
    mutationFn: createSubmission,
    onSuccess: async (submission) => {
      await queryClient.invalidateQueries({ queryKey: ["submissions", submission.hackathonId] });
      toast.success("Submission queued for registration and evaluation.");
      navigate(`/hackathon/submissions?h=${encodeURIComponent(submission.hackathonId)}&id=${encodeURIComponent(submission.id)}`);
    },
  });

  async function handleSubmit() {
    if (!auth.authenticated || !auth.user) {
      toast.error("Connect MetaMask before submitting.");
      return;
    }

    mutation.mutate({
      hackathonId: form.hackathonId,
      trackId: form.trackId,
      projectName: form.projectName,
      teamName: form.teamName,
      teamMembers: form.teamMembers
        .split(/[,\n]+/)
        .map((value) => value.trim())
        .filter(Boolean),
      githubUrl: form.githubUrl,
      demoUrl: form.demoUrl,
      description: form.description,
      payoutAccountId: auth.user.accountId,
      payoutEvmAddress: auth.user.evmAddress,
      deployedContracts: form.deployedContracts
        .split(/\n+/)
        .map((row) => row.trim())
        .filter(Boolean)
        .map((row, index) => {
          const [label, address, hashscanUrl] = row.split(",").map((value) => value.trim());
          return {
            label: label || `contract_${index + 1}`,
            address,
            hashscanUrl: hashscanUrl || undefined,
          };
        }),
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-accent">Live Intake</p>
        <h1 className="mt-2 text-3xl font-black text-foreground">Submit a project</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Projects are stored in Postgres, registered on Hedera by the worker, and then evaluated into the real approval queue.
        </p>
      </div>

      {!auth.authenticated ? (
        <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Connect the winner wallet first. The payout account and EVM address are taken from the active MetaMask session.
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>Hackathon</Label>
            <Select value={form.hackathonId} onValueChange={(value) => setForm((current) => ({ ...current, hackathonId: value, trackId: "" }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select a hackathon" />
              </SelectTrigger>
              <SelectContent>
                {hackathonsQuery.data?.map((hackathon) => (
                  <SelectItem key={hackathon.id} value={hackathon.id}>
                    {hackathon.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Track</Label>
            <Select value={form.trackId} onValueChange={(value) => setForm((current) => ({ ...current, trackId: value }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select a track" />
              </SelectTrigger>
              <SelectContent>
                {currentHackathon?.tracks.map((track) => (
                  <SelectItem key={track.id} value={track.id}>
                    {track.name} · {track.sponsorName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Project name</Label>
            <Input value={form.projectName} onChange={(event) => setForm((current) => ({ ...current, projectName: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Team name</Label>
            <Input value={form.teamName} onChange={(event) => setForm((current) => ({ ...current, teamName: event.target.value }))} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Team members</Label>
            <Textarea value={form.teamMembers} onChange={(event) => setForm((current) => ({ ...current, teamMembers: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>GitHub URL</Label>
            <Input value={form.githubUrl} onChange={(event) => setForm((current) => ({ ...current, githubUrl: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Demo URL</Label>
            <Input value={form.demoUrl} onChange={(event) => setForm((current) => ({ ...current, demoUrl: event.target.value }))} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Contracts</Label>
            <Textarea
              value={form.deployedContracts}
              onChange={(event) => setForm((current) => ({ ...current, deployedContracts: event.target.value }))}
              placeholder="label,address,hashscanUrl"
            />
          </div>
          <div className="space-y-2">
            <Label>Payout account</Label>
            <Input value={auth.user?.accountId ?? ""} readOnly />
          </div>
          <div className="space-y-2">
            <Label>Payout EVM address</Label>
            <Input value={auth.user?.evmAddress ?? ""} readOnly />
          </div>
        </div>
      </section>

      <Button onClick={() => void handleSubmit()} disabled={mutation.isPending}>
        {mutation.isPending ? "Submitting…" : "Submit project"}
      </Button>
    </div>
  );
}
