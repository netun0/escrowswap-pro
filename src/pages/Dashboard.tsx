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
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="gradient-text">Agent Escrow</span> Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground font-mono">
          ERC-8183 · Sepolia Testnet · Uniswap V3 Payout Routing
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Active Tasks", value: stats.active, icon: Clock, color: "text-[hsl(var(--state-funded))]" },
          { label: "Completed", value: stats.completed, icon: CheckCircle2, color: "text-[hsl(var(--state-paidout))]" },
          { label: "Total Escrowed", value: `${(stats.totalEscrowed / 1e6).toFixed(0)}`, icon: TrendingUp, color: "text-primary" },
          { label: "Disputed", value: stats.disputed, icon: AlertTriangle, color: "text-[hsl(var(--state-disputed))]" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="border-border/50 bg-card/50 backdrop-blur">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {stat.label}
                </CardTitle>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold font-mono ${stat.color}`}>{stat.value}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Recent Tasks */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent Tasks</h2>
          <Link to="/tasks" className="text-xs text-primary hover:underline flex items-center gap-1">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="space-y-3">
          {tasks.slice(0, 5).map((task, i) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Link to={`/task/${task.id}`}>
                <Card className="border-border/50 bg-card/50 backdrop-blur hover:border-primary/30 transition-all cursor-pointer">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-xs text-muted-foreground">#{task.id}</span>
                      <div>
                        <p className="text-sm font-medium">
                          {shortenAddress(task.client)} → {shortenAddress(task.worker)}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">
                          {formatAmount(task.amount, task.paymentToken)} {getTokenSymbol(task.paymentToken)}
                          {task.paymentToken !== task.workerPreferredToken && (
                            <span className="text-primary"> → {getTokenSymbol(task.workerPreferredToken)}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <TaskStateMachine currentState={task.state} />
                      <StateBadge state={task.state} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {/* x402 Recent Payments */}
      <div>
        <h2 className="text-lg font-semibold mb-4">x402 Micropayments</h2>
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${p.settled ? "bg-primary" : "bg-[hsl(var(--state-funded))]"}`} />
                    <span className="font-mono text-xs">
                      {shortenAddress(p.payer)} → {shortenAddress(p.provider)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatAmount(p.amount, p.token)} {getTokenSymbol(p.token)}
                    </span>
                    <span className={`text-[10px] font-mono ${p.settled ? "text-primary" : "text-[hsl(var(--state-funded))]"}`}>
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
