import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { TaskStateMachine } from "@/components/TaskStateMachine";
import { useEscrow, useX402 } from "@/hooks/useEscrow";
import { shortenAddress, formatAmount, getTokenSymbol } from "@/contracts/mockData";
import { ArrowRight } from "lucide-react";
import { TOKENS } from "@/contracts/config";

function formatUSD(wei: number, tokenAddr: string): string {
  // Convert raw amounts to human-readable with token decimals
  for (const token of Object.values(TOKENS)) {
    if (token.address.toLowerCase() === tokenAddr.toLowerCase()) {
      return (wei / 10 ** token.decimals).toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
    }
  }
  return "0";
}

function timeAgo(ts: number): string {
  if (ts <= 0) return "—";
  const diff = Date.now() / 1000 - ts;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function Dashboard() {
  const { tasks } = useEscrow();
  const { payments } = useX402();

  const activeTasks = tasks.filter((t) => !["PaidOut", "Refunded"].includes(t.state));
  const completedTasks = tasks.filter((t) => t.state === "PaidOut");

  // Calculate total escrowed per token for human display
  const escrowedByToken: Record<string, { symbol: string; total: number; decimals: number }> = {};
  activeTasks.forEach((t) => {
    const sym = getTokenSymbol(t.paymentToken);
    const token = Object.values(TOKENS).find(
      (tk) => tk.address.toLowerCase() === t.paymentToken.toLowerCase()
    );
    if (!token) return;
    if (!escrowedByToken[sym]) {
      escrowedByToken[sym] = { symbol: sym, total: 0, decimals: token.decimals };
    }
    escrowedByToken[sym].total += Number(t.amount) / 10 ** token.decimals;
  });

  const escrowEntries = Object.values(escrowedByToken);

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

      {/* Overview strip */}
      <div className="grid grid-cols-3 gap-3">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardContent className="p-4">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">In progress</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-black font-mono text-accent">{activeTasks.length}</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  / {tasks.length} total
                </span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card>
            <CardContent className="p-4">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Locked value</span>
              <div className="mt-1 space-y-0.5">
                {escrowEntries.length > 0 ? (
                  escrowEntries.map((e) => (
                    <div key={e.symbol} className="flex items-baseline gap-1.5">
                      <span className="text-lg font-black font-mono text-foreground">
                        {e.total.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">{e.symbol}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-lg font-black font-mono text-muted-foreground">—</span>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardContent className="p-4">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Completed</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-black font-mono text-primary">{completedTasks.length}</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  paid out
                </span>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Task feed */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Latest activity</span>
          <Link to="/tasks" className="text-[10px] text-primary hover:underline flex items-center gap-1 font-mono">
            All tasks <ArrowRight className="h-2.5 w-2.5" />
          </Link>
        </div>
        <div className="space-y-1.5">
          {tasks.slice(0, 5).map((task, i) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Link to={`/task/${task.id}`}>
                <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                  <CardContent className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[10px] text-muted-foreground w-5">#{task.id}</span>
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-mono">
                          <span>{shortenAddress(task.client)}</span>
                          <span className="text-muted-foreground">→</span>
                          <span>{shortenAddress(task.worker)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
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
                        </div>
                      </div>
                    </div>
                    <TaskStateMachine currentState={task.state} />
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {/* x402 feed */}
      <div>
        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">x402 payments</span>
        <Card className="mt-2">
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className={`h-1.5 w-1.5 ${p.settled ? "bg-primary" : "bg-accent"}`} />
                    <span className="font-mono text-[10px]">
                      {shortenAddress(p.payer)} → {shortenAddress(p.provider)}
                    </span>
                    <span className="text-[9px] text-muted-foreground font-mono">
                      {timeAgo(p.timestamp)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] text-foreground">
                      {formatAmount(p.amount, p.token)} {getTokenSymbol(p.token)}
                    </span>
                    <span className={`text-[9px] font-mono font-bold ${p.settled ? "text-primary" : "text-accent"}`}>
                      {p.settled ? "DONE" : "PENDING"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
