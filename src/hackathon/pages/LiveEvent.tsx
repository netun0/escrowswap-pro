import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ShieldCheck, Wallet } from "lucide-react";
import { fundHackathon, getHackathon, listHackathons } from "@/hackathon/api";
import { approveTreasurySpending, bootstrapHackathonTreasury } from "@/hackathon/ledger";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const TREASURY_ADDRESS = (import.meta.env.VITE_TREASURY_CONTRACT_ADDRESS as string | undefined)?.trim() ?? "";

function money(value: string): string {
  return Intl.NumberFormat("en-US").format(Number(value || 0));
}

export default function LiveEvent() {
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"idle" | "approving" | "funding">("idle");
  const hackathonId = searchParams.get("id") ?? "";

  const listQuery = useQuery({
    queryKey: ["hackathons"],
    queryFn: listHackathons,
  });

  const resolvedHackathonId = useMemo(() => hackathonId || listQuery.data?.[0]?.id || "", [hackathonId, listQuery.data]);
  const hackathonQuery = useQuery({
    queryKey: ["hackathon", resolvedHackathonId],
    queryFn: () => getHackathon(resolvedHackathonId),
    enabled: Boolean(resolvedHackathonId),
  });

  const syncFunding = useMutation({
    mutationFn: (txHash: string) => fundHackathon(resolvedHackathonId, txHash),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["hackathons"] });
      await queryClient.invalidateQueries({ queryKey: ["hackathon", resolvedHackathonId] });
    },
  });

  const hackathon = hackathonQuery.data;
  const totalPrize = hackathon?.tracks.reduce((sum, track) => sum + BigInt(track.prizeAmount), 0n) ?? 0n;
  const canFund =
    Boolean(hackathon && TREASURY_ADDRESS) &&
    auth.authenticated &&
    auth.user?.accountId === hackathon?.organizerAccountId &&
    Boolean(hackathon && auth.user?.evmAddress && auth.user.evmAddress.toLowerCase() === hackathon.organizerEvmAddress.toLowerCase());

  async function handleApproveAndFund() {
    if (!hackathon) return;
    if (!TREASURY_ADDRESS) {
      toast.error("Set VITE_TREASURY_CONTRACT_ADDRESS before funding the treasury.");
      return;
    }
    try {
      setStep("approving");
      await approveTreasurySpending({
        tokenAddress: hackathon.payoutTokenEvmAddress,
        treasuryAddress: TREASURY_ADDRESS,
        amount: totalPrize.toString(),
      });
      setStep("funding");
      const txHash = await bootstrapHackathonTreasury({
        treasuryAddress: TREASURY_ADDRESS,
        hackathon,
      });
      await syncFunding.mutateAsync(txHash);
      toast.success("Treasury funded and synced from Hedera Testnet.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setStep("idle");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {hackathonQuery.isLoading ? <div className="text-sm text-muted-foreground">Loading treasury details…</div> : null}
      {hackathonQuery.error ? <div className="text-sm text-destructive">{(hackathonQuery.error as Error).message}</div> : null}

      {hackathon ? (
        <>
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-accent">Treasury Control</p>
              <h1 className="mt-2 text-3xl font-black text-foreground">{hackathon.name}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{hackathon.tagline}</p>
            </div>
            {!auth.authenticated ? (
              <Button onClick={auth.openAuthDialog}>
                <Wallet className="mr-2 h-4 w-4" />
                Connect organizer wallet
              </Button>
            ) : null}
          </div>

          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-foreground">Funding status</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Judge signer {hackathon.judgeEvmAddress} must approve high-value actions. The organizer funds the treasury directly on Hedera Testnet.
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => void handleApproveAndFund()}
                  disabled={!canFund || step !== "idle" || Boolean(hackathon.treasuryTxHash)}
                >
                  {step === "approving" ? "Approving token…" : step === "funding" ? "Funding treasury…" : "Approve + fund treasury"}
                </Button>
              </div>
            </div>

            {!TREASURY_ADDRESS ? (
              <p className="mt-4 text-sm text-destructive">Set `VITE_TREASURY_CONTRACT_ADDRESS` in the web app to send the funding transaction.</p>
            ) : null}

            {hackathon.treasuryTxHash ? (
              <a
                href={`https://hashscan.io/testnet/transaction/${hackathon.treasuryTxHash}`}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <ShieldCheck className="h-4 w-4" />
                Funding synced on HashScan
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">No funding receipt has been synced yet.</p>
            )}
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            {hackathon.tracks.map((track) => (
              <article key={track.id} className="rounded-xl border border-border bg-card p-5">
                <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-accent">{track.sponsorName}</p>
                <h3 className="mt-2 text-lg font-bold text-foreground">{track.name}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{track.description}</p>
                <p className="mt-4 text-sm text-foreground">{money(track.prizeAmount)} units</p>
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {track.requirements.map((requirement) => (
                    <li key={requirement}>• {requirement}</li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}
