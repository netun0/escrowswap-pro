import type { ReactNode } from "react";

export function HackathonSubmissionsProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useHackathonSubmissions() {
  throw new Error("useHackathonSubmissions is no longer used; submissions are API-backed.");
}
