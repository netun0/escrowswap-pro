import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  PlusCircle,
  ListTodo,
  Activity,
  Wallet,
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
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-border bg-sidebar-background">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
          <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center">
            <span className="text-sm font-bold text-background">E</span>
          </div>
          <div>
            <h1 className="text-sm font-bold text-sidebar-foreground">ERC-8183</h1>
            <p className="text-[10px] text-muted-foreground font-mono">Agent Escrow</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-sidebar-accent text-primary glow-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          {address ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                <span className="font-mono text-xs text-sidebar-foreground">
                  {shortenAddress(address)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={disconnect}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="w-full gradient-primary text-primary-foreground"
              onClick={connect}
              disabled={connecting}
            >
              <Wallet className="mr-2 h-4 w-4" />
              {connecting ? "Connecting..." : "Connect Wallet"}
            </Button>
          )}
          <p className="mt-3 text-center text-[10px] font-mono text-muted-foreground">
            Sepolia Testnet
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-64 flex-1 p-8">{children}</main>
    </div>
  );
}
