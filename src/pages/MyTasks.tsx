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
        <h1 className="text-2xl font-black tracking-tight">My Tasks</h1>
        <p className="mt-0.5 text-xs text-muted-foreground font-mono uppercase tracking-wider">
          Filter by role and status
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-0.5 border border-border p-0.5">
          {(["all", "client", "worker", "verifier"] as RoleFilter[]).map((r) => (
            <Button
              key={r}
              variant={roleFilter === r ? "default" : "ghost"}
              size="sm"
              className={cn(
                "text-[10px] uppercase tracking-wider font-bold h-7 px-2.5",
                roleFilter === r && "bg-primary text-primary-foreground"
              )}
              onClick={() => setRoleFilter(r)}
            >
              {r === "all" ? "All" : r}
            </Button>
          ))}
        </div>
        <div className="flex gap-0.5 border border-border p-0.5">
          <Button
            variant={stateFilter === "all" ? "default" : "ghost"}
            size="sm"
            className="text-[10px] uppercase tracking-wider font-bold h-7 px-2.5"
            onClick={() => setStateFilter("all")}
          >
            All
          </Button>
          {TASK_STATES.map((s) => (
            <Button
              key={s}
              variant={stateFilter === s ? "default" : "ghost"}
              size="sm"
              className="text-[10px] uppercase tracking-wider h-7 px-2"
              onClick={() => setStateFilter(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-10 font-mono">No tasks match filters</p>
        ) : (
          filtered.map((task, i) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Link to={`/task/${task.id}`}>
                <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                  <CardContent className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-black text-primary">#{task.id}</span>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px]">{shortenAddress(task.client)}</span>
                          <span className="text-muted-foreground text-[10px]">→</span>
                          <span className="font-mono text-[10px]">{shortenAddress(task.worker)}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          {formatAmount(task.amount, task.paymentToken)} {getTokenSymbol(task.paymentToken)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {task.client.toLowerCase() === userAddr && (
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-secondary text-secondary-foreground uppercase">CLIENT</span>
                      )}
                      {task.worker.toLowerCase() === userAddr && (
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-secondary text-secondary-foreground uppercase">WORKER</span>
                      )}
                      {task.verifier.toLowerCase() === userAddr && (
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-secondary text-secondary-foreground uppercase">VERIFIER</span>
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
