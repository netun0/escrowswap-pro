export type TrackDraft = {
  name: string;
  description: string;
  prize: string;
  requirements: string[];
};

export function buildHackathonPayload(): never {
  throw new Error("buildHackathonPayload was removed with the mock hackathon flow.");
}
