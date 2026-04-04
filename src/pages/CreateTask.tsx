import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEscrow } from "@/hooks/useEscrow";
import { TOKENS, VERIFIER_MODE_LABELS, type VerifierMode } from "@/contracts/config";
import { ESCROW_USE_MOCK, HEDERA_API_URL, ONCHAIN_ESCROW_ENABLED } from "@/contracts/env";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { AuthRequiredCta } from "@/components/AuthRequiredCta";

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDeadlineLocal(daysAhead = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return toDatetimeLocalValue(d);
}

const defaultEscrowSymbol = ONCHAIN_ESCROW_ENABLED ? "USDC" : "HBAR";

export default function CreateTask() {
  const navigate = useNavigate();
  const { createTask, txPending } = useEscrow();
  const { authenticated, openAuthDialog, user } = useAuth();
  const [loading, setLoading] = useState(false);

  const tokenChoices = ONCHAIN_ESCROW_ENABLED
    ? Object.values(TOKENS).filter((t) => t.address !== "HBAR")
    : Object.values(TOKENS);

  const [form, setForm] = useState({
    description: "",
    specURI: "",
    worker: "",
    verifier: "",
    verifierMode: "human" as VerifierMode,
    paymentToken: defaultEscrowSymbol,
    amount: "",
    workerPreferredToken: defaultEscrowSymbol,
    deadlineLocal: defaultDeadlineLocal(7),
  });

  useEffect(() => {
    if (!ONCHAIN_ESCROW_ENABLED) return;
    setForm((prev) => {
      if (prev.paymentToken !== "HBAR" && prev.workerPreferredToken !== "HBAR") return prev;
      return { ...prev, paymentToken: "USDC", workerPreferredToken: "USDC" };
    });
  }, []);

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authenticated || !user) {
      openAuthDialog();
      toast({ title: "Authentication required", description: "Sign in with HashPack before creating a task." });
      return;
    }

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

      if (ONCHAIN_ESCROW_ENABLED && (tokenMeta.address === "HBAR" || workerTokenMeta.address === "HBAR")) {
        throw new Error("On-chain escrow requires an HTS token (e.g. USDC). HBAR is not supported.");
      }

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
        clientAccountId: user.accountId,
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
          {ONCHAIN_ESCROW_ENABLED
            ? "Describe what you need · HTS ERC-20 locked in HederaTaskEscrow (verifier signs release/refund)"
            : "Describe what you need · assign agents · fund the operator escrow on Hedera"}
        </p>
      </div>

      {!authenticated && (
        <AuthRequiredCta description="Connect your HashPack wallet to identify the client account before creating a task." />
      )}

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-wider">What do you need?</CardTitle>
              <CardDescription className="text-xs">
                Describe the task in plain language.
                {ONCHAIN_ESCROW_ENABLED
                  ? " Escrow is on-chain (HTS ERC-20) via HederaTaskEscrow on testnet EVM."
                  : " Settlement is HBAR or HTS on Hedera Testnet via the demo operator."}
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
                {ONCHAIN_ESCROW_ENABLED ? (
                  <>
                    Escrow uses your configured HTS token with an EVM address. After create, fund via{" "}
                    <span className="font-mono text-foreground">approve</span> +{" "}
                    <span className="font-mono text-foreground">fundTask</span> on Hedera EVM (chain 296). Verifier signs{" "}
                    <span className="font-mono text-foreground">release</span> or <span className="font-mono text-foreground">refund</span>.
                  </>
                ) : (
                  <>
                  Amount is held by the operator account after you mark funded; verifier approval triggers HTS/HBAR transfer to
                  the worker.
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!ESCROW_USE_MOCK && !HEDERA_API_URL && (
                <p className="text-[10px] text-destructive font-mono">Set VITE_HEDERA_API_URL to create tasks against the server.</p>
              )}
              {!authenticated && (
                <p className="text-[10px] text-amber-600 font-mono">
                  Sign in with HashPack in the sidebar before creating a task.
                </p>
              )}
              {ONCHAIN_ESCROW_ENABLED && (
                <p className="text-[10px] text-muted-foreground font-mono border border-border/80 bg-muted/25 px-2 py-1.5 leading-relaxed">
                  HBAR is hidden: the server has <span className="text-foreground">ESCROW_CONTRACT_ADDRESS</span> set. Use an HTS token that exposes{" "}
                  <span className="text-foreground">evm_address</span> on the mirror (default USDC: {TOKENS.USDC.address}).
                </p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider">Escrow token</Label>
                  <Select
                    value={form.paymentToken}
                    onValueChange={(v) =>
                      setForm((prev) => ({
                        ...prev,
                        paymentToken: v,
                        workerPreferredToken: ONCHAIN_ESCROW_ENABLED ? v : prev.workerPreferredToken,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Token" />
                    </SelectTrigger>
                    <SelectContent>
                      {tokenChoices.map((t) => (
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
                {ONCHAIN_ESCROW_ENABLED ? (
                  <>
                    <p className="text-xs font-mono font-semibold text-foreground py-2 px-3 rounded-md border border-border bg-muted/20">
                      {form.paymentToken} <span className="text-muted-foreground font-normal">— same as escrow (required)</span>
                    </p>
                    <p className="text-[9px] text-muted-foreground font-mono">Contract escrow only supports a single ERC-20 per task.</p>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Button
            type="submit"
            className="mt-4 w-full bg-primary text-primary-foreground font-bold uppercase tracking-wider text-xs h-10"
            disabled={!authenticated || loading || txPending}
          >
            {loading || txPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {authenticated ? "Create Job" : "Sign In To Create"}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
