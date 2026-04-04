import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEscrow, useWallet } from "@/hooks/useEscrow";
import { TOKENS, VERIFIER_MODE_LABELS, type VerifierMode } from "@/contracts/config";
import { ESCROW_USE_MOCK, HEDERA_API_URL } from "@/contracts/env";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDeadlineLocal(daysAhead = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return toDatetimeLocalValue(d);
}

export default function CreateTask() {
  const navigate = useNavigate();
  const { createTask, txPending } = useEscrow();
  const { address: clientId } = useWallet();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    description: "",
    specURI: "",
    worker: "",
    verifier: "",
    verifierMode: "human" as VerifierMode,
    paymentToken: "HBAR",
    amount: "",
    workerPreferredToken: "HBAR",
    deadlineLocal: defaultDeadlineLocal(7),
  });

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const tokenMeta = Object.values(TOKENS).find((t) => t.symbol === form.paymentToken);
      const workerTokenMeta = Object.values(TOKENS).find((t) => t.symbol === form.workerPreferredToken);
      if (!tokenMeta || !workerTokenMeta) throw new Error("Invalid token");

      const amountWei = BigInt(Math.floor(parseFloat(form.amount) * 10 ** tokenMeta.decimals)).toString();
      const deadlineMs = new Date(form.deadlineLocal).getTime();
      if (Number.isNaN(deadlineMs)) throw new Error("Invalid deadline date and time");
      const deadlineUnix = deadlineMs / 1000;
      const nowSec = Date.now() / 1000;
      if (deadlineUnix <= nowSec) throw new Error("Deadline must be in the future");

      if (!ESCROW_USE_MOCK && tokenMeta.address !== workerTokenMeta.address) {
        throw new Error(
          "The API settles in the escrow token only. Choose the same token for worker payout (HBAR/HBAR or same HTS id).",
        );
      }

      const taskId = await createTask({
        specURI: form.specURI || form.description,
        description: form.description,
        worker: form.worker,
        verifier: form.verifier,
        verifierMode: form.verifierMode,
        paymentToken: tokenMeta.address,
        amount: amountWei,
        workerPreferredToken: workerTokenMeta.address,
        deadlineUnix,
        clientId: clientId ?? undefined,
      });
      toast({ title: "Job Created", description: `Task #${taskId} is now open for funding` });
      navigate(`/task/${taskId}`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Create a Job</h1>
        <p className="mt-0.5 text-xs text-muted-foreground font-mono uppercase tracking-wider">
          Describe what you need · assign agents · fund the operator escrow on Hedera
        </p>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-wider">What do you need?</CardTitle>
              <CardDescription className="text-xs">
                Describe the task in plain language. Settlement is HBAR or HTS on Hedera Testnet via the demo operator.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="description" className="text-[10px] uppercase tracking-wider">
                  Task Description
                </Label>
                <Textarea
                  id="description"
                  placeholder="e.g. Summarize these 5 documents into a risk report with severity ratings…"
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  className="text-sm min-h-[80px]"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="specURI" className="text-[10px] uppercase tracking-wider">
                  Spec URI <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="specURI"
                  placeholder="ipfs://Qm... or https://..."
                  value={form.specURI}
                  onChange={(e) => updateField("specURI", e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="mt-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-wider">Assign Agents</CardTitle>
              <CardDescription className="text-xs">Hedera account ids (0.0.x) for worker and verifier.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="worker" className="text-[10px] uppercase tracking-wider">
                  Worker
                </Label>
                <Input
                  id="worker"
                  placeholder="0.0.…"
                  value={form.worker}
                  onChange={(e) => updateField("worker", e.target.value)}
                  className="font-mono text-xs"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="verifier" className="text-[10px] uppercase tracking-wider">
                  {form.verifierMode === "human" ? "Verifier account" : "Verifier account (agent-controlled)"}
                </Label>
                <Input
                  id="verifier"
                  placeholder="0.0.…"
                  value={form.verifier}
                  onChange={(e) => updateField("verifier", e.target.value)}
                  className="font-mono text-xs"
                  required
                />
                <p className="text-[9px] text-muted-foreground leading-relaxed">
                  {form.verifierMode === "human"
                    ? "A person or service that approves or rejects payout after reviewing the deliverable."
                    : "Your autonomous service calls the API verifier step from this account context when checks pass."}
                </p>
              </div>

              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                <Label className="text-[10px] uppercase tracking-wider">Verification</Label>
                <RadioGroup
                  value={form.verifierMode}
                  onValueChange={(v) => updateField("verifierMode", v as VerifierMode)}
                  className="grid gap-3"
                >
                  <label className="flex cursor-pointer gap-3 rounded-md border border-transparent p-2 hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                    <RadioGroupItem value="human" id="vm-human" className="mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="text-xs font-semibold">{VERIFIER_MODE_LABELS.human.title}</span>
                      <p className="text-[9px] text-muted-foreground leading-relaxed">
                        A delegate explicitly approves payout through the UI or API.
                      </p>
                    </div>
                  </label>
                  <label className="flex cursor-pointer gap-3 rounded-md border border-transparent p-2 hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                    <RadioGroupItem value="autonomous" id="vm-auto" className="mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="text-xs font-semibold">{VERIFIER_MODE_LABELS.autonomous.title}</span>
                      <p className="text-[9px] text-muted-foreground leading-relaxed">
                        An agent triggers verification automatically when milestones are satisfied.
                      </p>
                    </div>
                  </label>
                </RadioGroup>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-wider">Budget & Deadline</CardTitle>
              <CardDescription className="text-xs">
                Amount is held by the operator account after you mark funded; verifier approval triggers HTS/HBAR transfer to
                the worker.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!ESCROW_USE_MOCK && !HEDERA_API_URL && (
                <p className="text-[10px] text-destructive font-mono">Set VITE_HEDERA_API_URL to create tasks against the server.</p>
              )}
              {!ESCROW_USE_MOCK && !clientId && (
                <p className="text-[10px] text-amber-600 font-mono">
                  Connect your Hedera client id in the sidebar — it is sent as `clientId` when creating the task.
                </p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider">Escrow token</Label>
                  <Select value={form.paymentToken} onValueChange={(v) => updateField("paymentToken", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Token" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(TOKENS).map((t) => (
                        <SelectItem key={t.symbol} value={t.symbol}>
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.logoColor }} />
                            {t.symbol}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="amount" className="text-[10px] uppercase tracking-wider">
                    Budget
                  </Label>
                  <Input
                    id="amount"
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => updateField("amount", e.target.value)}
                    className="font-mono"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="deadline" className="text-[10px] uppercase tracking-wider">
                  Submission deadline
                </Label>
                <Input
                  id="deadline"
                  type="datetime-local"
                  value={form.deadlineLocal}
                  onChange={(e) => updateField("deadlineLocal", e.target.value)}
                  className="font-mono text-xs bg-background"
                  required
                />
                <p className="text-[9px] text-muted-foreground font-mono">Local date and time.</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider">Worker payout token</Label>
                <Select value={form.workerPreferredToken} onValueChange={(v) => updateField("workerPreferredToken", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Same as escrow" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(TOKENS).map((t) => (
                      <SelectItem key={`p-${t.symbol}`} value={t.symbol}>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.logoColor }} />
                          {t.symbol}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[9px] text-muted-foreground font-mono">
                  Must match escrow token for live API settlement (HBAR→HBAR or identical HTS id).
                </p>
              </div>
            </CardContent>
          </Card>

          <Button
            type="submit"
            className="mt-4 w-full bg-primary text-primary-foreground font-bold uppercase tracking-wider text-xs h-10"
            disabled={loading || txPending}
          >
            {loading || txPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create Job
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
