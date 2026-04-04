import type { Submission } from "@/hackathon/types";

const STORAGE_KEY = "judgebuddy-user-submissions";

export function loadExtraSubmissions(): Record<string, Submission[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Submission[]>;
  } catch {
    return {};
  }
}

export function saveExtraSubmissions(data: Record<string, Submission[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function appendUserSubmission(hackathonId: string, sub: Submission) {
  const all = loadExtraSubmissions();
  const list = all[hackathonId] ?? [];
  all[hackathonId] = [...list, sub];
  saveExtraSubmissions(all);
}

export function findHackathonIdForUserSubmission(submissionId: string): string | undefined {
  const all = loadExtraSubmissions();
  for (const [hid, subs] of Object.entries(all)) {
    if (subs.some((s) => s.id === submissionId)) return hid;
  }
  return undefined;
}

export function getMergedSubmissions(hackathonId: string, mockSubs: Submission[]): Submission[] {
  const extra = loadExtraSubmissions()[hackathonId] ?? [];
  return [...mockSubs, ...extra];
}
