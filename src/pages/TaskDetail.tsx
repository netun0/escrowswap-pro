import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TaskStateMachine } from "@/components/TaskStateMachine";
import { useEscrow } from "@/hooks/useEscrow";
import { shortenAddress, formatAmount, getTokenSymbol, timeUntil, MOCK_AUDIT_EVENTS } from "@/contracts/mockData";
import { ArrowLeft, ExternalLink, Copy, ArrowRightLeft, Clock, Shield, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { CHAIN_CONFIG } from "@/contracts/config";

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { tasks, advanceState } = useEscrow();
  const task = tasks.find((t) => t.id === Number(id));

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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/tasks" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-mono">
        <ArrowLeft className="h-3 w-3" /> Back
      </Link>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-xl font-black text-foreground">Task #{task.id}</h1>
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
            { role: "Verifier", addr: task.verifier, desc: "Evaluates output against spec" },
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
                    <ArrowRightLeft className="mr-1 h-2.5 w-2.5" /> via Uniswap
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
              { label: "Verified by Agent", ts: task.verifiedAt, icon: "●" },
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
          <CardContent className="flex gap-2 p-3">
            {task.state === "Open" && (
              <Button className="bg-primary text-primary-foreground font-bold text-xs uppercase tracking-wider" onClick={() => advanceState(task.id, "fund")}>
                Fund Escrow
              </Button>
            )}
            {task.state === "Funded" && (
              <Button className="bg-primary text-primary-foreground font-bold text-xs uppercase tracking-wider" onClick={() => advanceState(task.id, "submit")}>
                Submit Work
              </Button>
            )}
            {task.state === "Submitted" && (
              <>
                <Button className="bg-[hsl(var(--state-verified))] text-primary-foreground font-bold text-xs uppercase tracking-wider" onClick={() => advanceState(task.id, "verify")}>
                  Approve & Pay
                </Button>
                <Button variant="destructive" className="font-bold text-xs uppercase tracking-wider" onClick={() => advanceState(task.id, "reject")}>
                  Reject & Refund
                </Button>
              </>
            )}
            {["Funded", "Submitted"].includes(task.state) && (
              <Button variant="outline" className="border-[hsl(var(--state-disputed))] text-[hsl(var(--state-disputed))] font-bold text-xs uppercase tracking-wider" onClick={() => advanceState(task.id, "dispute")}>
                Dispute
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
