/**
 * When true (default), JudgeBuddy uses embedded `MOCK_HACKATHONS`.
 * Set `VITE_HACKATHON_MOCKUP=false` to load and create events via the Hedera API (`GET`/`POST` `/hackathons`, JSON file on the server).
 * Requires `VITE_HEDERA_API_URL` (e.g. http://localhost:3001).
 */
export function isHackathonMockup(): boolean {
  const v = import.meta.env.VITE_HACKATHON_MOCKUP?.toLowerCase().trim();
  if (v === "false" || v === "0") return false;
  return true;
}
