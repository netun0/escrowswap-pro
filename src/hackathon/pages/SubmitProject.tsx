import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useHackathonSubmissions } from "@/hackathon/HackathonSubmissionsContext";
import { useHackathonList } from "@/hackathon/HackathonListContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Send, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function SubmitProject() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { addProjectSubmission } = useHackathonSubmissions();
  const { hackathons, loading, error } = useHackathonList();

  const hParam = params.get("h");
  const [hackathonId, setHackathonId] = useState("");

  useEffect(() => {
    if (hackathons.length === 0) return;
    if (hParam && hackathons.some((h) => h.id === hParam)) {
      setHackathonId(hParam);
      return;
    }
    setHackathonId((prev) => (prev && hackathons.some((h) => h.id === prev) ? prev : hackathons[0].id));
  }, [hParam, hackathons]);

  const hackathon = useMemo(() => {
    if (hackathons.length === 0) return undefined;
    return hackathons.find((h) => h.id === hackathonId) ?? hackathons[0];
  }, [hackathons, hackathonId]);

  const [trackId, setTrackId] = useState(() => hackathon?.tracks[0]?.id ?? "");

  useEffect(() => {
    const first = hackathon?.tracks[0]?.id ?? "";
    if (!hackathon?.tracks.some((t) => t.id === trackId)) {
      setTrackId(first);
    }
  }, [hackathon, trackId]);
  const [projectName, setProjectName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [demoUrl, setDemoUrl] = useState("");
  const [description, setDescription] = useState("");

  const pastDeadline = hackathon ? Date.now() / 1000 > hackathon.submissionDeadline : false;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hackathon) return;
    const tid = trackId || hackathon.tracks[0]?.id;
    if (!tid) {
      toast.error("This event has no tracks configured.");
      return;
    }
    if (!projectName.trim() || !teamName.trim() || !description.trim()) {
      toast.error("Project name, team name, and description are required.");
      return;
    }
    if (!githubUrl.trim() || !demoUrl.trim()) {
      toast.error("GitHub URL and demo URL are required.");
      return;
    }
    addProjectSubmission(hackathon.id, {
      trackId: tid,
      projectName,
      teamName,
      teamMembers,
      githubUrl,
      demoUrl,
      description,
    });
    toast.success("Project submitted — it will appear in Submissions for this event.");
    navigate(`/hackathon/submissions?h=${encodeURIComponent(hackathon.id)}`);
  };

  if (loading && hackathons.length === 0) {
    return (
      <div className="max-w-lg mx-auto py-12 text-center text-sm text-muted-foreground">Loading events…</div>
    );
  }

  if (!loading && hackathons.length === 0) {
    return (
      <div className="max-w-lg mx-auto space-y-3 py-8">
        <p className="text-sm text-muted-foreground">No events to submit to yet.</p>
        {error ? <p className="text-xs text-destructive font-mono">{error}</p> : null}
        <Link to="/hackathon/create" className="text-xs font-mono text-accent hover:underline inline-block">
          Create an event
        </Link>
      </div>
    );
  }

  if (!hackathon) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <p className="text-sm text-muted-foreground">No hackathon data available.</p>
        <Link to="/hackathon" className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Back to events
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <Link
        to="/hackathon"
        className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3 w-3" /> All events
      </Link>

      <div>
        <h1 className="text-xl font-black text-foreground">Submit project</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Register your build for <span className="text-foreground font-medium">{hackathon.name}</span>. Submissions are
          stored in this browser; events may be loaded from the server when mock mode is off.
        </p>
      </div>

      {pastDeadline && (
        <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>Official submission window has passed for this event. You can still submit for demo purposes.</p>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-5 border border-border bg-card p-6">
        <div className="space-y-1.5">
          <Label className="text-[10px] font-mono uppercase text-muted-foreground">Event</Label>
          <Select
            value={hackathonId}
            onValueChange={(id) => {
              setHackathonId(id);
              const h = hackathons.find((x) => x.id === id);
              if (h?.tracks[0]) setTrackId(h.tracks[0].id);
            }}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hackathons.map((h) => (
                <SelectItem key={h.id} value={h.id} className="text-xs">
                  {h.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] font-mono uppercase text-muted-foreground">Track</Label>
          <Select
            value={trackId || (hackathon.tracks[0]?.id ?? "")}
            onValueChange={setTrackId}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Select track" />
            </SelectTrigger>
            <SelectContent>
              {hackathon.tracks.map((t) => (
                <SelectItem key={t.id} value={t.id} className="text-xs">
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="projectName" className="text-[10px] font-mono uppercase text-muted-foreground">
            Project name
          </Label>
          <Input
            id="projectName"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="h-9 text-xs"
            placeholder="e.g. ChainForge"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="teamName" className="text-[10px] font-mono uppercase text-muted-foreground">
            Team name
          </Label>
          <Input
            id="teamName"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            className="h-9 text-xs"
            placeholder="Display name for judges"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="teamMembers" className="text-[10px] font-mono uppercase text-muted-foreground">
            Team members (optional)
          </Label>
          <Textarea
            id="teamMembers"
            value={teamMembers}
            onChange={(e) => setTeamMembers(e.target.value)}
            className="min-h-[72px] text-xs resize-y"
            placeholder="Handles or wallet labels, comma or newline separated"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="githubUrl" className="text-[10px] font-mono uppercase text-muted-foreground">
            GitHub URL
          </Label>
          <Input
            id="githubUrl"
            type="url"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            className="h-9 text-xs font-mono"
            placeholder="https://github.com/org/repo"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="demoUrl" className="text-[10px] font-mono uppercase text-muted-foreground">
            Demo URL
          </Label>
          <Input
            id="demoUrl"
            type="url"
            value={demoUrl}
            onChange={(e) => setDemoUrl(e.target.value)}
            className="h-9 text-xs font-mono"
            placeholder="https://…"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description" className="text-[10px] font-mono uppercase text-muted-foreground">
            Description
          </Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[100px] text-xs resize-y"
            placeholder="What you built and why it matters"
          />
        </div>

        <Button type="submit" className="w-full h-9 text-xs gap-2">
          <Send className="h-3.5 w-3.5" />
          Submit project
        </Button>
      </form>
    </div>
  );
}
