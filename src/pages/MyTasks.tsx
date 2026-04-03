import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StateBadge } from "@/components/StateBadge";
import { useEscrow } from "@/hooks/useEscrow";
import { shortenAddress, formatAmount, getTokenSymbol } from "@/contracts/mockData";
import { TASK_STATES, type TaskState } from "@/contracts/config";
import { cn } from "@/lib/utils";

type RoleFilter = "all" | "client" | "worker" | "verifier";

export default function MyTasks() {
  const { tasks } = useEscrow();
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [stateFilter, setStateFilter] = useState<TaskState | "all">("all");

  // In mock mode, user is always addresses[0]
  const userAddr = "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38".toLowerCase();

  const filtered = tasks.filter((t) => {
    if (roleFilter === "client" && t.client.toLowerCase() !== userAddr) return false;
    if (roleFilter === "worker" && t.worker.toLowerCase() !== userAddr) return false;
    if (roleFilter === "verifier" && t.verifier.toLowerCase() !== userAddr) return false;
    if (stateFilter !== "all" && t.state !== stateFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="gradient-text">My</span> Tasks
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Filter tasks by your role and status
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {(["all", "client", "worker", "verifier"] as RoleFilter[]).map((r) => (
            <Button
              key={r}
              variant={roleFilter === r ? "default" : "ghost"}
              size="sm"
              className={cn("text-xs capitalize", roleFilter === r && "gradient-primary text-primary-foreground")}
              onClick={() => setRoleFilter(r)}
            >
              {r === "all" ? "All Roles" : `As ${r}`}
            </Button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-1">
          <Button
            variant={stateFilter === "all" ? "default" : "ghost"}
            size="sm"
            className="text-xs"
            onClick={() => setStateFilter("all")}
          >
            All States
          </Button>
          {TASK_STATES.map((s) => (
            <Button
              key={s}
              variant={stateFilter === s ? "default" : "ghost"}
              size="sm"
              className="text-xs"
              onClick={() => setStateFilter(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-10">No tasks match filters</p>
        ) : (
          filtered.map((task, i) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Link to={`/task/${task.id}`}>
                <Card className="border-border/50 bg-card/50 backdrop-blur hover:border-primary/30 transition-all cursor-pointer">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-sm font-bold text-primary">#{task.id}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{shortenAddress(task.client)}</span>
                          <span className="text-muted-foreground text-xs">→</span>
                          <span className="font-mono text-xs">{shortenAddress(task.worker)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">
                          {formatAmount(task.amount, task.paymentToken)} {getTokenSymbol(task.paymentToken)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {task.client.toLowerCase() === userAddr && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">CLIENT</span>
                      )}
                      {task.worker.toLowerCase() === userAddr && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">WORKER</span>
                      )}
                      {task.verifier.toLowerCase() === userAddr && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">VERIFIER</span>
                      )}
                      <StateBadge state={task.state} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
