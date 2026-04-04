import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useEscrow, useX402 } from "@/hooks/useEscrow";
import { formatAmount, getTokenSymbol } from "@/contracts/mockData";
import { ESCROW_USE_MOCK } from "@/contracts/env";
import { buildAgentActivityRows, buildLedgerAuditRows } from "@/lib/agentMonitorFromTasks";
import { hashscanTransactionUrl } from "@/contracts/config";
import { Shield, Zap, Activity, ExternalLink } from "lucide-react";

export default function AgentMonitor() {
  const { tasks, loading } = useEscrow();
  const { payments } = useX402();

  const agentActivity = buildAgentActivityRows(tasks);
  const ledgerRows = buildLedgerAuditRows(tasks);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Agent Monitor</h1>
        <p className="mt-0.5 text-xs text-muted-foreground font-mono uppercase tracking-wider">
          Derived from escrow tasks {loading ? "(loading…)" : `(${tasks.length} job${tasks.length === 1 ? "" : "s"})`} · on-chain ids from{" "}
          <span className="text-foreground">ledgerTx</span>
        </p>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Activity className="h-3 w-3" /> Participants (last milestone)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {agentActivity.length === 0 ? (
              <p className="text-[10px] text-muted-foreground font-mono py-6 text-center">
                No client / worker / verifier accounts yet. Create a job to populate this table.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] uppercase tracking-wider">Account</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Role</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Last event</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">When</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentActivity.map((a) => (
                    <TableRow key={a.account}>
                      <TableCell>
                        <span className="font-mono text-[10px]" title={a.account}>
                          {a.agentShort}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-secondary text-secondary-foreground uppercase">
                          {a.role}
                        </span>
                      </TableCell>
                      <TableCell className="text-[10px] max-w-[260px]">{a.lastAction}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground font-mono">{a.time}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <div
                            className={`h-1.5 w-1.5 rounded-full ${a.status === "active" ? "bg-primary" : "bg-muted-foreground"}`}
                          />
                          <span className="text-[9px] font-mono font-bold uppercase">{a.status}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid grid-cols-2 gap-3">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-accent" /> x402 Micropayments
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!ESCROW_USE_MOCK ? (
                <p className="text-[10px] text-muted-foreground font-mono leading-relaxed py-2">
                  No x402 pipeline is wired to the Hedera API yet — micropayments stay empty in live mode. Escrow milestones above are the
                  real signal.
                </p>
              ) : payments.length === 0 ? (
                <p className="text-[10px] text-muted-foreground font-mono py-2">No mock payments.</p>
              ) : (
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
                          <span
                            className={`text-[9px] font-mono font-black uppercase ${p.settled ? "text-primary" : "text-accent"}`}
                          >
                            {p.settled ? "Settled" : "Pending"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Shield className="h-3 w-3 text-primary" /> Hedera ledger (from tasks)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ledgerRows.length === 0 ? (
                <p className="text-[10px] text-muted-foreground font-mono leading-relaxed py-2">
                  No <code className="text-foreground">ledgerTx</code> entries yet. After you configure{" "}
                  <code className="text-foreground">HCS_TOPIC_ID</code> and run the API without dry-run, create/fund/submit/approve will
                  store transaction ids here.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] uppercase tracking-wider">Event</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Tx</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Task</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledgerRows.map((e) => {
                      const dry = e.txId.startsWith("dry-run");
                      const href = dry ? null : hashscanTransactionUrl(e.txId);
                      return (
                        <TableRow key={e.id}>
                          <TableCell className="text-[10px] max-w-[140px]">{e.action}</TableCell>
                          <TableCell>
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[9px] font-mono text-primary inline-flex items-center gap-0.5 max-w-[180px] truncate"
                                title={e.txId}
                              >
                                {e.txId.length > 28 ? `${e.txId.slice(0, 18)}…` : e.txId}
                                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                              </a>
                            ) : (
                              <span className="text-[9px] font-mono text-amber-600/90 truncate max-w-[180px] block" title={e.txId}>
                                {e.txId}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-[10px] font-mono text-muted-foreground">#{e.taskId}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
