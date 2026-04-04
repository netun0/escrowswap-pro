import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  PlusCircle,
  ListTodo,
  Activity,
  Wallet,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useEscrow";
import { shortenAddress } from "@/contracts/mockData";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/create", label: "Create Task", icon: PlusCircle },
  { path: "/tasks", label: "My Tasks", icon: ListTodo },
  { path: "/agents", label: "Agent Monitor", icon: Activity },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { address, connecting, connect, disconnect } = useWallet();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-border bg-sidebar-background">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5">
          <div className="h-6 w-6 bg-primary flex items-center justify-center">
            <span className="text-[10px] font-black text-primary-foreground font-mono">E</span>
          </div>
          <div>
            <h1 className="text-xs font-bold text-foreground tracking-wide">ERC-8183</h1>
            <p className="text-[9px] text-muted-foreground font-mono">AGENT ESCROW</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary border-l-2 border-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground border-l-2 border-transparent"
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}

          <div className="border-t border-sidebar-border my-2 mx-1" />
          <Link
            to="/hackathon"
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors",
              location.pathname.startsWith("/hackathon")
                ? "bg-accent/10 text-accent border-l-2 border-accent"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground border-l-2 border-transparent"
            )}
          >
            <Trophy className="h-3.5 w-3.5" />
            Hackathon OS
          </Link>
        </nav>

        <div className="border-t border-sidebar-border p-3">
          {address ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 bg-primary" />
                <span className="font-mono text-[10px] text-sidebar-foreground">
                  {shortenAddress(address)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-[10px] h-7"
                onClick={disconnect}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="w-full bg-primary text-primary-foreground text-[10px] h-8 font-semibold"
              onClick={connect}
              disabled={connecting}
            >
              <Wallet className="mr-1.5 h-3 w-3" />
              {connecting ? "Connecting..." : "Connect Wallet"}
            </Button>
          )}
          <p className="mt-2 text-center text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
            Sepolia Testnet
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-56 flex-1 p-6">{children}</main>
    </div>
  );
}
