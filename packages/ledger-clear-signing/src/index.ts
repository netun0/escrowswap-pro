import type { AwardApproval, SettlementMode } from "../../shared/src/index.js";

export type ClearSigningField = {
  label: string;
  value: string;
  format?: "address" | "amount" | "text" | "timestamp";
};

export type ClearSigningManifest = {
  version: "1.0";
  action: "approve_award" | "mint_claim" | "release_payout" | "refund_payout";
  contractName: string;
  contractAddress: string;
  chainId: number;
  digest: string;
  summary: string;
  fields: ClearSigningField[];
  calldataPreview?: string;
};

function settlementLabel(mode: SettlementMode): string {
  return mode === "claim_token" ? "Mint prize claim NFT" : "Release autonomous payout";
}

export function summarizeAwardApproval(approval: AwardApproval): string {
  const mode = settlementLabel(approval.settlementMode);
  return `${mode} for ${approval.amount} units to ${approval.winner} on track ${approval.trackId}. Approval expires at ${new Date(
    approval.expiresAt * 1000,
  ).toISOString()}.`;
}

export function buildClearSigningManifest(input: {
  action: ClearSigningManifest["action"];
  chainId: number;
  contractAddress: string;
  contractName: string;
  digest: string;
  approval: AwardApproval;
  calldataPreview?: string;
}): ClearSigningManifest {
  return {
    version: "1.0",
    action: input.action,
    chainId: input.chainId,
    contractAddress: input.contractAddress,
    contractName: input.contractName,
    digest: input.digest,
    calldataPreview: input.calldataPreview,
    summary: summarizeAwardApproval(input.approval),
    fields: [
      { label: "Award ID", value: input.approval.awardId, format: "text" },
      { label: "Hackathon", value: input.approval.hackathonId, format: "text" },
      { label: "Submission", value: input.approval.submissionId, format: "text" },
      { label: "Track", value: input.approval.trackId, format: "text" },
      { label: "Recipient", value: input.approval.winner, format: "address" },
      { label: "Amount", value: input.approval.amount, format: "amount" },
      { label: "Settlement", value: settlementLabel(input.approval.settlementMode), format: "text" },
      { label: "Expires", value: new Date(input.approval.expiresAt * 1000).toISOString(), format: "timestamp" },
    ],
  };
}

export function validateClearSigningManifest(manifest: ClearSigningManifest): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!manifest.contractAddress.startsWith("0x")) errors.push("contractAddress must be an EVM address");
  if (!manifest.digest.startsWith("0x")) errors.push("digest must be a hex string");
  if (!manifest.summary.trim()) errors.push("summary is required");
  if (manifest.fields.length < 4) errors.push("at least four fields are required");
  return { ok: errors.length === 0, errors };
}
