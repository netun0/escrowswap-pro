import { createContext, useContext, type ReactNode } from "react";
import type { Hackathon } from "@/hackathon/types";

type Ctx = {
  hackathons: Hackathon[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  isMock: false;
};

const HackathonListContext = createContext<Ctx | null>(null);

export function HackathonListProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useHackathonList() {
  const ctx = useContext(HackathonListContext);
  if (!ctx) {
    throw new Error("useHackathonList is no longer used; fetch hackathons via React Query in route components.");
  }
  return ctx;
}
