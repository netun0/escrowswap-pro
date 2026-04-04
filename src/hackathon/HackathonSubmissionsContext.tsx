import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Submission } from "@/hackathon/types";
import { appendUserSubmission, getMergedSubmissions } from "@/hackathon/userSubmissionsStorage";

export type SubmitProjectForm = {
  trackId: string;
  projectName: string;
  teamName: string;
  /** Comma- or newline-separated wallet labels / handles */
  teamMembers: string;
  githubUrl: string;
  demoUrl: string;
  description: string;
};

type Ctx = {
  version: number;
  addProjectSubmission: (hackathonId: string, form: SubmitProjectForm) => Submission;
  getMergedSubmissions: (hackathonId: string, mockSubs: Submission[]) => Submission[];
};

const HackathonSubmissionsContext = createContext<Ctx | null>(null);

function buildSubmission(hackathonId: string, form: SubmitProjectForm): Submission {
  const team = form.teamMembers
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id: `sub-user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    hackathonId,
    trackId: form.trackId,
    projectName: form.projectName.trim(),
    teamName: form.teamName.trim(),
    team: team.length > 0 ? team : ["—"],
    githubUrl: form.githubUrl.trim(),
    demoUrl: form.demoUrl.trim(),
    description: form.description.trim(),
    submittedAt: Math.floor(Date.now() / 1000),
    status: "pending",
    eligibility: null,
    trackFit: null,
    qualityScore: null,
    finalRank: null,
    payoutTxHash: null,
  };
}

export function HackathonSubmissionsProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const addProjectSubmission = useCallback(
    (hackathonId: string, form: SubmitProjectForm) => {
      const sub = buildSubmission(hackathonId, form);
      appendUserSubmission(hackathonId, sub);
      refresh();
      return sub;
    },
    [refresh],
  );

  const value = useMemo<Ctx>(
    () => ({
      version,
      addProjectSubmission,
      getMergedSubmissions: (hackathonId: string, mockSubs: Submission[]) => {
        void version;
        return getMergedSubmissions(hackathonId, mockSubs);
      },
    }),
    [version, addProjectSubmission],
  );

  return <HackathonSubmissionsContext.Provider value={value}>{children}</HackathonSubmissionsContext.Provider>;
}

export function useHackathonSubmissions() {
  const ctx = useContext(HackathonSubmissionsContext);
  if (!ctx) {
    throw new Error("useHackathonSubmissions must be used within HackathonSubmissionsProvider");
  }
  return ctx;
}

