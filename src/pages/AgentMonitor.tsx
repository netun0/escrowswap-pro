import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useX402 } from "@/hooks/useEscrow";
import { shortenAddress, formatAmount, getTokenSymbol, timeAgo, MOCK_AUDIT_EVENTS } from "@/contracts/mockData";
import { Shield, Zap, Activity } from "lucide-react";

export default function AgentMonitor() {
  const { payments } = useX402();

  const agentActivity = [
    { agent: "0x742d35Cc...bD38", role: "Client", lastAction: "Created job: smart contract audit", time: "2m ago", status: "active" },
    { agent: "0x8626f694...1199", role: "Worker", lastAction: "Submitted deliverable on Task #1", time: "1h ago", status: "active" },
    { agent: "0xdD2FD458...44C0", role: "Verifier", lastAction: "Auto-verified Task #2 (tests passed)", time: "6h ago", status: "idle" },
    { agent: "0xbDA5747b...97E", role: "Worker", lastAction: "Scanning open jobs matching: NLP, python", time: "12h ago", status: "idle" },
    { agent: "0x2546BcD3...C30", role: "Verifier", lastAction: "Running Slither checks on Task #4", time: "1h ago", status: "active" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Agent Monitor</h1>
        <p className="mt-0.5 text-xs text-muted-foreground font-mono uppercase tracking-wider">
          Live agent activity · x402 log · audit trail
        </p>
      </div>

      {/* Agent Status */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Activity className="h-3 w-3" /> Active Agents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] uppercase tracking-wider">Agent</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Role</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Last Action</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">When</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentActivity.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-[10px]">{a.agent}</TableCell>
                    <TableCell>
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-secondary text-secondary-foreground uppercase">
                        {a.role}
                      </span>
                    </TableCell>
                    <TableCell className="text-[10px] max-w-[200px] truncate">{a.lastAction}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground font-mono">{a.time}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <div className={`h-1.5 w-1.5 rounded-full ${a.status === "active" ? "bg-primary" : "bg-muted-foreground"}`} />
                        <span className="text-[9px] font-mono font-bold uppercase">{a.status}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid grid-cols-2 gap-3">
        {/* x402 Payment Log */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-accent" /> x402 Micropayments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] uppercase tracking-wider">Purpose</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Amount</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-[10px] max-w-[180px] truncate">{p.purpose}</TableCell>
                      <TableCell className="font-mono text-[10px]">
                        {formatAmount(p.amount, p.token)} {getTokenSymbol(p.token)}
                      </TableCell>
                      <TableCell>
                        <span className={`text-[9px] font-mono font-black uppercase ${p.settled ? "text-primary" : "text-accent"}`}>
                          {p.settled ? "Settled" : "Pending"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </motion.div>

        {/* Audit Trail */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Shield className="h-3 w-3 text-primary" /> Hedera Audit Trail
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] uppercase tracking-wider">Event</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Network</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MOCK_AUDIT_EVENTS.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <div>
                          <span className="text-[10px] text-foreground">{e.action}</span>
                          <p className="text-[9px] text-muted-foreground font-mono">Task #{e.taskId}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`text-[8px] font-mono px-1.5 py-0.5 uppercase ${
                          e.network === "Hedera" ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary"
                        }`}>
                          {e.network}
                        </span>
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground font-mono">{timeAgo(e.timestamp)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
