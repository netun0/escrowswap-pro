import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { parseUnits } from "ethers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TaskStateMachine } from "@/components/TaskStateMachine";
import { useEscrow, useWallet } from "@/hooks/useEscrow";
import { shortenAddress, formatAmount, getTokenSymbol, timeUntil, MOCK_AUDIT_EVENTS } from "@/contracts/mockData";
import { ArrowLeft, ExternalLink, Copy, ArrowRightLeft, Clock, Shield, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { CHAIN_CONFIG, TOKENS, VERIFIER_MODE_LABELS } from "@/contracts/config";
import { ESCROW_USE_MOCK, UNISWAPX_USE_MOCK_ORDER } from "@/contracts/env";

function addressesEqual(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function decimalsForTokenAddress(addr: string): number {
  const u = addr.toLowerCase();
  const hit = Object.values(TOKENS).find((t) => t.address.toLowerCase() === u);
  return hit?.decimals ?? 18;
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { tasks, advanceState, txPending } = useEscrow();
  const { address } = useWallet();
  const [crossMinOutHuman, setCrossMinOutHuman] = useState("");
  const task = tasks.find((t) => t.id === Number(id));

  useEffect(() => {
    if (!task) return;
    if (task.paymentToken.toLowerCase() === task.workerPreferredToken.toLowerCase()) return;
    const d = decimalsForTokenAddress(task.workerPreferredToken);
    setCrossMinOutHuman(d === 18 ? "0.001" : d === 6 ? "1" : "1");
  }, [task]);

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

  const formatTs = (ts: number) =>
    ts > 0 ? new Date(ts * 1000).toLocaleString() : "—";

  const needsSwap = task.paymentToken !== task.workerPreferredToken;
  const dl = timeUntil(task.deadline);
  const expiry = timeUntil(task.expiresAt);
  const taskAudit = MOCK_AUDIT_EVENTS.filter((e) => e.taskId === task.id);

  const isClient = addressesEqual(address, task.client);
  const isWorker = addressesEqual(address, task.worker);
  const isVerifier = addressesEqual(address, task.verifier);
  const humanVerifier = task.verifierMode === "human";
  const autonomousVerifier = task.verifierMode === "autonomous";

  const runTx = async (fn: () => Promise<void>, okTitle: string) => {
    try {
      await fn();
      toast({ title: okTitle });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Transaction failed", description: msg, variant: "destructive" });
    }
  };

  const onFund = () => runTx(() => advanceState(task.id, "fund"), "Escrow funded");
  const onSubmit = () => runTx(() => advanceState(task.id, "submit"), "Work submitted");
  const onDispute = () => runTx(() => advanceState(task.id, "dispute"), "Dispute opened");
  const onReject = () => runTx(() => advanceState(task.id, "reject"), "Refunded client");

  const onApprovePay = () =>
    runTx(async () => {
      if (!needsSwap || ESCROW_USE_MOCK) {
        await advanceState(task.id, "verify");
        return;
      }
      if (!UNISWAPX_USE_MOCK_ORDER) {
        throw new Error(
          "Cross-token on-chain verify needs a UniswapX SignedOrder. Enable VITE_UNISWAPX_USE_MOCK_ORDER=true for Hardhat mock reactor payloads, or integrate a cosigned Dutch order from the SDK/API."
        );
      }
      const dec = decimalsForTokenAddress(task.workerPreferredToken);
      const outWei = parseUnits(crossMinOutHuman.trim() || "0", dec);
      await advanceState(task.id, "verify", { uniswapXAmountOutWei: outWei });
    }, "Approved — payout executed");

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

      {/* State Machine */}
      <Card>
        <CardContent className="flex justify-center py-4">
          <TaskStateMachine currentState={task.state} />
        </CardContent>
      </Card>

      {/* Deadline & Safety */}
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
              <p className="text-[9px] text-muted-foreground font-mono mt-0.5">Funds reclaimable after</p>
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
              <p className="text-[9px] text-muted-foreground font-mono mt-0.5">Max per job</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Participants */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Agents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            { role: "Client", addr: task.client, desc: "Hired and funded this job" },
            { role: "Worker", addr: task.worker, desc: "Assigned to deliver the work" },
            {
              role: "Verifier",
              addr: task.verifier,
              desc:
                task.verifierMode === "human"
                  ? "Human-in-the-loop: signs approve or reject on-chain"
                  : "Autonomous agent wallet: signs verify when checks pass",
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
                <a href={`${CHAIN_CONFIG.blockExplorer}/address/${p.addr}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-2.5 w-2.5 text-muted-foreground hover:text-foreground" />
                </a>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Payment & Routing */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Payment & Routing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[9px] text-muted-foreground uppercase font-mono">Escrowed</p>
              <p className="font-mono text-lg font-black">
                {formatAmount(task.amount, task.paymentToken)}{" "}
                <span className="text-xs text-muted-foreground">{getTokenSymbol(task.paymentToken)}</span>
              </p>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground uppercase font-mono">Worker Receives</p>
              <p className="font-mono text-lg font-black text-primary">
                {getTokenSymbol(task.workerPreferredToken)}
                {needsSwap && (
                  <span className="ml-2 inline-flex items-center text-[10px] text-muted-foreground font-normal">
                    <ArrowRightLeft className="mr-1 h-2.5 w-2.5" /> via UniswapX FX
                  </span>
                )}
              </p>
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

      {/* Visual Timeline */}
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
                label:
                  task.verifierMode === "human"
                    ? "Verified (human verifier)"
                    : "Verified (autonomous agent)",
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

      {/* Audit Trail */}
      {taskAudit.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Shield className="h-3 w-3" /> Audit Trail
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {taskAudit.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`text-[8px] font-mono px-1.5 py-0.5 uppercase ${
                    e.network === "Hedera" ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary"
                  }`}>
                    {e.network}
                  </span>
                  <span className="text-[10px] text-foreground">{e.action}</span>
                </div>
                <span className="font-mono text-[9px] text-muted-foreground">{e.txHash}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {!["PaidOut", "Refunded", "Expired"].includes(task.state) && (
        <Card className="border-primary/20">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Actions</CardTitle>
            {!address && (
              <p className="text-[10px] text-muted-foreground font-mono mt-1">
                Connect a wallet to perform role-gated steps (client, worker, or verifier).
              </p>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-3 pt-0">
            <div className="flex flex-wrap gap-2">
              {task.state === "Open" && (
                <Button
                  className="bg-primary text-primary-foreground font-bold text-xs uppercase tracking-wider"
                  disabled={!isClient || txPending}
                  onClick={onFund}
                >
                  {txPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Fund Escrow
                </Button>
              )}
              {task.state === "Funded" && (
                <Button
                  className="bg-primary text-primary-foreground font-bold text-xs uppercase tracking-wider"
                  disabled={!isWorker || txPending}
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
                    disabled={txPending}
                    onClick={onApprovePay}
                  >
                    {txPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Approve & Pay
                  </Button>
                  <Button
                    variant="destructive"
                    className="font-bold text-xs uppercase tracking-wider"
                    disabled={txPending}
                    onClick={onReject}
                  >
                    Reject & Refund
                  </Button>
                </>
              )}
              {["Funded", "Submitted"].includes(task.state) && (isClient || isWorker) && (
                <Button
                  variant="outline"
                  className="border-[hsl(var(--state-disputed))] text-[hsl(var(--state-disputed))] font-bold text-xs uppercase tracking-wider"
                  disabled={txPending}
                  onClick={onDispute}
                >
                  Dispute
                </Button>
              )}
            </div>

            {!ESCROW_USE_MOCK && needsSwap && task.state === "Submitted" && isVerifier && (
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 space-y-2">
                <Label className="text-[10px] uppercase tracking-wider font-mono">
                  Stablecoin FX Settlement — min {getTokenSymbol(task.workerPreferredToken)} output
                </Label>
                <Input
                  className="font-mono text-xs h-8"
                  value={crossMinOutHuman}
                  onChange={(e) => setCrossMinOutHuman(e.target.value)}
                  disabled={txPending}
                />
                <p className="text-[9px] text-muted-foreground leading-relaxed font-mono">
                  UniswapX FX converts {getTokenSymbol(task.paymentToken)} → {getTokenSymbol(task.workerPreferredToken)} at settlement.
                  With VITE_UNISWAPX_USE_MOCK_ORDER=true the app uses a mock reactor order for the stablecoin FX swap.
                </p>
                {!UNISWAPX_USE_MOCK_ORDER && (
                  <p className="text-[9px] text-destructive font-mono">
                    Enable VITE_UNISWAPX_USE_MOCK_ORDER=true for mock stablecoin FX orders, or integrate V2 Dutch signing via
                    uniswapx-sdk for production FX settlement.
                  </p>
                )}
              </div>
            )}

            {task.state === "Submitted" && address && !isVerifier && (
              <p className="text-[10px] text-muted-foreground font-mono border border-border bg-muted/20 px-3 py-2">
                Only the designated verifier wallet ({shortenAddress(task.verifier)}) can approve or reject this submission.
              </p>
            )}

            {task.state === "Submitted" && autonomousVerifier && (
              <div className="space-y-2 border border-accent/30 bg-accent/5 px-3 py-2">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Verification is handled by the autonomous agent at {shortenAddress(task.verifier)}. When your off-chain service
                  decides the work meets the milestones, it should call <span className="font-mono text-foreground">verify</span>{" "}
                  from that wallet—no human approval in the UI.
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
                      Agent: Reject & Refund
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
