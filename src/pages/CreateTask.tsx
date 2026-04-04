import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEscrow, useUniswapQuote, type CrossChainQuote } from "@/hooks/useEscrow";
import { TOKENS, SOURCE_TOKENS, VERIFIER_MODE_LABELS, type VerifierMode } from "@/contracts/config";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/hooks/use-toast";
import { ArrowRightLeft, Loader2 } from "lucide-react";

export default function CreateTask() {
  const navigate = useNavigate();
  const { createTask, txPending } = useEscrow();
  const { getQuote } = useUniswapQuote();
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<CrossChainQuote | null>(null);

  const [form, setForm] = useState({
    description: "",
    specURI: "",
    worker: "",
    verifier: "",
    verifierMode: "human" as VerifierMode,
    sourceToken: "",
    paymentToken: "",
    amount: "",
    workerPreferredToken: "",
    deadlineDays: "7",
  });

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const selectedSource = form.sourceToken ? SOURCE_TOKENS[form.sourceToken] : null;
  const isCrossChain = !!selectedSource;

  const fetchQuote = async () => {
    const inSymbol = isCrossChain ? selectedSource!.symbol : form.paymentToken;
    if (inSymbol && form.paymentToken && form.amount) {
      const q = await getQuote(
        inSymbol,
        form.paymentToken,
        form.amount,
        selectedSource?.chain,
        selectedSource?.bridgeMethod,
      );
      setQuote(q);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const tokenMeta = Object.values(TOKENS).find((t) => t.symbol === form.paymentToken);
      const workerTokenMeta = Object.values(TOKENS).find((t) => t.symbol === form.workerPreferredToken);
      if (!tokenMeta || !workerTokenMeta) throw new Error("Invalid token");

      const amountWei = BigInt(Math.floor(parseFloat(form.amount) * 10 ** tokenMeta.decimals)).toString();
      const taskId = await createTask({
        specURI: form.specURI || form.description,
        description: form.description,
        worker: form.worker,
        verifier: form.verifier,
        verifierMode: form.verifierMode,
        paymentToken: tokenMeta.address,
        amount: amountWei,
        workerPreferredToken: workerTokenMeta.address,
        deadlineDays: parseInt(form.deadlineDays, 10) || 7,
      });
      toast({ title: "Job Created", description: `Task #${taskId} is now open for funding` });
      navigate(`/task/${taskId}`);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Create a Job</h1>
        <p className="mt-0.5 text-xs text-muted-foreground font-mono uppercase tracking-wider">
          Describe what you need · assign agents · set budget
        </p>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-wider">What do you need?</CardTitle>
              <CardDescription className="text-xs">Describe the task in plain language. Your agent will handle the rest.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="description" className="text-[10px] uppercase tracking-wider">Task Description</Label>
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
                <Label htmlFor="specURI" className="text-[10px] uppercase tracking-wider">Spec URI <span className="text-muted-foreground">(optional)</span></Label>
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
              <CardDescription className="text-xs">Which agents should work on and verify this job?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="worker" className="text-[10px] uppercase tracking-wider">Worker Agent</Label>
                <Input
                  id="worker"
                  placeholder="0x..."
                  value={form.worker}
                  onChange={(e) => updateField("worker", e.target.value)}
                  className="font-mono text-xs"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="verifier" className="text-[10px] uppercase tracking-wider">
                  {form.verifierMode === "human" ? "Verifier wallet" : "Verifier wallet (agent)"}
                </Label>
                <Input
                  id="verifier"
                  placeholder="0x..."
                  value={form.verifier}
                  onChange={(e) => updateField("verifier", e.target.value)}
                  className="font-mono text-xs"
                  required
                />
                <p className="text-[9px] text-muted-foreground leading-relaxed">
                  {form.verifierMode === "human"
                    ? "A person or multisig that will sign approve or reject after reviewing the deliverable."
                    : "The autonomous service signs verify transactions from this address once milestones and checks pass."}
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
                        You or a delegate controls this address and explicitly approves payout.
                      </p>
                    </div>
                  </label>
                  <label className="flex cursor-pointer gap-3 rounded-md border border-transparent p-2 hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                    <RadioGroupItem value="autonomous" id="vm-auto" className="mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="text-xs font-semibold">{VERIFIER_MODE_LABELS.autonomous.title}</span>
                      <p className="text-[9px] text-muted-foreground leading-relaxed">
                        An AI agent (or bot) monitors the job and calls the contract when criteria are met—no human click required.
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
              <CardDescription className="text-xs">Set your source token, escrow budget, payout preference, and deadline</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider">Source Token (your chain)</Label>
                <Select value={form.sourceToken} onValueChange={(v) => updateField("sourceToken", v)}>
                  <SelectTrigger><SelectValue placeholder="Select origin token…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="flex items-center gap-2 text-muted-foreground">Already on Arc — no bridge needed</span>
                    </SelectItem>
                    {Object.entries(SOURCE_TOKENS).map(([key, t]) => (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.logoColor }} />
                          {t.symbol} <span className="text-muted-foreground">on {t.chain}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isCrossChain && (
                  <p className="text-[9px] text-muted-foreground font-mono">
                    Funds will be swapped via {selectedSource!.bridgeMethod} from {selectedSource!.chain} to Arc Testnet
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider">Escrow Token (Arc)</Label>
                  <Select value={form.paymentToken} onValueChange={(v) => updateField("paymentToken", v)}>
                    <SelectTrigger><SelectValue placeholder="Token" /></SelectTrigger>
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
                  <Label htmlFor="amount" className="text-[10px] uppercase tracking-wider">Budget</Label>
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
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider">Deadline</Label>
                  <Select value={form.deadlineDays} onValueChange={(v) => updateField("deadlineDays", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">24 hours</SelectItem>
                      <SelectItem value="3">3 days</SelectItem>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="14">14 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider">Worker Payout Token</Label>
                  <Select value={form.workerPreferredToken} onValueChange={(v) => updateField("workerPreferredToken", v)}>
                    <SelectTrigger><SelectValue placeholder="Payout token" /></SelectTrigger>
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
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="mt-5"
                  onClick={fetchQuote}
                  disabled={!form.paymentToken || !form.amount}
                >
                  <ArrowRightLeft className="h-4 w-4" />
                </Button>
              </div>

              {quote && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="border border-primary/30 bg-primary/5 p-3 space-y-2"
                >
                  <p className="text-[10px] font-bold text-primary uppercase tracking-wider">
                    UniswapX Route Check
                  </p>
                  {isCrossChain && (
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {form.amount} {selectedSource!.symbol} on {selectedSource!.chain} {"->"} {form.paymentToken} on Arc
                    </p>
                  )}
                  <div className="grid grid-cols-4 gap-2 text-xs font-mono text-muted-foreground">
                    <div>
                      <span className="text-[9px] uppercase">Output</span>
                      <p className="text-foreground">
                        {quote.amountOut === "—" ? quote.amountOut : `${quote.amountOut} ${form.paymentToken}`}
                      </p>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase">Impact</span>
                      <p className="text-foreground">
                        {quote.priceImpact === "—" ? quote.priceImpact : `${quote.priceImpact}%`}
                      </p>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase">Fee</span>
                      <p className="text-foreground">{quote.fee}</p>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase">Est. Time</span>
                      <p className="text-foreground">{quote.estimatedTime}</p>
                    </div>
                  </div>
                  {isCrossChain && (
                    <div className="pt-1 border-t border-primary/20">
                      <p className="text-[9px] text-muted-foreground font-mono">{quote.route}</p>
                    </div>
                  )}
                  <div className="pt-1 border-t border-primary/20">
                    <p className="text-[9px] text-muted-foreground leading-relaxed">{quote.note}</p>
                  </div>
                </motion.div>
              )}
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
