import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StateBadge } from "@/components/StateBadge";
import { TaskStateMachine } from "@/components/TaskStateMachine";
import { useEscrow } from "@/hooks/useEscrow";
import { shortenAddress, formatAmount, getTokenSymbol } from "@/contracts/mockData";
import { ArrowLeft, ExternalLink, Copy, ArrowRightLeft } from "lucide-react";
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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/tasks" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-mono">
        <ArrowLeft className="h-3 w-3" /> Back
      </Link>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black font-mono">Task #{task.id}</h1>
            <p className="mt-0.5 text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
              Created {formatTs(task.createdAt)}
            </p>
          </div>
          <StateBadge state={task.state} className="text-xs px-2.5 py-1" />
        </div>
      </motion.div>

      {/* State Machine */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lifecycle</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-4">
          <TaskStateMachine currentState={task.state} />
        </CardContent>
      </Card>

      {/* Participants */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Participants</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            { role: "Client", addr: task.client },
            { role: "Worker", addr: task.worker },
            { role: "Verifier", addr: task.verifier },
          ].map((p) => (
            <div key={p.role} className="flex items-center justify-between py-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono w-16">{p.role}</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs">{shortenAddress(p.addr)}</span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyAddr(p.addr)}>
                  <Copy className="h-2.5 w-2.5" />
                </Button>
                <a
                  href={`${CHAIN_CONFIG.blockExplorer}/address/${p.addr}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-2.5 w-2.5 text-muted-foreground hover:text-foreground" />
                </a>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Payment Info */}
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

      {/* Timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {[
            { label: "Created", ts: task.createdAt },
            { label: "Funded", ts: task.fundedAt },
            { label: "Submitted", ts: task.submittedAt },
            { label: "Verified", ts: task.verifiedAt },
            { label: "Completed", ts: task.completedAt },
          ].map((e) => (
            <div key={e.label} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-mono text-[10px] uppercase">{e.label}</span>
              <span className="font-mono text-[10px]">{formatTs(e.ts)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Actions */}
      {!["PaidOut", "Refunded"].includes(task.state) && (
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
