import { Interface, getAddress } from "ethers";
import {
  HACKATHON_TREASURY_ABI,
  PRIZE_CLAIM_TOKEN_ABI,
  buildTreasuryTypedData,
  hashTreasuryTypedData,
  toOnchainId,
  type AwardApproval,
  type MintClaimAction,
  type RefundPayoutAction,
  type ReleasePayoutAction,
  type TreasuryActionType,
} from "../../shared/src/index.js";

export type ClearSigningField = {
  label: string;
  value: string;
  format?: "address" | "amount" | "text" | "timestamp" | "digest";
};

export type ClearSigningManifest = {
  version: "1.0";
  action: TreasuryActionType;
  chainId: number;
  contractName: string;
  contractAddress: string;
  functionName: string;
  digest: string;
  summary: string;
  primaryType: string;
  fields: ClearSigningField[];
  typedData: ReturnType<typeof buildTreasuryTypedData>;
  rawPayload: ManifestInput["payload"];
  calldataPreview: string;
  claimMetadata?: {
    claimId: string;
    metadataURI: string;
  };
};

type ManifestInput =
  | {
      action: "approve_award";
      chainId: number;
      contractAddress: string;
      contractName?: string;
      payload: AwardApproval;
      signature?: string;
    }
  | {
      action: "mint_claim";
      chainId: number;
      contractAddress: string;
      contractName?: string;
      payload: MintClaimAction;
    }
  | {
      action: "release_payout";
      chainId: number;
      contractAddress: string;
      contractName?: string;
      payload: ReleasePayoutAction;
      signature?: string;
    }
  | {
      action: "refund_payout";
      chainId: number;
      contractAddress: string;
      contractName?: string;
      payload: RefundPayoutAction;
    };

const treasuryInterface = new Interface(HACKATHON_TREASURY_ABI);
const claimInterface = new Interface(PRIZE_CLAIM_TOKEN_ABI);

function settlementLabel(mode: AwardApproval["settlementMode"]): string {
  return mode === "claim_token" ? "Mint prize claim NFT" : "Release treasury payout";
}

function buildClaimMetadataURI(awardId: string): string {
  return `jb://claim/${toOnchainId(awardId)}`;
}

function normalizeAddress(address: string): string {
  return getAddress(address);
}

function approvalFields(approval: AwardApproval): ClearSigningField[] {
  return [
    { label: "Award ID", value: approval.awardId, format: "text" },
    { label: "Hackathon", value: approval.hackathonId, format: "text" },
    { label: "Submission", value: approval.submissionId, format: "text" },
    { label: "Track", value: approval.trackId, format: "text" },
    { label: "Recipient", value: approval.winner, format: "address" },
    { label: "Amount", value: approval.amount, format: "amount" },
    { label: "Settlement", value: settlementLabel(approval.settlementMode), format: "text" },
    { label: "Expires", value: new Date(approval.expiresAt * 1000).toISOString(), format: "timestamp" },
  ];
}

function buildApprovalCallTuple(approval: AwardApproval) {
  return {
    awardId: toOnchainId(approval.awardId),
    hackathonId: toOnchainId(approval.hackathonId),
    submissionId: toOnchainId(approval.submissionId),
    trackId: toOnchainId(approval.trackId),
    winner: normalizeAddress(approval.winner),
    amount: BigInt(approval.amount),
    settlementMode: approval.settlementMode === "claim_token" ? 1 : 0,
    expiresAt: BigInt(approval.expiresAt),
  };
}

function buildReleaseApprovalPayload(payload: ReleasePayoutAction): AwardApproval {
  return {
    awardId: payload.awardId,
    hackathonId: payload.hackathonId,
    submissionId: payload.submissionId,
    trackId: payload.trackId,
    winner: payload.recipient,
    amount: payload.amount,
    settlementMode: "autonomous_payout",
    expiresAt: payload.expiresAt,
  };
}

function buildSummary(input: ManifestInput): string {
  switch (input.action) {
    case "approve_award": {
      return `${settlementLabel(input.payload.settlementMode)} for ${input.payload.amount} units to ${input.payload.winner}. Signature expires at ${new Date(
        input.payload.expiresAt * 1000,
      ).toISOString()}.`;
    }
    case "mint_claim":
      return `Mint prize claim NFT for ${input.payload.claimant} covering ${input.payload.amount} units.`;
    case "release_payout":
      return `Release treasury payout of ${input.payload.amount} units to ${input.payload.recipient}.`;
    case "refund_payout":
      return `Refund ${input.payload.amount} units from track ${input.payload.trackId} to ${input.payload.recipient}.`;
  }
}

function buildFields(input: ManifestInput): ClearSigningField[] {
  switch (input.action) {
    case "approve_award":
      return approvalFields(input.payload);
    case "mint_claim":
      return [
        { label: "Award ID", value: input.payload.awardId, format: "text" },
        { label: "Claimant", value: input.payload.claimant, format: "address" },
        { label: "Amount", value: input.payload.amount, format: "amount" },
        { label: "Metadata", value: input.payload.metadataURI, format: "text" },
        { label: "Expires", value: new Date(input.payload.expiresAt * 1000).toISOString(), format: "timestamp" },
      ];
    case "release_payout":
      return [
        { label: "Award ID", value: input.payload.awardId, format: "text" },
        { label: "Recipient", value: input.payload.recipient, format: "address" },
        { label: "Payout Token", value: input.payload.payoutToken, format: "address" },
        { label: "Amount", value: input.payload.amount, format: "amount" },
        { label: "Expires", value: new Date(input.payload.expiresAt * 1000).toISOString(), format: "timestamp" },
      ];
    case "refund_payout":
      return [
        { label: "Hackathon", value: input.payload.hackathonId, format: "text" },
        { label: "Track", value: input.payload.trackId, format: "text" },
        { label: "Recipient", value: input.payload.recipient, format: "address" },
        { label: "Payout Token", value: input.payload.payoutToken, format: "address" },
        { label: "Amount", value: input.payload.amount, format: "amount" },
        { label: "Expires", value: new Date(input.payload.expiresAt * 1000).toISOString(), format: "timestamp" },
      ];
  }
}

