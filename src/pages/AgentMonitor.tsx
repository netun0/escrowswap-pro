import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useX402 } from "@/hooks/useEscrow";
import { shortenAddress, formatAmount, getTokenSymbol } from "@/contracts/mockData";

export default function AgentMonitor() {
  const { payments } = useX402();

  const agentActivity = [
    { agent: "0x742d35Cc...f2bD38", role: "Client", lastAction: "Created Task #3", time: "2 min ago", status: "active" },
    { agent: "0x8626f694...C1199", role: "Worker", lastAction: "Submitted work on #1", time: "1 hr ago", status: "active" },
    { agent: "0xdD2FD458...39D574", role: "Verifier", lastAction: "Verified Task #2", time: "6 hrs ago", status: "idle" },
    { agent: "0xbDA5747b...B197E", role: "Worker", lastAction: "Awaiting assignment", time: "12 hrs ago", status: "idle" },
    { agent: "0x2546BcD3...EC30", role: "Verifier", lastAction: "Auto-verified #4", time: "1 hr ago", status: "active" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="gradient-text">Agent</span> Monitor
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live agent activity and x402 micropayment history
        </p>
      </div>

      {/* Agent Status */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-sm">Active Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Agent</TableHead>
                  <TableHead className="text-xs">Role</TableHead>
                  <TableHead className="text-xs">Last Action</TableHead>
                  <TableHead className="text-xs">Time</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentActivity.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{a.agent}</TableCell>
                    <TableCell>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase">
                        {a.role}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{a.lastAction}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.time}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <div className={`h-1.5 w-1.5 rounded-full ${a.status === "active" ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />
                        <span className="text-[10px] font-mono">{a.status}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.div>

      {/* x402 Payment Log */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-sm">x402 Micropayment Log</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">ID</TableHead>
                  <TableHead className="text-xs">Payer → Provider</TableHead>
                  <TableHead className="text-xs">Amount</TableHead>
                  <TableHead className="text-xs">Call Hash</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs text-primary">#{p.id}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {shortenAddress(p.payer)} → {shortenAddress(p.provider)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatAmount(p.amount, p.token)} {getTokenSymbol(p.token)}
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground max-w-[120px] truncate">
                      {p.callHash}
                    </TableCell>
                    <TableCell>
                      <span className={`text-[10px] font-mono font-semibold ${p.settled ? "text-primary" : "text-[hsl(var(--state-funded))]"}`}>
                        {p.settled ? "SETTLED" : "PENDING"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
