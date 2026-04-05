import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Shield, Wallet } from "lucide-react";
import { approveAward, fetchPipeline } from "@/hackathon/api";
import { signApprovalRequest } from "@/hackathon/ledger";
import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import type { ApprovalRequest } from "@/hackathon/types";
import { toast } from "sonner";

function formatFieldValue(value: string): string {
  return value.length > 84 ? `${value.slice(0, 84)}…` : value;
}

async function signAndApprove(request: ApprovalRequest) {
  const signature = await signApprovalRequest(request);
  return approveAward(
    request.awardId,
    (request.clearSigningManifest as { rawPayload: Record<string, unknown> }).rawPayload,
    signature,
  );
}

export default function AgentPipeline() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const hackathonId = searchParams.get("h") ?? undefined;

  const pipelineQuery = useQuery({
    queryKey: ["pipeline", hackathonId],
    queryFn: () => fetchPipeline(hackathonId),
    refetchInterval: 4000,
  });

  const approveMutation = useMutation({
    mutationFn: signAndApprove,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pipeline", hackathonId] });
      await queryClient.invalidateQueries({ queryKey: ["submissions"] });
      toast.success("Approval signed and execution queued.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-accent">Ledger Queue</p>
          <h1 className="mt-2 text-3xl font-black text-foreground">Approval and execution pipeline</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review the exact EIP-712 action, clear-signing summary, digest, destination calldata, worker jobs, and HCS audit stream.
          </p>
        </div>
        {!auth.authenticated ? (
          <Button onClick={auth.openAuthDialog}>
            <Wallet className="mr-2 h-4 w-4" />
            Connect signer
          </Button>
        ) : (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-right">
            <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-primary">Connected signer</p>
            <p className="mt-1 text-sm font-medium text-foreground">{auth.user?.accountId}</p>
            <p className="text-[11px] text-muted-foreground">{auth.user?.evmAddress}</p>
          </div>
        )}
      </div>

      <section className="space-y-4">
        {pipelineQuery.data?.approvals.map((approval) => {
          const manifest = approval.clearSigningManifest as {
            summary: string;
            fields: Array<{ label: string; value: string }>;
            functionName: string;
            calldataPreview: string;
            claimMetadata?: { metadataURI: string };
          };
          const canSign =
            auth.user?.evmAddress?.toLowerCase() === approval.signerEvmAddress.toLowerCase() && approval.status === "pending";
          return (
            <article key={approval.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-accent">{approval.actionType}</p>
                  <h2 className="mt-1 text-xl font-bold text-foreground">{manifest.summary}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Digest {approval.digest}</p>
                </div>
                <span className="rounded-full bg-secondary px-3 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-secondary-foreground">
                  {approval.status}
                </span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {manifest.fields?.map((field) => (
                  <div key={field.label} className="rounded-lg border border-border p-3">
                    <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-muted-foreground">{field.label}</p>
                    <p className="mt-1 text-sm text-foreground">{formatFieldValue(field.value)}</p>
                  </div>
                ))}
              </div>

              {manifest.claimMetadata?.metadataURI ? (
                <div className="mt-4 rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  Claim metadata URI: <span className="font-mono text-foreground">{manifest.claimMetadata.metadataURI}</span>
                </div>
              ) : null}

              <div className="mt-4 rounded-lg border border-border p-4">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium text-foreground">Destination call</p>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{manifest.functionName}</p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{manifest.calldataPreview}</pre>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => approveMutation.mutate(approval)} disabled={!canSign || approveMutation.isPending}>
                  Sign and queue execution
                </Button>
                <a
                  href={`https://hashscan.io/testnet/account/${approval.signerEvmAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  Signer on HashScan <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </article>
          );
        })}

        {!pipelineQuery.isLoading && (pipelineQuery.data?.approvals.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
            No approval requests are pending. Queue evaluation on a submission whose prize exceeds the autonomous threshold to generate one.
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-bold text-foreground">Worker jobs</h2>
          <div className="mt-4 space-y-3 text-sm">
            {pipelineQuery.data?.jobs.slice(0, 8).map((job) => (
              <div key={String(job.id)} className="rounded-lg border border-border p-3">
                <p className="font-medium text-foreground">{String(job.type)}</p>
                <p className="mt-1 text-muted-foreground">{String(job.status)}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-bold text-foreground">HCS audit</h2>
          <div className="mt-4 space-y-3 text-sm">
            {pipelineQuery.data?.hcsAudit.slice(0, 8).map((event) => (
              <div key={String(event.id)} className="rounded-lg border border-border p-3">
                <p className="font-medium text-foreground">{String(event.type)}</p>
                <p className="mt-1 text-muted-foreground">{String(event.txId ?? "pending")}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-bold text-foreground">Timeline</h2>
          <div className="mt-4 space-y-3 text-sm">
            {pipelineQuery.data?.events.slice(0, 8).map((event) => (
              <div key={event.id} className="rounded-lg border border-border p-3">
                <p className="font-medium text-foreground">{event.type}</p>
                <p className="mt-1 text-muted-foreground">{event.createdAt}</p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
