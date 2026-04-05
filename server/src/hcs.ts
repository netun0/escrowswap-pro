import { Client, PrivateKey, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { HCS_TOPIC_ID, HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY, NETWORK } from "./config.js";

type AuditResult = {
  ok: boolean;
  txId: string | null;
  sequenceNumber: string | null;
  reason?: string;
};

let client: Client | null = null;

function getClient(): Client | null {
  if (!HCS_TOPIC_ID || !HEDERA_ACCOUNT_ID || !HEDERA_PRIVATE_KEY) return null;
  if (client) return client;
  const next = Client.forName(NETWORK === "mainnet" ? "mainnet" : "testnet");
  next.setOperator(HEDERA_ACCOUNT_ID, PrivateKey.fromString(HEDERA_PRIVATE_KEY));
  client = next;
  return client;
}

export async function appendHcsAudit(message: Record<string, unknown>): Promise<AuditResult> {
  const ready = getClient();
  if (!ready || !HCS_TOPIC_ID) {
    return { ok: false, txId: null, sequenceNumber: null, reason: "missing_config" };
  }

  try {
    const tx = await new TopicMessageSubmitTransaction({
      topicId: HCS_TOPIC_ID,
      message: JSON.stringify(message),
    }).execute(ready);
    const receipt = await tx.getReceipt(ready);
    return {
      ok: true,
      txId: tx.transactionId.toString(),
      sequenceNumber: receipt.topicSequenceNumber?.toString() ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      txId: null,
      sequenceNumber: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
