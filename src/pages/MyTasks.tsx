import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TaskStateMachine } from "@/components/TaskStateMachine";
import { useEscrow } from "@/hooks/useEscrow";
import { shortenAddress, formatAmount, getTokenSymbol, timeAgo, timeUntil } from "@/contracts/mockData";
import { TASK_STATES, type TaskState } from "@/contracts/config";
import { cn } from "@/lib/utils";
import { Clock, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/auth/useAuth";
import { AuthRequiredCta } from "@/components/AuthRequiredCta";

type RoleFilter = "mine" | "all" | "client" | "worker" | "verifier";

function sameAccount(a: string, b: string | null | undefined): boolean {
  if (!b) return false;
  return a.trim() === b.trim();
}

export default function MyTasks() {
  const { tasks } = useEscrow();
  const { authenticated, user } = useAuth();
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("mine");
  const [stateFilter, setStateFilter] = useState<TaskState | "all">("all");
  const [search, setSearch] = useState("");

  const userAddr = user?.accountId ?? null;

  const filtered = tasks.filter((t) => {
    const involved =
      sameAccount(t.client, userAddr) || sameAccount(t.worker, userAddr) || sameAccount(t.verifier, userAddr);
    if (roleFilter === "mine" && !involved) return false;
    if (roleFilter === "client" && !sameAccount(t.client, userAddr)) return false;
    if (roleFilter === "worker" && !sameAccount(t.worker, userAddr)) return false;
    if (roleFilter === "verifier" && !sameAccount(t.verifier, userAddr)) return false;
    if (stateFilter !== "all" && t.state !== stateFilter) return false;
    if (search && !t.description.toLowerCase().includes(search.toLowerCase()) && !t.capabilities.some(c => c.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">My Tasks</h1>
        <p className="mt-0.5 text-xs text-muted-foreground font-mono uppercase tracking-wider">
          {authenticated && userAddr
            ? `Default filter “Mine”: jobs where you are client, worker, or verifier · ${shortenAddress(userAddr)}`
            : "Sign in to personalize task filters and role badges."}
        </p>
      </div>

      {!authenticated && (
        <AuthRequiredCta description="Browse all tasks publicly, or sign in with your connected wallet to filter the list against your Hedera account." />
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search by description or capability…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 text-xs h-9 font-mono"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-0.5 border border-border p-0.5">
          {(["mine", "all", "client", "worker", "verifier"] as RoleFilter[]).map((r) => (
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
              {r === "mine" ? "Meus" : r === "all" ? "Todos" : r}
            </Button>
          ))}
        </div>
        <div className="flex gap-0.5 border border-border p-0.5 overflow-x-auto">
          <Button
            variant={stateFilter === "all" ? "default" : "ghost"}
            size="sm"
            className="text-[10px] uppercase tracking-wider font-bold h-7 px-2.5"
            onClick={() => setStateFilter("all")}
          >
            All States
          </Button>
          {TASK_STATES.map((s) => (
            <Button
              key={s}
              variant={stateFilter === s ? "default" : "ghost"}
              size="sm"
              className="text-[10px] uppercase tracking-wider h-7 px-2 whitespace-nowrap"
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
          <p className="py-10 text-center font-mono text-xs text-muted-foreground">
            {!authenticated && roleFilter !== "all"
              ? "Sign in to use personal role filters."
              : "No tasks match your filters"}
          </p>
        ) : (
          filtered.map((task, i) => {
            const dl = timeUntil(task.deadline);
            return (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Link to={`/task/${task.id}`}>
                  <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-black text-primary">#{task.id}</span>
                            <span className="text-xs font-semibold text-foreground truncate">
                              {task.description.length > 70 ? task.description.slice(0, 70) + "…" : task.description}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {formatAmount(task.amount, task.paymentToken)} {getTokenSymbol(task.paymentToken)}
                            </span>
                            {task.paymentToken !== task.workerPreferredToken && (
                              <span className="text-[10px] font-mono text-primary">→ {getTokenSymbol(task.workerPreferredToken)}</span>
                            )}
                            {dl.label !== "No deadline" && !["PaidOut", "Refunded"].includes(task.state) && (
                              <span className={`text-[9px] font-mono flex items-center gap-0.5 ${dl.urgent ? "text-destructive" : "text-muted-foreground"}`}>
                                <Clock className="h-2.5 w-2.5" />
                                {dl.label}
                              </span>
                            )}
                          </div>
                          {task.capabilities.length > 0 && (
                            <div className="flex gap-1 mt-1.5">
                              {task.capabilities.map((cap) => (
                                <span key={cap} className="text-[8px] font-mono px-1.5 py-0.5 bg-secondary text-secondary-foreground uppercase">
                                  {cap}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <div className="flex items-center gap-2">
                            {sameAccount(task.client, userAddr) && (
                              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-secondary text-secondary-foreground uppercase">Client</span>
                            )}
                            {sameAccount(task.worker, userAddr) && (
                              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-secondary text-secondary-foreground uppercase">Worker</span>
                            )}
                            {sameAccount(task.verifier, userAddr) && (
                              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-secondary text-secondary-foreground uppercase">Verifier</span>
                            )}
                          </div>
                          <TaskStateMachine currentState={task.state} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
