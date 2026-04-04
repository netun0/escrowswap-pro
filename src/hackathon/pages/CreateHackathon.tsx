import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Trophy,
  Plus,
  Trash2,
  Lock,
  Shield,
  Bot,
  CheckCircle2,
  FileText,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

interface TrackDraft {
  name: string;
  description: string;
  prize: string;
  requirements: string[];
}

interface EligibilityRule {
  id: string;
  label: string;
  enabled: boolean;
  description: string;
}

const DEFAULT_ELIGIBILITY_RULES: EligibilityRule[] = [
  { id: "github", label: "GitHub repo must be public & live", enabled: true, description: "Agent verifies the repo URL returns 200 and is not empty." },
  { id: "demo", label: "Demo video / live link required", enabled: true, description: "Agent checks for a valid video URL or deployed app link." },
  { id: "readme", label: "README with setup instructions", enabled: false, description: "Agent scans for a README.md with install/run steps." },
  { id: "license", label: "Open source license present", enabled: false, description: "Agent checks for an OSI-approved LICENSE file." },
  { id: "deploy", label: "Smart contract deployed on testnet", enabled: false, description: "Agent verifies contract address on the target chain." },
  { id: "tests", label: "Automated tests included", enabled: false, description: "Agent checks for a test directory with passing CI." },
];

const QUALITY_CRITERIA = [
  { id: "innovation", label: "Innovation & Novelty", weight: 30 },
  { id: "execution", label: "Technical Execution", weight: 25 },
  { id: "design", label: "Design & UX", weight: 20 },
  { id: "impact", label: "Real-world Impact", weight: 15 },
  { id: "presentation", label: "Presentation Quality", weight: 10 },
];

