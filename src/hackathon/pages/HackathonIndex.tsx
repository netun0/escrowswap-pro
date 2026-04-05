import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink, ShieldCheck, Wallet } from "lucide-react";
import { listHackathons } from "@/hackathon/api";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";

function money(value: string): string {
  return Intl.NumberFormat("en-US").format(Number(value || 0));
}

export default function HackathonIndex() {
  const auth = useAuth();
  const query = useQuery({
    queryKey: ["hackathons"],
    queryFn: listHackathons,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-accent">Primary Surface</p>
          <h1 className="mt-2 text-3xl font-black text-foreground">Hackathon treasury platform</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Live hackathons, treasury funding, evaluation state, award approvals, claim token lifecycle, and the Hedera audit trail.
          </p>
        </div>

        {auth.authenticated ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-right">
            <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-primary">Signed In</p>
            <p className="mt-1 text-sm font-medium text-foreground">{auth.user?.accountId}</p>
            <p className="text-[11px] text-muted-foreground">{auth.user?.evmAddress}</p>
          </div>
        ) : (
          <Button onClick={auth.openAuthDialog}>
            <Wallet className="mr-2 h-4 w-4" />
            Connect MetaMask
          </Button>
        )}
      </div>

      {query.isLoading ? <div className="text-sm text-muted-foreground">Loading hackathons…</div> : null}
      {query.error ? <div className="text-sm text-destructive">{(query.error as Error).message}</div> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {query.data?.map((hackathon) => {
          const totalPrize = hackathon.tracks.reduce((sum, track) => sum + BigInt(track.prizeAmount), 0n);
          return (
            <article key={hackathon.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-foreground">{hackathon.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{hackathon.tagline}</p>
                </div>
                <span className="rounded-full bg-secondary px-3 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-secondary-foreground">
                  {hackathon.status}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Judge signer</dt>
                  <dd className="mt-1 font-mono text-[12px] text-foreground">{hackathon.judgeEvmAddress}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Prize pool</dt>
                  <dd className="mt-1 text-foreground">{money(totalPrize.toString())} units</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Autonomous threshold</dt>
                  <dd className="mt-1 text-foreground">{money(hackathon.autonomousThreshold)} units</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Treasury funding</dt>
                  <dd className="mt-1 flex items-center gap-2 text-foreground">
                    {hackathon.treasuryTxHash ? <ShieldCheck className="h-4 w-4 text-primary" /> : null}
                    {hackathon.treasuryTxHash ? "Synced" : "Not funded"}
                  </dd>
                </div>
              </dl>

              {hackathon.treasuryTxHash ? (
                <a
                  href={`https://hashscan.io/testnet/transaction/${hackathon.treasuryTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  View funding tx <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-2">
                <Link to={`/hackathon/live?id=${encodeURIComponent(hackathon.id)}`}>
                  <Button variant="outline">Manage Treasury</Button>
                </Link>
                <Link to={`/hackathon/submissions?h=${encodeURIComponent(hackathon.id)}`}>
                  <Button variant="secondary">Submissions</Button>
                </Link>
                <Link to={`/hackathon/agents?h=${encodeURIComponent(hackathon.id)}`}>
                  <Button>Approval Queue</Button>
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      {!query.isLoading && (query.data?.length ?? 0) === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
          No hackathons exist yet. Create one, fund its treasury on Hedera Testnet, then start routing submissions into the approval flow.
        </div>
      ) : null}
    </div>
  );
}