function buildCalldataPreview(input: ManifestInput): { functionName: string; calldataPreview: string; claimMetadata?: ClearSigningManifest["claimMetadata"] } {
  switch (input.action) {
    case "approve_award": {
      const signature = input.signature ?? "0x";
      const calldataPreview = treasuryInterface.encodeFunctionData("executeApprovedAward", [
        buildApprovalCallTuple(input.payload),
        signature,
      ]);
      return {
        functionName: "executeApprovedAward",
        calldataPreview,
        claimMetadata:
          input.payload.settlementMode === "claim_token"
            ? { claimId: input.payload.awardId, metadataURI: buildClaimMetadataURI(input.payload.awardId) }
            : undefined,
      };
    }
    case "mint_claim":
      return {
        functionName: "mintClaim",
        calldataPreview: claimInterface.encodeFunctionData("mintClaim", [
          toOnchainId(input.payload.awardId),
          normalizeAddress(input.payload.claimant),
          input.payload.metadataURI,
        ]),
        claimMetadata: { claimId: input.payload.awardId, metadataURI: input.payload.metadataURI },
      };
    case "release_payout": {
      const approval = buildReleaseApprovalPayload(input.payload);
      return {
        functionName: "executeApprovedAward",
        calldataPreview: treasuryInterface.encodeFunctionData("executeApprovedAward", [
          buildApprovalCallTuple(approval),
          input.signature ?? "0x",
        ]),
      };
    }
    case "refund_payout":
      return {
        functionName: "refundRemaining",
        calldataPreview: treasuryInterface.encodeFunctionData("refundRemaining", [
          toOnchainId(input.payload.hackathonId),
          toOnchainId(input.payload.trackId),
          normalizeAddress(input.payload.recipient),
          BigInt(input.payload.amount),
        ]),
      };
  }
}

export function buildClearSigningManifest(input: ManifestInput): ClearSigningManifest {
  const contractAddress = normalizeAddress(input.contractAddress);
  const typedData = buildTreasuryTypedData(input.action, input.payload, {
    chainId: input.chainId,
    verifyingContract: contractAddress,
  });
  const digest = hashTreasuryTypedData(input.action, input.payload, {
    chainId: input.chainId,
    verifyingContract: contractAddress,
  });
  const { functionName, calldataPreview, claimMetadata } = buildCalldataPreview(input);

  return {
    version: "1.0",
    action: input.action,
    chainId: input.chainId,
    contractName: input.contractName ?? (input.action === "mint_claim" ? "PrizeClaimToken" : "HackathonTreasury"),
    contractAddress,
    functionName,
    digest,
    summary: buildSummary(input),
    primaryType: typedData.primaryType,
    fields: buildFields(input),
    typedData,
    rawPayload: input.payload,
    calldataPreview,
    claimMetadata,
  };
}

function equalIgnoreCase(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function validateApproveAwardCalldata(manifest: ClearSigningManifest): string[] {
  const errors: string[] = [];
  const decoded = treasuryInterface.decodeFunctionData("executeApprovedAward", manifest.calldataPreview);
  const approval = decoded[0] as {
    awardId: string;
    hackathonId: string;
    submissionId: string;
    trackId: string;
    winner: string;
    amount: bigint;
    settlementMode: number;
    expiresAt: bigint;
  };
  const message = manifest.rawPayload as AwardApproval;

  if (approval.awardId !== toOnchainId(message.awardId)) errors.push("awardId does not match calldata");
  if (approval.hackathonId !== toOnchainId(message.hackathonId)) errors.push("hackathonId does not match calldata");
  if (approval.submissionId !== toOnchainId(message.submissionId)) errors.push("submissionId does not match calldata");
  if (approval.trackId !== toOnchainId(message.trackId)) errors.push("trackId does not match calldata");
  if (!equalIgnoreCase(approval.winner, message.winner)) errors.push("winner does not match calldata");
  if (approval.amount.toString() !== message.amount) errors.push("amount does not match calldata");
  if (approval.expiresAt.toString() !== String(message.expiresAt)) errors.push("expiresAt does not match calldata");

  return errors;
}

export function validateClearSigningManifest(manifest: ClearSigningManifest): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!manifest.contractAddress.startsWith("0x")) errors.push("contractAddress must be an EVM address");
  if (!manifest.digest.startsWith("0x")) errors.push("digest must be a hex string");
  if (!manifest.calldataPreview.startsWith("0x")) errors.push("calldataPreview must be a hex string");
  if (!manifest.summary.trim()) errors.push("summary is required");
  if (manifest.fields.length < 4) errors.push("at least four fields are required");

  const recomputedDigest = hashTreasuryTypedData(manifest.action, manifest.rawPayload as ManifestInput["payload"], {
    chainId: manifest.chainId,
    verifyingContract: manifest.contractAddress,
  });
  if (recomputedDigest !== manifest.digest) {
    errors.push("digest does not match typed data");
  }

  if (manifest.action === "approve_award" || manifest.action === "release_payout") {
    errors.push(...validateApproveAwardCalldata(manifest));
  }

  return { ok: errors.length === 0, errors };
}
