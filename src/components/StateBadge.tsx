import { cn } from "@/lib/utils";
import type { TaskState } from "@/contracts/config";

const stateStyles: Record<TaskState, string> = {
  Open: "bg-[hsl(var(--state-open)/0.15)] text-[hsl(var(--state-open))] border-[hsl(var(--state-open)/0.3)]",
  Funded: "bg-[hsl(var(--state-funded)/0.15)] text-[hsl(var(--state-funded))] border-[hsl(var(--state-funded)/0.3)]",
  Submitted: "bg-[hsl(var(--state-submitted)/0.15)] text-[hsl(var(--state-submitted))] border-[hsl(var(--state-submitted)/0.3)]",
  Verified: "bg-[hsl(var(--state-verified)/0.15)] text-[hsl(var(--state-verified))] border-[hsl(var(--state-verified)/0.3)]",
  PaidOut: "bg-[hsl(var(--state-paidout)/0.15)] text-[hsl(var(--state-paidout))] border-[hsl(var(--state-paidout)/0.3)]",
  Refunded: "bg-[hsl(var(--state-refunded)/0.15)] text-[hsl(var(--state-refunded))] border-[hsl(var(--state-refunded)/0.3)]",
  Disputed: "bg-[hsl(var(--state-disputed)/0.15)] text-[hsl(var(--state-disputed))] border-[hsl(var(--state-disputed)/0.3)]",
};

export function StateBadge({ state, className }: { state: TaskState; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold font-mono",
        stateStyles[state],
        className
      )}
    >
      {state}
    </span>
  );
}
