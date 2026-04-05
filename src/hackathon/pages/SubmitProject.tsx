import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import type { CreateSubmissionRequest } from "@shared/treasury";
import { createSubmission, fetchHackathons } from "@/hackathon/api";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type ContractDraft = {
  label: string;
  address: string;
  hashscanUrl: string;
};

export default function SubmitProject() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { authenticated, openAuthDialog, user } = useAuth();

  const hackathons = useQuery({
    queryKey: ["hackathons"],
    queryFn: fetchHackathons,
  });

  const initialHackathonId = params.get("h") ?? "";
  const [hackathonId, setHackathonId] = useState(initialHackathonId);
  const selectedHackathon = useMemo(
    () => hackathons.data?.find((entry) => entry.id === hackathonId) ?? hackathons.data?.[0],
    [hackathonId, hackathons.data],
  );
  const [trackId, setTrackId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [demoUrl, setDemoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [payoutAccountId, setPayoutAccountId] = useState(user?.accountId ?? "");
  const [payoutEvmAddress, setPayoutEvmAddress] = useState(user?.evmAddress ?? "");
  const [contracts, setContracts] = useState<ContractDraft[]>([{ label: "", address: "", hashscanUrl: "" }]);

  useEffect(() => {
    if (!hackathonId && selectedHackathon?.id) {
      setHackathonId(selectedHackathon.id);
      setParams({ h: selectedHackathon.id });
    }
  }, [hackathonId, selectedHackathon?.id, setParams]);

  useEffect(() => {
    if (!selectedHackathon) return;
    if (!selectedHackathon.tracks.some((track) => track.id === trackId)) {
      setTrackId(selectedHackathon.tracks[0]?.id ?? "");
    }
  }, [selectedHackathon, trackId]);

  useEffect(() => {
    if (user) {
      setPayoutAccountId((current) => current || user.accountId);
      setPayoutEvmAddress((current) => current || user.evmAddress);
    }
  }, [user]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!selectedHackathon) {
        throw new Error("Select a hackathon first.");
      }

      const payload: CreateSubmissionRequest = {
        hackathonId: selectedHackathon.id,
        trackId,
        projectName,
        teamName,
        teamMembers: teamMembers
          .split(/\n|,/)
          .map((entry) => entry.trim())
          .filter(Boolean),
        githubUrl,
        demoUrl,
        description,
        payoutAccountId,
        payoutEvmAddress,
        deployedContracts: contracts
          .filter((entry) => entry.label.trim() || entry.address.trim())
          .map((entry) => ({
            label: entry.label.trim(),
            address: entry.address.trim(),
            hashscanUrl: entry.hashscanUrl.trim() || undefined,
          })),
      };

      return createSubmission(payload);
    },
    onSuccess: async ({ submission }) => {
      toast.success("Submission stored and evaluation job queued.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["hackathon", submission.hackathonId] }),
        queryClient.invalidateQueries({ queryKey: ["hackathons"] }),
      ]);
      navigate(`/hackathon/submissions?h=${encodeURIComponent(submission.hackathonId)}&id=${encodeURIComponent(submission.id)}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not submit project");
    },
  });

  function updateContract(index: number, key: keyof ContractDraft, value: string) {
    setContracts((current) => current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, [key]: value } : entry)));
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Dashboard
      </Link>

      <div className="border border-border bg-card p-6">
        <h1 className="text-3xl font-black tracking-tight text-foreground">Submit a project</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          This creates the submission record the worker will evaluate against sponsor policy, GitHub evidence, demo availability, and deployed contract proofs.
        </p>
      </div>

      {!authenticated || !user ? (
        <div className="border border-border bg-card p-6 text-sm text-muted-foreground">
          Sign in if you want JudgeBuddy to prefill your payout account and MetaMask address.
          <div className="mt-3">
            <Button onClick={openAuthDialog}>Sign in</Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.05fr,0.95fr]">
        <section className="space-y-6">
          <div className="border border-border bg-card p-6">
            <h2 className="text-lg font-black text-foreground">Submission basics</h2>
            <div className="mt-4 grid gap-4">
              <div className="space-y-2">
                <Label>Hackathon</Label>
                <select
                  value={selectedHackathon?.id ?? ""}
                  onChange={(event) => {
                    setHackathonId(event.target.value);
                    setParams({ h: event.target.value });
                  }}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {(hackathons.data ?? []).map((hackathon) => (
                    <option key={hackathon.id} value={hackathon.id}>
                      {hackathon.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Track</Label>
                <select
                  value={trackId}
                  onChange={(event) => setTrackId(event.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {(selectedHackathon?.tracks ?? []).map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Project name</Label>
                <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="JudgeBuddy Treasury" />
              </div>
              <div className="space-y-2">
                <Label>Team name</Label>
                <Input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Team Ledger Hedera" />
              </div>
              <div className="space-y-2">
                <Label>Team members</Label>
                <Textarea
                  value={teamMembers}
                  onChange={(event) => setTeamMembers(event.target.value)}
                  placeholder="One member per line or comma-separated"
                />
              </div>
              <div className="space-y-2">
                <Label>GitHub URL</Label>
                <Input value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} placeholder="https://github.com/org/repo" className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label>Demo URL</Label>
                <Input value={demoUrl} onChange={(event) => setDemoUrl(event.target.value)} placeholder="https://demo.example.com" className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Explain the product, the sponsor fit, and what on-chain proof exists today."
                />
              </div>
            </div>
          </div>

          <div className="border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-foreground">Deployed contracts</h2>
                <p className="text-sm text-muted-foreground">Include every live contract relevant to sponsor qualification. Add a HashScan URL whenever you have one.</p>
              </div>
              <Button
                variant="outline"
                onClick={() => setContracts((current) => [...current, { label: "", address: "", hashscanUrl: "" }])}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add contract
              </Button>
            </div>

            <div className="mt-5 space-y-4">
              {contracts.map((entry, index) => (
                <div key={`${index}-${entry.label}`} className="border border-border bg-background/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-foreground">Contract {index + 1}</h3>
                    {contracts.length > 1 ? (
                      <Button variant="ghost" size="sm" onClick={() => setContracts((current) => current.filter((_, i) => i !== index))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-4">
                    <div className="space-y-2">
                      <Label>Label</Label>
                      <Input value={entry.label} onChange={(event) => updateContract(index, "label", event.target.value)} placeholder="HackathonTreasury" />
                    </div>
                    <div className="space-y-2">
                      <Label>Address</Label>
                      <Input value={entry.address} onChange={(event) => updateContract(index, "address", event.target.value)} placeholder="0x..." className="font-mono" />
                    </div>
                    <div className="space-y-2">
                      <Label>HashScan URL</Label>
                      <Input
                        value={entry.hashscanUrl}
                        onChange={(event) => updateContract(index, "hashscanUrl", event.target.value)}
                        placeholder="https://hashscan.io/testnet/contract/..."
                        className="font-mono"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="border border-border bg-card p-6">
            <h2 className="text-lg font-black text-foreground">Payout destination</h2>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label>Payout account id</Label>
                <Input value={payoutAccountId} onChange={(event) => setPayoutAccountId(event.target.value)} className="font-mono" placeholder="0.0.x" />
              </div>
              <div className="space-y-2">
                <Label>Payout EVM address</Label>
                <Input value={payoutEvmAddress} onChange={(event) => setPayoutEvmAddress(event.target.value)} className="font-mono" placeholder="0x..." />
              </div>
              {user ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setPayoutAccountId(user.accountId);
                    setPayoutEvmAddress(user.evmAddress);
                  }}
                >
                  Use my signed-in wallet
                </Button>
              ) : null}
            </div>
          </div>

          <div className="border border-border bg-card p-6">
            <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">What happens next</p>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <p>1. The submission is stored in Postgres with full payout and contract metadata.</p>
              <p>2. The worker enqueues eligibility, track-fit, and quality analysis.</p>
              <p>3. If the score clears the track threshold, JudgeBuddy proposes an award and either pays autonomously or opens an approval request.</p>
            </div>
            <Button className="mt-5 w-full" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending || !selectedHackathon}>
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting
                </>
              ) : (
                "Submit project"
              )}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
