import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEscrow, useUniswapQuote } from "@/hooks/useEscrow";
import { TOKENS } from "@/contracts/config";
import { toast } from "@/hooks/use-toast";
import { ArrowRightLeft, Loader2 } from "lucide-react";

export default function CreateTask() {
  const navigate = useNavigate();
  const { createTask } = useEscrow();
  const { getQuote } = useUniswapQuote();
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<{ amountOut: string; priceImpact: string; fee: string } | null>(null);

  const [form, setForm] = useState({
    description: "",
    specURI: "",
    worker: "",
    verifier: "",
    paymentToken: "",
    amount: "",
    workerPreferredToken: "",
    deadlineDays: "7",
  });

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const fetchQuote = async () => {
    if (form.paymentToken && form.workerPreferredToken && form.amount) {
      const q = await getQuote(form.paymentToken, form.workerPreferredToken, form.amount);
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
        worker: form.worker,
        verifier: form.verifier,
        paymentToken: tokenMeta.address,
        amount: amountWei,
        workerPreferredToken: workerTokenMeta.address,
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
                <Label htmlFor="verifier" className="text-[10px] uppercase tracking-wider">Verifier Agent</Label>
                <Input
                  id="verifier"
                  placeholder="0x..."
                  value={form.verifier}
                  onChange={(e) => updateField("verifier", e.target.value)}
                  className="font-mono text-xs"
                  required
                />
              </div>
            </CardContent>
          </Card>

          <Card className="mt-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-wider">Budget & Deadline</CardTitle>
              <CardDescription className="text-xs">Set your budget, payout preference, and deadline</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider">Pay With</Label>
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
                  <Label className="text-[10px] uppercase tracking-wider">Worker Gets Paid In</Label>
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
                  disabled={!form.paymentToken || !form.workerPreferredToken || !form.amount}
                >
                  <ArrowRightLeft className="h-4 w-4" />
                </Button>
              </div>

              {quote && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="border border-primary/30 bg-primary/5 p-3"
                >
                  <p className="text-[10px] font-bold text-primary mb-2 uppercase tracking-wider">Swap Preview — Uniswap V3</p>
                  <div className="grid grid-cols-3 gap-2 text-xs font-mono text-muted-foreground">
                    <div>
                      <span className="text-[9px] uppercase">Output</span>
                      <p className="text-foreground">{quote.amountOut}</p>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase">Impact</span>
                      <p className="text-foreground">{quote.priceImpact}%</p>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase">Fee</span>
                      <p className="text-foreground">{quote.fee}</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </CardContent>
          </Card>

          <Button
            type="submit"
            className="mt-4 w-full bg-primary text-primary-foreground font-bold uppercase tracking-wider text-xs h-10"
            disabled={loading}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create Job & Lock Funds
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
