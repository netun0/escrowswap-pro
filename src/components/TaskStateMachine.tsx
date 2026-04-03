import { motion } from "framer-motion";
import { TASK_STATES, type TaskState } from "@/contracts/config";
import { cn } from "@/lib/utils";

const stateColors: Record<TaskState, string> = {
  Open: "bg-[hsl(var(--state-open))]",
  Funded: "bg-[hsl(var(--state-funded))]",
  Submitted: "bg-[hsl(var(--state-submitted))]",
  Verified: "bg-[hsl(var(--state-verified))]",
  PaidOut: "bg-[hsl(var(--state-paidout))]",
  Refunded: "bg-[hsl(var(--state-refunded))]",
  Disputed: "bg-[hsl(var(--state-disputed))]",
};

// The main flow (excluding terminal/error states for the pipeline)
const flowStates: TaskState[] = ["Open", "Funded", "Submitted", "Verified", "PaidOut"];

export function TaskStateMachine({ currentState }: { currentState: TaskState }) {
  const currentIdx = flowStates.indexOf(currentState);
  const isTerminal = currentState === "Refunded" || currentState === "Disputed";

  return (
    <div className="flex items-center gap-1">
      {flowStates.map((state, idx) => {
        const isActive = state === currentState;
        const isPast = !isTerminal && currentIdx >= 0 && idx < currentIdx;
        const isFuture = !isTerminal && currentIdx >= 0 && idx > currentIdx;

        return (
          <div key={state} className="flex items-center gap-1">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: idx * 0.05 }}
              className="flex flex-col items-center"
            >
              <div
                className={cn(
                  "h-3 w-3 rounded-full border-2 transition-all",
                  isActive && `${stateColors[state]} border-transparent shadow-lg`,
                  isPast && "bg-primary/50 border-primary/30",
                  isFuture && "bg-muted border-border",
                  isTerminal && state === currentState && `${stateColors[state]} border-transparent`
                )}
              />
              <span
                className={cn(
                  "mt-1 text-[9px] font-mono",
                  isActive ? "text-foreground font-semibold" : "text-muted-foreground"
                )}
              >
                {state}
              </span>
            </motion.div>
            {idx < flowStates.length - 1 && (
              <div
                className={cn(
                  "h-0.5 w-6 -mt-3 rounded",
                  isPast ? "bg-primary/50" : "bg-border"
                )}
              />
            )}
          </div>
        );
      })}
      {isTerminal && (
        <>
          <div className="h-0.5 w-6 -mt-3 rounded bg-destructive/30" />
          <div className="flex flex-col items-center">
            <div className={cn("h-3 w-3 rounded-full", stateColors[currentState])} />
            <span className="mt-1 text-[9px] font-mono font-semibold text-foreground">
              {currentState}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
