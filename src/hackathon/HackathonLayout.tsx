import { Link, useLocation } from "react-router-dom";
import { Bot, LayoutGrid, PlusCircle, Send, WalletCards } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/hackathon", label: "Hackathons", icon: LayoutGrid },
  { path: "/hackathon/create", label: "Create Hackathon", icon: PlusCircle },
  { path: "/hackathon/submit", label: "Submit Project", icon: Send },
  { path: "/hackathon/submissions", label: "Submissions", icon: WalletCards },
  { path: "/hackathon/agents", label: "Approval Queue", icon: Bot },
];

export function HackathonLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="flex min-h-screen">
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-border bg-sidebar-background">
        <div className="border-b border-sidebar-border px-5 py-4">
          <p className="text-[10px] font-mono uppercase tracking-[0.32em] text-accent">JudgeBuddy Treasury</p>
          <h1 className="mt-2 text-lg font-black text-foreground">Hackathon treasury ops</h1>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Hedera treasury, Ledger approvals, claim redemption, and audit trail.
          </p>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const active =
              item.path === "/hackathon"
                ? location.pathname === item.path
                : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active ? "bg-accent/10 text-accent" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="ml-64 flex-1 p-6">{children}</main>
    </div>
  );
}
