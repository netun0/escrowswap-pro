import { motion } from "framer-motion";
import type { TaskState } from "@/contracts/config";
import { cn } from "@/lib/utils";

const stateColors: Record<TaskState, string> = {
  Open: "bg-[hsl(var(--state-open))]",
  Funded: "bg-[hsl(var(--state-funded))]",
  Submitted: "bg-[hsl(var(--state-submitted))]",
  Verified: "bg-[hsl(var(--state-verified))]",
  PaidOut: "bg-[hsl(var(--state-paidout))]",
  Refunded: "bg-[hsl(var(--state-refunded))]",
  EscrowRefundPending: "bg-[hsl(var(--state-escrow-refund))]",
  Disputed: "bg-[hsl(var(--state-disputed))]",
  Expired: "bg-[hsl(var(--state-refunded))]",
};

const flowStates: TaskState[] = ["Open", "Funded", "Submitted", "Verified", "PaidOut"];

export function TaskStateMachine({ currentState }: { currentState: TaskState }) {
  if (currentState === "EscrowRefundPending") {
    const prefix: TaskState[] = ["Open", "Funded", "Submitted"];
    const currentIdx = 3;
    return (
      <div className="flex items-center gap-1 flex-wrap justify-center">
        {prefix.map((state, idx) => {
          const isPast = idx < currentIdx;
          return (
            <div key={state} className="flex items-center gap-1">
              <div className="flex flex-col items-center">
                <div
                  className={`h-3 w-3 transition-all ${isPast ? "bg-primary/40" : "bg-muted-foreground/20"}`}
                  style={{ clipPath: "polygon(0 0, 100% 50%, 0 100%)" }}
                />
                <span className="mt-1 text-[8px] font-mono uppercase tracking-wider text-muted-foreground">{state}</span>
              </div>
              {idx < prefix.length - 1 && <div className="h-px w-5 -mt-3 bg-primary/40" />}
            </div>
          );
        })}
        <div className="h-px w-5 -mt-3 bg-destructive/30" />
        <div className="flex flex-col items-center">
          <div
            className={`h-3 w-3 ${stateColors.EscrowRefundPending}`}
            style={{ clipPath: "polygon(0 0, 100% 50%, 0 100%)" }}
          />
          <span className="mt-1 text-[8px] font-mono font-bold text-foreground uppercase tracking-wider">
            EscrowRefund…
          </span>
        </div>
        <div className="h-px w-5 -mt-3 bg-border" />
        <div className="flex flex-col items-center opacity-50">
          <div className="h-3 w-3 bg-muted-foreground/20" style={{ clipPath: "polygon(0 0, 100% 50%, 0 100%)" }} />
          <span className="mt-1 text-[8px] font-mono uppercase tracking-wider text-muted-foreground">Refunded</span>
        </div>
      </div>
    );
  }

  const currentIdx = flowStates.indexOf(currentState);
  const isTerminal = currentState === "Refunded" || currentState === "Disputed" || currentState === "Expired";

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
                  "h-3 w-3 transition-all",
                  isActive && `${stateColors[state]}`,
                  isPast && "bg-primary/40",
                  isFuture && "bg-muted-foreground/20",
                  isTerminal && state === currentState && stateColors[state]
                )}
                style={{ clipPath: "polygon(0 0, 100% 50%, 0 100%)" }}
              />
              <span
                className={cn(
                  "mt-1 text-[8px] font-mono uppercase tracking-wider",
                  isActive ? "text-foreground font-bold" : "text-muted-foreground"
                )}
              >
                {state}
              </span>
            </motion.div>
            {idx < flowStates.length - 1 && (
              <div
                className={cn(
                  "h-px w-5 -mt-3",
                  isPast ? "bg-primary/40" : "bg-border"
                )}
              />
            )}
          </div>
        );
      })}
      {isTerminal && (
        <>
          <div className="h-px w-5 -mt-3 bg-destructive/30" />
          <div className="flex flex-col items-center">
            <div
              className={cn("h-3 w-3", stateColors[currentState])}
              style={{ clipPath: "polygon(0 0, 100% 50%, 0 100%)" }}
            />
            <span className="mt-1 text-[8px] font-mono font-bold text-foreground uppercase tracking-wider">
              {currentState}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
