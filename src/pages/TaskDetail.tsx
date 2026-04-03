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
        <p className="text-muted-foreground">Task not found</p>
        <Link to="/" className="mt-4 text-primary hover:underline text-sm">
          Back to dashboard
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
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/tasks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Back to tasks
      </Link>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold font-mono">Task #{task.id}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Created {formatTs(task.createdAt)}</p>
          </div>
          <StateBadge state={task.state} className="text-sm px-3 py-1" />
        </div>
      </motion.div>

      {/* State Machine */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-sm">Lifecycle</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center">
          <TaskStateMachine currentState={task.state} />
        </CardContent>
      </Card>

      {/* Participants */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-sm">Participants</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { role: "Client", addr: task.client },
            { role: "Worker", addr: task.worker },
            { role: "Verifier", addr: task.verifier },
          ].map((p) => (
            <div key={p.role} className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground uppercase tracking-wider w-20">{p.role}</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{shortenAddress(p.addr)}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyAddr(p.addr)}>
                  <Copy className="h-3 w-3" />
                </Button>
                <a
                  href={`${CHAIN_CONFIG.blockExplorer}/address/${p.addr}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </a>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Payment Info */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-sm">Payment & Payout Routing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Escrowed</p>
              <p className="font-mono text-lg font-bold">
                {formatAmount(task.amount, task.paymentToken)}{" "}
                <span className="text-xs text-muted-foreground">{getTokenSymbol(task.paymentToken)}</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">Worker Receives</p>
              <p className="font-mono text-lg font-bold text-primary">
                {getTokenSymbol(task.workerPreferredToken)}
                {needsSwap && (
                  <span className="ml-2 inline-flex items-center text-xs text-muted-foreground">
                    <ArrowRightLeft className="mr-1 h-3 w-3" /> via Uniswap
                  </span>
                )}
              </p>
            </div>
          </div>
          {task.specURI && (
            <div className="mt-4">
              <p className="text-[10px] text-muted-foreground uppercase">Spec URI</p>
              <p className="font-mono text-xs text-primary mt-1 break-all">{task.specURI}</p>
            </div>
          )}
          {task.outputURI && (
            <div className="mt-3">
              <p className="text-[10px] text-muted-foreground uppercase">Output URI</p>
              <p className="font-mono text-xs text-primary mt-1 break-all">{task.outputURI}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-sm">Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            { label: "Created", ts: task.createdAt },
            { label: "Funded", ts: task.fundedAt },
            { label: "Submitted", ts: task.submittedAt },
            { label: "Verified", ts: task.verifiedAt },
            { label: "Completed", ts: task.completedAt },
          ].map((e) => (
            <div key={e.label} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{e.label}</span>
              <span className="font-mono">{formatTs(e.ts)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Actions */}
      {!["PaidOut", "Refunded"].includes(task.state) && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex gap-3 p-4">
            {task.state === "Open" && (
              <Button className="gradient-primary text-primary-foreground" onClick={() => advanceState(task.id, "fund")}>
                Fund Escrow
              </Button>
            )}
            {task.state === "Funded" && (
              <Button className="gradient-primary text-primary-foreground" onClick={() => advanceState(task.id, "submit")}>
                Submit Work
              </Button>
            )}
            {task.state === "Submitted" && (
              <>
                <Button className="bg-[hsl(var(--state-verified))] text-primary-foreground" onClick={() => advanceState(task.id, "verify")}>
                  Approve & Pay
                </Button>
                <Button variant="destructive" onClick={() => advanceState(task.id, "reject")}>
                  Reject & Refund
                </Button>
              </>
            )}
            {["Funded", "Submitted"].includes(task.state) && (
              <Button variant="outline" className="border-[hsl(var(--state-disputed))] text-[hsl(var(--state-disputed))]" onClick={() => advanceState(task.id, "dispute")}>
                Dispute
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
