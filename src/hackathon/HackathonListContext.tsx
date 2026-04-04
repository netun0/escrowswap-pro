import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { HEDERA_API_URL } from "@/contracts/env";
import type { Hackathon } from "@/hackathon/types";
import { MOCK_HACKATHONS } from "@/hackathon/mockData";
import { isHackathonMockup } from "@/hackathon/hackathonEnv";

type Ctx = {
  hackathons: Hackathon[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  isMock: boolean;
};

const HackathonListContext = createContext<Ctx | null>(null);

export function HackathonListProvider({ children }: { children: ReactNode }) {
  const isMock = useMemo(() => isHackathonMockup(), []);
  const [hackathons, setHackathons] = useState<Hackathon[]>(() => (isMock ? MOCK_HACKATHONS : []));
  const [loading, setLoading] = useState(!isMock);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (isMock) {
      setHackathons(MOCK_HACKATHONS);
      setLoading(false);
      setError(null);
      return;
    }
    const base = HEDERA_API_URL.replace(/\/$/, "");
    if (!base) {
      setHackathons([]);
      setLoading(false);
      setError("Set VITE_HEDERA_API_URL to load hackathons from the server.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${base}/hackathons`);
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || r.statusText);
      }
      const data = (await r.json()) as Hackathon[];
      if (!Array.isArray(data)) throw new Error("Invalid /hackathons response");
      setHackathons(data);
    } catch (e) {
      setError((e as Error).message);
      setHackathons([]);
    } finally {
      setLoading(false);
    }
  }, [isMock]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const value = useMemo<Ctx>(
    () => ({
      hackathons,
      loading,
      error,
      refetch,
      isMock,
    }),
    [hackathons, loading, error, refetch, isMock],
  );

  return <HackathonListContext.Provider value={value}>{children}</HackathonListContext.Provider>;
}

export function useHackathonList() {
  const ctx = useContext(HackathonListContext);
  if (!ctx) {
    throw new Error("useHackathonList must be used within HackathonListProvider");
  }
  return ctx;
}
