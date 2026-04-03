import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { TaskStateMachine } from "@/components/TaskStateMachine";
import { useEscrow, useX402 } from "@/hooks/useEscrow";
import { shortenAddress, formatAmount, getTokenSymbol, timeAgo, timeUntil, MOCK_AUDIT_EVENTS } from "@/contracts/mockData";
import { ArrowRight, Clock, Shield, Zap } from "lucide-react";
import { TOKENS } from "@/contracts/config";

export default function Dashboard() {
  const { tasks } = useEscrow();
  const { payments } = useX402();

  const activeTasks = tasks.filter((t) => !["PaidOut", "Refunded", "Expired"].includes(t.state));
  const completedTasks = tasks.filter((t) => t.state === "PaidOut");
  const urgentTasks = activeTasks.filter((t) => {
    const dl = timeUntil(t.deadline);
    return dl.urgent && t.state !== "Verified";
  });

  // Aggregate locked value per token
  const escrowedByToken: Record<string, { symbol: string; total: number; color: string }> = {};
  activeTasks.forEach((t) => {
    const sym = getTokenSymbol(t.paymentToken);
    const token = Object.values(TOKENS).find(
      (tk) => tk.address.toLowerCase() === t.paymentToken.toLowerCase()
    );
    if (!token) return;
    if (!escrowedByToken[sym]) {
      escrowedByToken[sym] = { symbol: sym, total: 0, color: token.logoColor };
    }
    escrowedByToken[sym].total += Number(t.amount) / 10 ** token.decimals;
  });

  const recentAudit = MOCK_AUDIT_EVENTS.slice(-4).reverse();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-foreground">
          Agent Escrow
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground font-mono uppercase tracking-wider">
          ERC-8183 · Sepolia · Uniswap V3 Routing
        </p>
      </div>

      {/* Stats — equal quadrants (same width columns + equal card height per row) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-3 items-stretch">
        <motion.div
          className="min-h-0 min-w-0 h-full"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="h-full flex flex-col">
            <CardContent className="p-4 flex flex-col flex-1 min-h-0">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest shrink-0">Active Jobs</span>
              <div className="mt-1 flex flex-1 flex-col justify-center gap-0.5 min-h-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-3xl font-black font-mono text-accent leading-none">{activeTasks.length}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">of {tasks.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          className="min-h-0 min-w-0 h-full"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <Card className="h-full flex flex-col">
            <CardContent className="p-4 flex flex-col flex-1 min-h-0">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest shrink-0">Locked Value</span>
              <div className="mt-1 flex-1 flex flex-col justify-center gap-1 min-h-0">
                {Object.values(escrowedByToken).length > 0 ? (
                  Object.values(escrowedByToken).map((e) => (
                    <div key={e.symbol} className="flex items-baseline gap-1.5 min-w-0">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
                      <span className="text-lg font-black font-mono text-foreground leading-none tabular-nums truncate">
                        {e.total.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">{e.symbol}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-lg font-black font-mono text-muted-foreground leading-none">—</span>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          className="min-h-0 min-w-0 h-full"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="h-full flex flex-col">
            <CardContent className="p-4 flex flex-col flex-1 min-h-0">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest shrink-0">Completed</span>
              <div className="mt-1 flex flex-1 flex-col justify-center gap-0.5 min-h-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-3xl font-black font-mono text-primary leading-none">{completedTasks.length}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">paid out</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          className="min-h-0 min-w-0 h-full"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <Card className={`h-full flex flex-col ${urgentTasks.length > 0 ? "border-destructive/40" : ""}`}>
            <CardContent className="p-4 flex flex-col flex-1 min-h-0">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest shrink-0">Urgent</span>
              <div className="mt-1 flex flex-1 flex-col justify-center gap-0.5 min-h-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span
                    className={`text-3xl font-black font-mono leading-none ${
                      urgentTasks.length > 0 ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {urgentTasks.length}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">near deadline</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Job Feed */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Recent Jobs</span>
          <Link to="/tasks" className="text-[10px] text-primary hover:underline flex items-center gap-1 font-mono">
            View all <ArrowRight className="h-2.5 w-2.5" />
          </Link>
        </div>
        <div className="space-y-1.5">
          {tasks.slice(0, 5).map((task, i) => {
            const dl = timeUntil(task.deadline);
            return (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Link to={`/task/${task.id}`}>
                  <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-muted-foreground">#{task.id}</span>
                            <span className="text-xs font-semibold text-foreground truncate">
                              {task.description.length > 80 ? task.description.slice(0, 80) + "…" : task.description}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {formatAmount(task.amount, task.paymentToken)} {getTokenSymbol(task.paymentToken)}
                            </span>
                            {task.paymentToken !== task.workerPreferredToken && (
                              <span className="text-[10px] font-mono text-primary">
                                → {getTokenSymbol(task.workerPreferredToken)}
                              </span>
                            )}
                            <span className="text-[9px] text-muted-foreground font-mono">
                              {timeAgo(task.createdAt)}
                            </span>
                            {dl.label !== "No deadline" && !["PaidOut", "Refunded"].includes(task.state) && (
                              <span className={`text-[9px] font-mono flex items-center gap-0.5 ${dl.urgent ? "text-destructive" : "text-muted-foreground"}`}>
                                <Clock className="h-2.5 w-2.5" />
                                {dl.label}
                              </span>
                            )}
                          </div>
                          {task.capabilities.length > 0 && (
                            <div className="flex gap-1 mt-1.5">
                              {task.capabilities.slice(0, 3).map((cap) => (
                                <span key={cap} className="text-[8px] font-mono px-1.5 py-0.5 bg-secondary text-secondary-foreground uppercase">
                                  {cap}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <TaskStateMachine currentState={task.state} />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Two-column: x402 + Audit */}
      <div className="grid grid-cols-2 gap-3">
        {/* x402 Micropayments */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Zap className="h-3 w-3 text-accent" />
            <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">x402 Micropayments</span>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {payments.map((p) => (
                  <div key={p.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px]">
                        {formatAmount(p.amount, p.token)} {getTokenSymbol(p.token)}
                      </span>
                      <span className={`text-[9px] font-mono font-bold ${p.settled ? "text-primary" : "text-accent"}`}>
                        {p.settled ? "SETTLED" : "PENDING"}
                      </span>
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-0.5 truncate">{p.purpose}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Audit Trail */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Shield className="h-3 w-3 text-primary" />
            <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Audit Trail</span>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {recentAudit.map((e) => (
                  <div key={e.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-foreground">{e.action}</span>
                      <span className={`text-[8px] font-mono px-1.5 py-0.5 uppercase ${
                        e.network === "Hedera" ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary"
                      }`}>
                        {e.network}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] font-mono text-muted-foreground">Task #{e.taskId}</span>
                      <span className="text-[9px] text-muted-foreground">{timeAgo(e.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
