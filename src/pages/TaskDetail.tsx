import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { BrowserProvider, getAddress } from "ethers";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TaskStateMachine } from "@/components/TaskStateMachine";
import { useEscrow } from "@/hooks/useEscrow";
import { shortenAddress, formatAmount, getTokenSymbol, timeUntil, MOCK_AUDIT_EVENTS } from "@/contracts/mockData";
import { ArrowLeft, ExternalLink, Copy, Clock, Shield, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  CHAIN_CONFIG,
  VERIFIER_MODE_LABELS,
  hashscanTransactionUrl,
  hashscanEvmTxUrl,
  type TaskLedgerTx,
} from "@/contracts/config";
import { ESCROW_USE_MOCK } from "@/contracts/env";
import { useAuth } from "@/auth/useAuth";
import { AuthRequiredCta } from "@/components/AuthRequiredCta";
import {
  ensureHederaEvmChain,
  approveTokenForEscrow,
  assertClientHasTokenBalance,
  fundTaskOnChain,
  releaseOnChain,
  refundOnChain,
  getInjectedEip1193,
} from "@/lib/hederaEscrowContract";

function idsEqual(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  return a.trim() === b.trim();
}

function mirrorAccountUrl(accountId: string): string {
  if (/^\d+\.\d+\.\d+$/.test(accountId)) {
    return `${CHAIN_CONFIG.blockExplorer}/account/${accountId}`;
  }
  return CHAIN_CONFIG.blockExplorer;
}

