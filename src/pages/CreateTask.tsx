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
        <h1 className="text-2xl font-black tracking-tight">Create Task</h1>
        <p className="mt-0.5 text-xs text-muted-foreground font-mono uppercase tracking-wider">
          Define job · assign agents · fund escrow
        </p>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-wider">Task Specification</CardTitle>
              <CardDescription className="text-xs">IPFS URI or description of the work</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="specURI" className="text-[10px] uppercase tracking-wider">Spec URI</Label>
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

          <Card className="mt-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-wider">Agent Assignment</CardTitle>
              <CardDescription className="text-xs">Assign worker and verifier addresses</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="worker" className="text-[10px] uppercase tracking-wider">Worker Address</Label>
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
                <Label htmlFor="verifier" className="text-[10px] uppercase tracking-wider">Verifier Address</Label>
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
              <CardTitle className="text-sm font-bold uppercase tracking-wider">Payment & Payout</CardTitle>
              <CardDescription className="text-xs">Configure escrow funding and Uniswap payout routing</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider">Payment Token</Label>
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
                <div className="space-y-1.5">
                  <Label htmlFor="amount" className="text-[10px] uppercase tracking-wider">Amount</Label>
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
                <div className="flex-1 space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider">Worker Preferred Token</Label>
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
            Create & Fund Escrow
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
