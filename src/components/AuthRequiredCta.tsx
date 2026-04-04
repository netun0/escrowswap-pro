import { Lock, Wallet } from "lucide-react";

import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";

export function AuthRequiredCta({
  description,
  title = "Authentication required",
}: {
  description: string;
  title?: string;
}) {
  const { authStatus, openAuthDialog } = useAuth();
  const busy = authStatus === "connecting" || authStatus === "awaiting_signature" || authStatus === "verifying";

  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
            <Lock className="h-3.5 w-3.5" />
            {title}
          </p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button size="sm" className="font-semibold" onClick={openAuthDialog} disabled={busy}>
          <Wallet className="mr-2 h-3.5 w-3.5" />
          Sign In With HashPack
        </Button>
      </div>
    </div>
  );
}