const LEDGER_LABELS: { key: keyof TaskLedgerTx; label: string }[] = [
  { key: "created", label: "Created (HCS message)" },
  { key: "funded", label: "Funded (HCS)" },
  { key: "submitted", label: "Submitted (HCS)" },
  { key: "rejected", label: "Rejected (HCS)" },
  { key: "dispute", label: "Dispute (HCS)" },
  { key: "settlement", label: "Payout transfer (HBAR / HTS / EVM release)" },
  { key: "paidAudit", label: "Paid audit (HCS)" },
  { key: "onChainFund", label: "On-chain fund (EVM)" },
  { key: "onChainRelease", label: "On-chain release (EVM)" },
  { key: "onChainRefund", label: "On-chain refund (EVM)" },
];

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { tasks, advanceState, txPending, syncOnChain } = useEscrow();
  const { authenticated, openAuthDialog, user } = useAuth();

  const task = tasks.find((t) => t.id === Number(id));
  const [browserEvm, setBrowserEvm] = useState<string | null>(null);

  useEffect(() => {
    if (!task?.escrowContract || task.state !== "Open" || !task.clientEvm) {
      setBrowserEvm(null);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const eth = getInjectedEip1193();
        if (!eth) {
          if (!cancel) setBrowserEvm(null);
          return;
        }
        const provider = new BrowserProvider(eth);
        const signer = await provider.getSigner();
        const a = getAddress(await signer.getAddress());
        if (!cancel) setBrowserEvm(a);
      } catch {
        if (!cancel) setBrowserEvm(null);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [task?.id, task?.escrowContract, task?.state, task?.clientEvm]);

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground font-mono text-sm">Task not found</p>
        <Link to="/" className="mt-4 text-primary hover:underline text-xs font-mono">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  const copyAddr = (addr: string) => {
    navigator.clipboard.writeText(addr);
    toast({ title: "Copied", description: addr });
  };

  const formatTs = (ts: number) => (ts > 0 ? new Date(ts * 1000).toLocaleString() : "—");

  const samePayoutToken = task.paymentToken === task.workerPreferredToken;
  const dl = timeUntil(task.deadline);
  const expiry = timeUntil(task.expiresAt);
  const taskAudit = MOCK_AUDIT_EVENTS.filter((e) => e.taskId === task.id);

  const accountId = user?.accountId ?? null;
  const isClient = idsEqual(accountId, task.client);
  const isWorker = idsEqual(accountId, task.worker);
  const isVerifier = idsEqual(accountId, task.verifier);
  const humanVerifier = task.verifierMode === "human";
  const autonomousVerifier = task.verifierMode === "autonomous";
  const evmClientWalletMismatch = Boolean(
    task.escrowContract &&
      task.state === "Open" &&
      task.clientEvm &&
      browserEvm &&
      getAddress(browserEvm) !== getAddress(task.clientEvm),
  );

  const runTx = async (fn: () => Promise<void>, okTitle: string) => {
    if (!authenticated) {
      openAuthDialog();
      toast({ title: "Authentication required", description: "Sign in (MetaMask or HashPack) before taking task actions." });
      return;
    }

    try {
      await fn();
      toast({ title: okTitle });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Action failed", description: msg, variant: "destructive" });
    }
  };

  const onFund = () => runTx(() => advanceState(task.id, "fund"), "Marked funded — send HBAR/HTS to the operator if you have not yet");
  const onSubmit = () => runTx(() => advanceState(task.id, "submit"), "Work submitted");
  const onDispute = () => runTx(() => advanceState(task.id, "dispute"), "Dispute opened");
  const onReject = () => runTx(() => advanceState(task.id, "reject"), "Recorded reject — next step depends on escrow mode");
  const onApprovePay = () => runTx(() => advanceState(task.id, "verify"), "Approved — verifier decision recorded");

  const runFundOnChain = () =>
    runTx(async () => {
      const eth = getInjectedEip1193();
      if (!eth) throw new Error("No injected wallet (window.ethereum).");
      if (!task.escrowContract) throw new Error("Not an on-chain escrow task.");
      await ensureHederaEvmChain(eth);
      const approveTx = await approveTokenForEscrow(task);
      await approveTx.wait();
      await assertClientHasTokenBalance(task);
      const fundTx = await fundTaskOnChain(task);
      const rec = await fundTx.wait();
      await syncOnChain(task.id, rec?.hash);
    }, "Funded on-chain — escrow locked");

  const runReleaseOnChain = () =>
    runTx(async () => {
      const eth = getInjectedEip1193();
      if (!eth) throw new Error("No injected wallet.");
      await ensureHederaEvmChain(eth);
      const tx = await releaseOnChain(task.id);
      const rec = await tx.wait();
      await syncOnChain(task.id, rec?.hash);
    }, "Released — tokens sent to worker");

  const runRefundOnChain = () =>
    runTx(async () => {
      const eth = getInjectedEip1193();
      if (!eth) throw new Error("No injected wallet.");
      await ensureHederaEvmChain(eth);
      const tx = await refundOnChain(task.id);
      const rec = await tx.wait();
      await syncOnChain(task.id, rec?.hash);
    }, "Refunded — tokens returned to client");

  const runSyncOnly = () => runTx(() => syncOnChain(task.id), "Synced with contract");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/tasks" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-mono">
        <ArrowLeft className="h-3 w-3" /> Back
      </Link>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-black text-foreground">Task #{task.id}</h1>
              <span
                className={`text-[8px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 border ${
                  humanVerifier ? "border-primary/40 bg-primary/10 text-primary" : "border-accent/40 bg-accent/10 text-accent"
                }`}
              >
                {VERIFIER_MODE_LABELS[task.verifierMode].short}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{task.description}</p>
            {task.capabilities.length > 0 && (
              <div className="flex gap-1 mt-2">
                {task.capabilities.map((cap) => (
                  <span key={cap} className="text-[8px] font-mono px-1.5 py-0.5 bg-secondary text-secondary-foreground uppercase">
                    {cap}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <Card>
        <CardContent className="flex justify-center py-4">
          <TaskStateMachine currentState={task.state} />
        </CardContent>
      </Card>

      {!["PaidOut", "Refunded", "Expired"].includes(task.state) && (
        <div className="grid grid-cols-3 gap-3">
          <Card className={dl.urgent ? "border-destructive/40" : ""}>
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Clock className={`h-3 w-3 ${dl.urgent ? "text-destructive" : "text-muted-foreground"}`} />
                <span className="text-[9px] font-mono text-muted-foreground uppercase">Deadline</span>
              </div>
              <p className={`text-sm font-bold font-mono ${dl.urgent ? "text-destructive" : "text-foreground"}`}>{dl.label}</p>
              <p className="text-[9px] text-muted-foreground font-mono mt-0.5">{formatTs(task.deadline)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="h-3 w-3 text-muted-foreground" />
                <span className="text-[9px] font-mono text-muted-foreground uppercase">Expiry</span>
              </div>
              <p className="text-sm font-bold font-mono text-foreground">{expiry.label}</p>
              <p className="text-[9px] text-muted-foreground font-mono mt-0.5">Policy note after deadline</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Shield className="h-3 w-3 text-muted-foreground" />
                <span className="text-[9px] font-mono text-muted-foreground uppercase">Budget Cap</span>
              </div>
              <p className="text-sm font-bold font-mono text-foreground">
                {task.maxBudget.toLocaleString()} <span className="text-[10px] text-muted-foreground">{getTokenSymbol(task.paymentToken)}</span>
              </p>
              <p className="text-[9px] text-muted-foreground font-mono mt-0.5">Max per job (UI)</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Participants</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            { role: "Client", addr: task.client, desc: "Creates the job and confirms funding" },
            { role: "Worker", addr: task.worker, desc: "Delivers work; receives payout on approve" },
            {
              role: "Verifier",
              addr: task.verifier,
              desc:
                task.verifierMode === "human"
                  ? "Approves or rejects via the app / API"
                  : "Autonomous agent approves when checks pass",
            },
          ].map((p) => (
            <div key={p.role} className="flex items-center justify-between py-1">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">{p.role}</span>
                <p className="text-[9px] text-muted-foreground">{p.desc}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs">{shortenAddress(p.addr)}</span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyAddr(p.addr)}>
                  <Copy className="h-2.5 w-2.5" />
                </Button>
                <a href={mirrorAccountUrl(p.addr)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-2.5 w-2.5 text-muted-foreground hover:text-foreground" />
                </a>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Payment</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[9px] text-muted-foreground uppercase font-mono">Escrowed (target)</p>
              <p className="font-mono text-lg font-black">
                {formatAmount(task.amount, task.paymentToken)}{" "}
                <span className="text-xs text-muted-foreground">{getTokenSymbol(task.paymentToken)}</span>
              </p>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground uppercase font-mono">Worker receives</p>
              <p className="font-mono text-lg font-black text-primary">{getTokenSymbol(task.workerPreferredToken)}</p>
              {!samePayoutToken && (
                <p className="text-[9px] text-amber-600 font-mono mt-1">
                  Live API requires the same payout token as escrow. Recreate or use mock mode for mixed-token demos.
                </p>
              )}
            </div>
          </div>
          {task.specURI && (
            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-[9px] text-muted-foreground uppercase font-mono">Spec URI</p>
              <p className="font-mono text-[10px] text-primary mt-1 break-all">{task.specURI}</p>
            </div>
          )}
          {task.outputURI && (
            <div className="mt-2">
              <p className="text-[9px] text-muted-foreground uppercase font-mono">Output URI</p>
              <p className="font-mono text-[10px] text-primary mt-1 break-all">{task.outputURI}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hedera transactions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!ESCROW_USE_MOCK && (
            <p className="text-[9px] text-muted-foreground font-mono leading-relaxed">
              Job create / fund / submit write <strong>HCS</strong> when <code className="text-foreground">HCS_TOPIC_ID</code> is set.
              {task.escrowContract ? (
                <>
                  {" "}
                  This task uses <strong>HederaTaskEscrow</strong>: escrow is on Hedera EVM; the verifier signs{" "}
                  <code className="text-foreground">release</code> / <code className="text-foreground">refund</code> from their EVM
                  wallet (chain id 296). <strong>Approve &amp; Pay</strong> only records approval — it does not move tokens until{" "}
                  <code className="text-foreground">release</code> + sync.
                </>
              ) : (
                <>
                  {" "}
                  <strong> Approve &amp; Pay</strong> runs a <strong>transfer</strong> (needs operator keys and{" "}
                  <code className="text-foreground">HEDERA_DRY_RUN=false</code>).
                </>
              )}{" "}
              Watch the API terminal for <code className="text-foreground">[ledger]</code> lines.
            </p>
          )}
          {(import.meta.env.VITE_HEDERA_OPERATOR_ID as string | undefined)?.trim() && task.state === "Open" && (
            <p className="text-[9px] font-mono text-muted-foreground">
              Operator (escrow) account:{" "}
              <a
                className="text-primary underline"
                href={mirrorAccountUrl((import.meta.env.VITE_HEDERA_OPERATOR_ID as string).trim())}
                target="_blank"
                rel="noopener noreferrer"
              >
                {(import.meta.env.VITE_HEDERA_OPERATOR_ID as string).trim()}
              </a>
            </p>
          )}
          {LEDGER_LABELS.filter(({ key }) => task.ledgerTx?.[key]).length === 0 ? (
            <p className="text-[10px] text-muted-foreground font-mono py-2">
              {ESCROW_USE_MOCK
                ? "Mock mode — no live Hedera transactions."
                : "No transaction ids stored yet. Configure server: HCS_TOPIC_ID, HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY, and turn off HEDERA_DRY_RUN."}
            </p>
          ) : (
            <ul className="space-y-2">
              {LEDGER_LABELS.map(({ key, label }) => {
                const txId = task.ledgerTx?.[key];
                if (!txId) return null;
                const isDry = txId.startsWith("dry-run");
                const href = isDry ? undefined : txId.startsWith("0x") ? hashscanEvmTxUrl(txId) : hashscanTransactionUrl(txId);
                return (
                  <li key={key} className="flex flex-col gap-0.5 border-b border-border/60 pb-2 last:border-0 last:pb-0">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
                    <span className="font-mono text-[10px] break-all text-foreground">{txId}</span>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-primary inline-flex items-center gap-1 w-fit"
                      >
                        Open in HashScan <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : (
                      <span className="text-[9px] text-amber-600 font-mono">Simulated id (not on chain)</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative pl-4">
            {[
              { label: "Job Created", ts: task.createdAt, icon: "●" },
              { label: "Escrow Funded", ts: task.fundedAt, icon: "●" },
              { label: "Work Submitted", ts: task.submittedAt, icon: "●" },
              {
                label: task.verifierMode === "human" ? "Verified (human verifier)" : "Verified (autonomous agent)",
                ts: task.verifiedAt,
                icon: "●",
              },
              { label: "Payout Completed", ts: task.completedAt, icon: "●" },
            ].map((e, idx, arr) => {
              const happened = e.ts > 0;
              return (
                <div key={e.label} className="relative pb-4 last:pb-0">
                  {idx < arr.length - 1 && (
                    <div className={`absolute left-0 top-3 w-px h-full ${happened ? "bg-primary/40" : "bg-border"}`} />
                  )}
                  <div className="flex items-start gap-3">
                    <div className={`relative z-10 h-2 w-2 mt-1 ${happened ? "bg-primary" : "bg-muted border border-border"}`} />
                    <div>
                      <p className={`text-xs font-medium ${happened ? "text-foreground" : "text-muted-foreground"}`}>{e.label}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{happened ? new Date(e.ts * 1000).toLocaleString() : "Pending"}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {taskAudit.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Shield className="h-3 w-3" /> Audit Trail (sample)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {taskAudit.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-[8px] font-mono px-1.5 py-0.5 uppercase bg-accent/15 text-accent">{e.network}</span>
                  <span className="text-[10px] text-foreground">{e.action}</span>
                </div>
                <span className="font-mono text-[9px] text-muted-foreground">{e.txHash}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!["PaidOut", "Refunded", "Expired"].includes(task.state) && (
        <Card className="border-primary/20">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Actions</CardTitle>
            {!authenticated && (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                Sign in with MetaMask or HashPack to act as the task client, worker, or verifier.
              </p>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-3 pt-0">
            {!authenticated && (
              <AuthRequiredCta description="Task actions are authorized against your signed-in Hedera account." />
            )}

            {evmClientWalletMismatch && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-[10px] leading-relaxed text-amber-700 dark:text-amber-400">
                <strong>Wrong EVM wallet.</strong> Browser wallet is {shortenAddress(browserEvm)} but this task&apos;s client is{" "}
                {shortenAddress(task.clientEvm)}. Switch MetaMask (or HashPack) to the <em>client</em> account; the contract pulls
                tokens from <code className="text-foreground">msg.sender</code>.{" "}
                <span className="opacity-90">(Carteira errada: use a conta do cliente que criou o job.)</span>
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {task.state === "Open" && (
                <>
                  {task.escrowContract && !ESCROW_USE_MOCK ? (
                    <Button
                      className="bg-primary text-primary-foreground font-bold text-xs uppercase tracking-wider"
                      disabled={!authenticated || !isClient || txPending || evmClientWalletMismatch}
                      onClick={runFundOnChain}
                    >
                      {txPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Approve token &amp; fund escrow (EVM)
                    </Button>
                  ) : (
                    <Button
                      className="bg-primary text-primary-foreground font-bold text-xs uppercase tracking-wider"
                      disabled={!authenticated || !isClient || txPending}
                      onClick={onFund}
                    >
                      {txPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      Mark funded
                    </Button>
                  )}
                </>
              )}
              {task.state === "Funded" && (
                <Button
                  className="bg-primary text-primary-foreground font-bold text-xs uppercase tracking-wider"
                  disabled={!authenticated || !isWorker || txPending}
                  onClick={onSubmit}
                >
                  {txPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Submit Work
                </Button>
              )}
              {task.state === "Submitted" && isVerifier && (
                <>
                  <Button
                    className="bg-[hsl(var(--state-verified))] text-primary-foreground font-bold text-xs uppercase tracking-wider"
                    disabled={!authenticated || txPending || (!ESCROW_USE_MOCK && !samePayoutToken)}
                    onClick={onApprovePay}
                  >
                    {txPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    {task.escrowContract && !ESCROW_USE_MOCK ? "Approve work (then on-chain release)" : "Approve & Pay"}
                  </Button>
                  <Button
                    variant="destructive"
                    className="font-bold text-xs uppercase tracking-wider"
                    disabled={!authenticated || txPending}
                    onClick={onReject}
                  >
                    {task.escrowContract && !ESCROW_USE_MOCK ? "Reject (then on-chain refund)" : "Reject"}
                  </Button>
                </>
              )}
              {task.state === "Verified" && task.escrowContract && task.escrowPendingAction === "release" && isVerifier && !ESCROW_USE_MOCK && (
                <Button
                  className="bg-[hsl(var(--state-paidout))] text-primary-foreground font-bold text-xs uppercase tracking-wider"
                  disabled={txPending}
                  onClick={runReleaseOnChain}
                >
                  {txPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Sign release (EVM) — pay worker
                </Button>
              )}
              {task.state === "EscrowRefundPending" && task.escrowContract && isVerifier && !ESCROW_USE_MOCK && (
                <Button
                  variant="destructive"
                  className="font-bold text-xs uppercase tracking-wider"
                  disabled={txPending}
                  onClick={runRefundOnChain}
                >
                  {txPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Sign refund (EVM) — return to client
                </Button>
              )}
              {task.escrowContract && !ESCROW_USE_MOCK && !["PaidOut", "Refunded", "Expired"].includes(task.state) && (
                <Button variant="outline" className="text-[10px] font-mono uppercase" disabled={txPending} onClick={runSyncOnly}>
                  Sync on-chain state
                </Button>
              )}
              {["Funded", "Submitted"].includes(task.state) && (isClient || isWorker) && (
                <Button
                  variant="outline"
                  className="border-[hsl(var(--state-disputed))] text-[hsl(var(--state-disputed))] font-bold text-xs uppercase tracking-wider"
                  disabled={!authenticated || txPending}
                  onClick={onDispute}
                >
                  Dispute
                </Button>
              )}
            </div>

            {task.state === "Open" && isClient && (
              <p className="text-[10px] text-muted-foreground font-mono border border-border bg-muted/20 px-3 py-2">
                {task.escrowContract && !ESCROW_USE_MOCK ? (
                  <>
                    Connect a wallet on <strong>Hedera Testnet EVM</strong> (chain 296) with the <strong>same keys as your 0.0.x</strong>{" "}
                    client account. The app sends <code className="text-foreground">associate()</code> on the HTS token if needed, then{" "}
                    <code className="text-foreground">approve</code> + <code className="text-foreground">fundTask</code>. You need a token
                    balance and HBAR for gas.
                  </>
                ) : (
                  <>
                    MVP: transfer HBAR or HTS to the operator account on HashScan, then press “Mark funded”. The server records state
                    and HCS logs when configured.
                  </>
                )}
              </p>
            )}

            {task.state === "Submitted" && authenticated && accountId && !isVerifier && (
              <p className="text-[10px] text-muted-foreground font-mono border border-border bg-muted/20 px-3 py-2">
                Only the verifier account ({shortenAddress(task.verifier)}) can approve or reject.
              </p>
            )}

            {task.state === "Submitted" && autonomousVerifier && (
              <div className="space-y-2 border border-accent/30 bg-accent/5 px-3 py-2">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Autonomous verifier at {shortenAddress(task.verifier)} should call{" "}
                  <span className="font-mono text-foreground">POST /tasks/{task.id}/verify</span> with{" "}
                  <span className="font-mono text-foreground">{`{ "approved": true }`}</span> when checks pass.
                </p>
                {ESCROW_USE_MOCK && (
                  <div className="flex flex-wrap gap-2 pt-1 border-t border-accent/20">
                    <span className="text-[9px] font-mono text-muted-foreground w-full uppercase tracking-wider">Mock — simulate agent</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[10px] h-8 border-accent/40"
                      disabled={txPending}
                      onClick={() => runTx(() => advanceState(task.id, "verify"), "Simulated approve")}
                    >
                      Agent: Approve & Pay
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[10px] h-8 border-destructive/40 text-destructive"
                      disabled={txPending}
                      onClick={onReject}
                    >
                      Agent: Reject
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
