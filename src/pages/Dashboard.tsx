import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StateBadge } from "@/components/StateBadge";
import { TaskStateMachine } from "@/components/TaskStateMachine";
import { useEscrow, useX402 } from "@/hooks/useEscrow";
import { shortenAddress, formatAmount, getTokenSymbol } from "@/contracts/mockData";
import { ArrowRight, TrendingUp, Clock, CheckCircle2, AlertTriangle } from "lucide-react";

export default function Dashboard() {
  const { tasks } = useEscrow();
  const { payments } = useX402();

  const stats = {
    active: tasks.filter((t) => !["PaidOut", "Refunded"].includes(t.state)).length,
    completed: tasks.filter((t) => t.state === "PaidOut").length,
    totalEscrowed: tasks
      .filter((t) => !["PaidOut", "Refunded"].includes(t.state))
      .reduce((acc, t) => acc + Number(t.amount), 0),
    disputed: tasks.filter((t) => t.state === "Disputed").length,
  };

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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Active", value: stats.active, icon: Clock, color: "text-accent" },
          { label: "Completed", value: stats.completed, icon: CheckCircle2, color: "text-primary" },
          { label: "Escrowed", value: `${(stats.totalEscrowed / 1e6).toFixed(0)}`, icon: TrendingUp, color: "text-foreground" },
          { label: "Disputed", value: stats.disputed, icon: AlertTriangle, color: "text-destructive" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                    {stat.label}
                  </span>
                  <stat.icon className={`h-3.5 w-3.5 ${stat.color}`} />
                </div>
                <div className={`text-2xl font-black font-mono ${stat.color}`}>{stat.value}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Recent Tasks */}
      <div>
        <div className="flex items-center justify-end mb-3">
          <Link to="/tasks" className="text-[10px] text-primary hover:underline flex items-center gap-1 font-mono">
            View all <ArrowRight className="h-2.5 w-2.5" />
          </Link>
        </div>
        <div className="space-y-2">
          {tasks.slice(0, 5).map((task, i) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Link to={`/task/${task.id}`}>
                <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                  <CardContent className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-muted-foreground">#{task.id}</span>
                      <div>
                        <p className="text-xs font-medium font-mono">
                          {shortenAddress(task.client)} → {shortenAddress(task.worker)}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          {formatAmount(task.amount, task.paymentToken)} {getTokenSymbol(task.paymentToken)}
                          {task.paymentToken !== task.workerPreferredToken && (
                            <span className="text-primary"> → {getTokenSymbol(task.workerPreferredToken)}</span>
                          )}
                        </p>
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

      {/* x402 Recent Payments */}
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider mb-3">x402 Micropayments</h2>
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className={`h-1.5 w-1.5 ${p.settled ? "bg-primary" : "bg-accent"}`} />
                    <span className="font-mono text-[10px]">
                      {shortenAddress(p.payer)} → {shortenAddress(p.provider)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatAmount(p.amount, p.token)} {getTokenSymbol(p.token)}
                    </span>
                    <span className={`text-[10px] font-mono font-bold ${p.settled ? "text-primary" : "text-accent"}`}>
                      {p.settled ? "SETTLED" : "PENDING"}
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
