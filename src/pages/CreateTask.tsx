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
    specURI: "",
    worker: "",
    verifier: "",
    paymentToken: "",
    amount: "",
    workerPreferredToken: "",
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
        specURI: form.specURI,
        worker: form.worker,
        verifier: form.verifier,
        paymentToken: tokenMeta.address,
        amount: amountWei,
        workerPreferredToken: workerTokenMeta.address,
      });
      toast({ title: "Task Created", description: `Task #${taskId} created successfully` });
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
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="gradient-text">Create</span> Task
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define a job, assign agents, and fund the escrow
        </p>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <form onSubmit={handleSubmit}>
          <Card className="border-border/50 bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg">Task Specification</CardTitle>
              <CardDescription>IPFS URI or description of the work</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="specURI">Spec URI</Label>
                <Textarea
                  id="specURI"
                  placeholder="ipfs://Qm... or https://..."
                  value={form.specURI}
                  onChange={(e) => updateField("specURI", e.target.value)}
                  className="font-mono text-xs"
                  required
                />
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4 border-border/50 bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg">Agent Assignment</CardTitle>
              <CardDescription>Assign worker and verifier addresses</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="worker">Worker Address</Label>
                <Input
                  id="worker"
                  placeholder="0x..."
                  value={form.worker}
                  onChange={(e) => updateField("worker", e.target.value)}
                  className="font-mono text-xs"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="verifier">Verifier Address</Label>
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

          <Card className="mt-4 border-border/50 bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg">Payment & Payout</CardTitle>
              <CardDescription>Configure escrow funding and Uniswap payout routing</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Payment Token</Label>
                  <Select value={form.paymentToken} onValueChange={(v) => updateField("paymentToken", v)}>
                    <SelectTrigger><SelectValue placeholder="Select token" /></SelectTrigger>
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
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount</Label>
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

              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-2">
                  <Label>Worker Preferred Token</Label>
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
                  className="mt-6"
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
                  className="rounded-lg border border-primary/20 bg-primary/5 p-3"
                >
                  <p className="text-xs font-semibold text-primary mb-1">Swap Preview (Uniswap V3)</p>
                  <div className="grid grid-cols-3 gap-2 text-xs font-mono text-muted-foreground">
                    <div>
                      <span className="text-[10px] uppercase">Output</span>
                      <p className="text-foreground">{quote.amountOut}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase">Impact</span>
                      <p className="text-foreground">{quote.priceImpact}%</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase">Fee</span>
                      <p className="text-foreground">{quote.fee}</p>
                    </div>
                  </div>
                </motion.div>
              )}
            </CardContent>
          </Card>

          <Button
            type="submit"
            className="mt-6 w-full gradient-primary text-primary-foreground font-semibold"
            disabled={loading}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create & Fund Escrow
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
