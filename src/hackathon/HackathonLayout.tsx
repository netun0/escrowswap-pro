import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Trophy, LayoutGrid, FileSearch, Bot, ArrowLeft, PlusCircle, Send } from "lucide-react";
import { HackathonSubmissionsProvider } from "@/hackathon/HackathonSubmissionsContext";
import { HackathonListProvider } from "@/hackathon/HackathonListContext";

const navItems = [
  { path: "/hackathon", label: "Hackathons", icon: LayoutGrid },
  { path: "/hackathon/submit", label: "Submit project", icon: Send },
  { path: "/hackathon/create", label: "Create Event", icon: PlusCircle },
  { path: "/hackathon/submissions", label: "Submissions", icon: FileSearch },
  { path: "/hackathon/agents", label: "Agent Pipeline", icon: Bot },
];

export function HackathonLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <HackathonSubmissionsProvider>
    <HackathonListProvider>
    <div className="flex min-h-screen">
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-border bg-sidebar-background">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5">
          <div className="h-6 w-6 bg-accent flex items-center justify-center">
            <Trophy className="h-3.5 w-3.5 text-accent-foreground" />
          </div>
          <div>
            <h1 className="text-xs font-bold text-foreground tracking-wide">JudgeBuddy</h1>
            <p className="text-[9px] text-muted-foreground font-mono">Less painful hackathons</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {navItems.map((item) => {
            const isActive =
              item.path === "/hackathon"
                ? location.pathname === "/hackathon"
                : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-accent/10 text-accent border-l-2 border-accent"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground border-l-2 border-transparent"
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <Link
            to="/"
            className="flex items-center gap-2 px-3 py-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to Escrow Dashboard
          </Link>
          <p className="mt-2 text-center text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
            Powered by Hedera
          </p>
        </div>
      </aside>

      <main className="ml-56 flex-1 p-6">{children}</main>
    </div>
    </HackathonListProvider>
    </HackathonSubmissionsProvider>
  );
}