export default function CreateHackathon() {
  const navigate = useNavigate();

  // Basic info
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Tracks
  const [tracks, setTracks] = useState<TrackDraft[]>([
    { name: "", description: "", prize: "", requirements: [""] },
  ]);

  // Eligibility rules
  const [eligibilityRules, setEligibilityRules] = useState<EligibilityRule[]>(
    DEFAULT_ELIGIBILITY_RULES
  );

  // Quality weights
  const [qualityWeights, setQualityWeights] = useState(
    QUALITY_CRITERIA.map((c) => ({ ...c }))
  );

  // Safety
  const [autoEscrow, setAutoEscrow] = useState(true);
  const [maxSubmissionsPerTeam, setMaxSubmissionsPerTeam] = useState("1");
  const [autoPayoutOnConfirm, setAutoPayoutOnConfirm] = useState(true);

  const totalPrize = tracks.reduce((s, t) => s + (Number(t.prize) || 0), 0);
  const totalWeight = qualityWeights.reduce((s, w) => s + w.weight, 0);

  function addTrack() {
    setTracks([...tracks, { name: "", description: "", prize: "", requirements: [""] }]);
  }

  function removeTrack(i: number) {
    setTracks(tracks.filter((_, idx) => idx !== i));
  }

  function updateTrack(i: number, field: keyof TrackDraft, value: string) {
    const copy = [...tracks];
    (copy[i] as any)[field] = value;
    setTracks(copy);
  }

  function addRequirement(trackIdx: number) {
    const copy = [...tracks];
    copy[trackIdx].requirements.push("");
    setTracks(copy);
  }

  function updateRequirement(trackIdx: number, reqIdx: number, value: string) {
    const copy = [...tracks];
    copy[trackIdx].requirements[reqIdx] = value;
    setTracks(copy);
  }

  function removeRequirement(trackIdx: number, reqIdx: number) {
    const copy = [...tracks];
    copy[trackIdx].requirements = copy[trackIdx].requirements.filter((_, i) => i !== reqIdx);
    setTracks(copy);
  }

  function toggleRule(id: string) {
    setEligibilityRules(
      eligibilityRules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  }

  function updateWeight(id: string, weight: number) {
    setQualityWeights(
      qualityWeights.map((w) => (w.id === id ? { ...w, weight: Math.max(0, Math.min(100, weight)) } : w))
    );
  }

  function handleSubmit() {
    if (!name.trim()) return toast.error("Hackathon name is required");
    if (tracks.some((t) => !t.name.trim() || !t.prize)) return toast.error("All tracks need a name and prize");
    if (totalWeight !== 100) return toast.error(`Quality weights must total 100% (currently ${totalWeight}%)`);
    toast.success("Hackathon created! Escrow will lock on start date.");
    navigate("/hackathon");
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-accent" />
          <span className="text-[10px] font-mono text-accent uppercase tracking-widest">
            Organizer Setup
          </span>
        </div>
        <h1 className="text-2xl font-black text-foreground tracking-tight">
          Create Hackathon
        </h1>
        <p className="text-xs text-muted-foreground">
          Define your event, tracks, judging rules, and agent validation criteria. Everything you set here drives the autonomous pipeline.
        </p>
      </div>

      {/* ── Section 1: Event Details ── */}
      <section className="border border-border bg-card p-6 space-y-5">
        <div className="flex items-center gap-2 mb-1">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold text-foreground">Event Details</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Hackathon Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ETH Global SF 2025"
              className="bg-background text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tagline</Label>
            <Input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="The first trustless hackathon"
              className="bg-background text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Start Date</Label>
            <Input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-background text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">End Date</Label>
            <Input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-background text-sm"
            />
          </div>
        </div>
      </section>

      {/* ── Section 2: Tracks & Prizes ── */}
      <section className="border border-border bg-card p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-bold text-foreground">Tracks & Prizes</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-muted-foreground">
              Total: <span className="text-accent font-bold">${totalPrize.toLocaleString()}</span> USDC
            </span>
            <Button variant="outline" size="sm" className="text-[10px] h-7" onClick={addTrack}>
              <Plus className="h-3 w-3 mr-1" /> Add Track
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {tracks.map((track, i) => (
            <div key={i} className="border border-border bg-background p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-accent">Track {String(i + 1).padStart(2, "0")}</span>
                {tracks.length > 1 && (
                  <button onClick={() => removeTrack(i)} className="text-destructive hover:text-destructive/80">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground">Track Name</Label>
                  <Input
                    value={track.name}
                    onChange={(e) => updateTrack(i, "name", e.target.value)}
                    placeholder="DeFi Innovation"
                    className="bg-card text-xs h-8"
                  />
                </div>
                <div className="col-span-1 space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground">Prize (USDC)</Label>
                  <Input
                    type="number"
                    value={track.prize}
                    onChange={(e) => updateTrack(i, "prize", e.target.value)}
                    placeholder="50,000"
                    className="bg-card text-xs h-8 font-mono"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Description</Label>
                <Textarea
                  value={track.description}
                  onChange={(e) => updateTrack(i, "description", e.target.value)}
                  placeholder="What should participants build in this track?"
                  className="bg-card text-xs min-h-[60px]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] text-muted-foreground">Track Requirements (used by agents to verify submissions)</Label>
                {track.requirements.map((req, ri) => (
                  <div key={ri} className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-mono w-4">{ri + 1}.</span>
                    <Input
                      value={req}
                      onChange={(e) => updateRequirement(i, ri, e.target.value)}
                      placeholder="e.g. Smart contract deployed on testnet"
                      className="bg-card text-xs h-7 flex-1"
                    />
                    {track.requirements.length > 1 && (
                      <button onClick={() => removeRequirement(i, ri)} className="text-destructive/60 hover:text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => addRequirement(i)}
                  className="text-[10px] text-primary hover:text-primary/80 font-medium flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> Add requirement
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 3: Agent Eligibility Rules ── */}
      <section className="border border-border bg-card p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold text-foreground">Agent Eligibility Rules</h2>
        </div>
        <p className="text-[10px] text-muted-foreground -mt-3">
          These binary checks run automatically on every submission. Toggle which ones your hackathon requires.
        </p>

        <div className="space-y-2">
          {eligibilityRules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-start gap-3 border border-border bg-background p-3 hover:border-primary/30 transition-colors"
            >
              <Switch
                checked={rule.enabled}
                onCheckedChange={() => toggleRule(rule.id)}
                className="mt-0.5"
              />
              <div className="flex-1 space-y-0.5">
                <p className="text-xs font-medium text-foreground">{rule.label}</p>
                <p className="text-[10px] text-muted-foreground">{rule.description}</p>
              </div>
              {rule.enabled && (
                <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 4: Quality Scoring Weights ── */}
      <section className="border border-border bg-card p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-bold text-foreground">Quality Scoring Weights</h2>
          </div>
          <span className={`text-xs font-mono ${totalWeight === 100 ? "text-primary" : "text-destructive"}`}>
            {totalWeight}% / 100%
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground -mt-3">
          Configure how the AI quality agent weighs each criterion. These weights shape the 0–100 score.
        </p>

        <div className="space-y-3">
          {qualityWeights.map((crit) => (
            <div key={crit.id} className="flex items-center gap-4">
              <span className="text-xs text-foreground w-40">{crit.label}</span>
              <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${crit.weight}%` }}
                />
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => updateWeight(crit.id, crit.weight - 5)}
                  className="text-[10px] text-muted-foreground hover:text-foreground px-1"
                >
                  −
                </button>
                <span className="text-xs font-mono text-foreground w-8 text-center">
                  {crit.weight}%
                </span>
                <button
                  onClick={() => updateWeight(crit.id, crit.weight + 5)}
                  className="text-[10px] text-muted-foreground hover:text-foreground px-1"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 5: Safety & Settlement ── */}
      <section className="border border-border bg-card p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold text-foreground">Safety & Settlement</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-start gap-3 border border-border bg-background p-3">
            <Switch checked={autoEscrow} onCheckedChange={setAutoEscrow} className="mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-foreground">Lock escrow on start</p>
              <p className="text-[10px] text-muted-foreground">
                Prize pool auto-locks in the Hedera operator escrow when the hackathon begins.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 border border-border bg-background p-3">
            <Switch checked={autoPayoutOnConfirm} onCheckedChange={setAutoPayoutOnConfirm} className="mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-foreground">Auto-payout on confirm</p>
              <p className="text-[10px] text-muted-foreground">
                USDC released instantly when a judge confirms the winner. No manual transfer.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Max submissions per team</Label>
          <Input
            type="number"
            value={maxSubmissionsPerTeam}
            onChange={(e) => setMaxSubmissionsPerTeam(e.target.value)}
            className="bg-background text-xs h-8 w-32 font-mono"
            min={1}
            max={5}
          />
        </div>
      </section>

      {/* Submit */}
      <div className="flex items-center justify-between border border-border bg-card p-5">
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            {tracks.length} track{tracks.length !== 1 && "s"} · ${totalPrize.toLocaleString()} USDC ·{" "}
            {eligibilityRules.filter((r) => r.enabled).length} eligibility checks
          </p>
          <p className="text-[10px] text-muted-foreground">
            Agents will start processing submissions automatically once the event goes live.
          </p>
        </div>
        <Button onClick={handleSubmit} className="bg-primary text-primary-foreground font-bold text-xs px-6">
          <Lock className="h-3.5 w-3.5 mr-1.5" />
          Create & Lock Escrow
        </Button>
      </div>
    </div>
  );
}
