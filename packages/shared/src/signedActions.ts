import { TypedDataEncoder, type TypedDataField, getAddress } from "ethers";
import { z } from "zod";
import { toOnchainId } from "./ids.js";
import { awardApprovalSchema } from "./treasury.js";

export const TREASURY_EIP712_DOMAIN_NAME = "JudgeBuddyTreasury";
export const TREASURY_EIP712_DOMAIN_VERSION = "1";

export const treasuryActionTypeSchema = z.enum([
  "approve_award",
  "mint_claim",
  "release_payout",
  "refund_payout",
]);
export type TreasuryActionType = z.infer<typeof treasuryActionTypeSchema>;

export const treasuryDomainSchema = z.object({
  name: z.literal(TREASURY_EIP712_DOMAIN_NAME).default(TREASURY_EIP712_DOMAIN_NAME),
  version: z.literal(TREASURY_EIP712_DOMAIN_VERSION).default(TREASURY_EIP712_DOMAIN_VERSION),
  chainId: z.number().int().positive(),
  verifyingContract: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});
export type TreasuryTypedDataDomain = z.infer<typeof treasuryDomainSchema>;

export const mintClaimActionSchema = z.object({
  awardId: z.string().min(1),
  hackathonId: z.string().min(1),
  submissionId: z.string().min(1),
  trackId: z.string().min(1),
  claimant: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+$/),
  metadataURI: z.string().min(1),
  expiresAt: z.number().int().positive(),
});
export type MintClaimAction = z.infer<typeof mintClaimActionSchema>;

export const releasePayoutActionSchema = z.object({
  awardId: z.string().min(1),
  hackathonId: z.string().min(1),
  submissionId: z.string().min(1),
  trackId: z.string().min(1),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  payoutToken: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+$/),
  expiresAt: z.number().int().positive(),
});
export type ReleasePayoutAction = z.infer<typeof releasePayoutActionSchema>;

export const refundPayoutActionSchema = z.object({
  hackathonId: z.string().min(1),
  trackId: z.string().min(1),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  payoutToken: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+$/),
  expiresAt: z.number().int().positive(),
});
export type RefundPayoutAction = z.infer<typeof refundPayoutActionSchema>;

export const approveAwardActionEnvelopeSchema = z.object({
  action: z.literal("approve_award"),
  payload: awardApprovalSchema,
});

export const mintClaimActionEnvelopeSchema = z.object({
  action: z.literal("mint_claim"),
  payload: mintClaimActionSchema,
});

export const releasePayoutActionEnvelopeSchema = z.object({
  action: z.literal("release_payout"),
  payload: releasePayoutActionSchema,
});

export const refundPayoutActionEnvelopeSchema = z.object({
  action: z.literal("refund_payout"),
  payload: refundPayoutActionSchema,
});

export const treasuryActionEnvelopeSchema = z.discriminatedUnion("action", [
  approveAwardActionEnvelopeSchema,
  mintClaimActionEnvelopeSchema,
  releasePayoutActionEnvelopeSchema,
  refundPayoutActionEnvelopeSchema,
]);
export type TreasuryActionEnvelope = z.infer<typeof treasuryActionEnvelopeSchema>;

const TREASURY_TYPED_DATA_TYPES: Record<TreasuryActionType, Record<string, TypedDataField[]>> = {
  approve_award: {
    AwardApproval: [
      { name: "awardId", type: "bytes32" },
      { name: "hackathonId", type: "bytes32" },
      { name: "submissionId", type: "bytes32" },
      { name: "trackId", type: "bytes32" },
      { name: "winner", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "settlementMode", type: "uint8" },
      { name: "expiresAt", type: "uint256" },
    ],
  },
  mint_claim: {
    MintClaim: [
      { name: "awardId", type: "bytes32" },
      { name: "hackathonId", type: "bytes32" },
      { name: "submissionId", type: "bytes32" },
      { name: "trackId", type: "bytes32" },
      { name: "claimant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "metadataURI", type: "string" },
      { name: "expiresAt", type: "uint256" },
    ],
  },
  release_payout: {
    ReleasePayout: [
      { name: "awardId", type: "bytes32" },
      { name: "hackathonId", type: "bytes32" },
      { name: "submissionId", type: "bytes32" },
      { name: "trackId", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "payoutToken", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
    ],
  },
  refund_payout: {
    RefundPayout: [
      { name: "hackathonId", type: "bytes32" },
      { name: "trackId", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "payoutToken", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
    ],
  },
};

const TREASURY_PRIMARY_TYPES: Record<TreasuryActionType, string> = {
  approve_award: "AwardApproval",
  mint_claim: "MintClaim",
  release_payout: "ReleasePayout",
  refund_payout: "RefundPayout",
};

export function buildTreasuryTypedDataDomain(input: {
  chainId: number;
  verifyingContract: string;
}): TreasuryTypedDataDomain {
  return treasuryDomainSchema.parse({
    chainId: input.chainId,
    verifyingContract: getAddress(input.verifyingContract),
  });
}

function normalizeEnvelope(
  action: TreasuryActionType,
  payload: TreasuryActionEnvelope["payload"],
): TreasuryActionEnvelope {
  return treasuryActionEnvelopeSchema.parse({ action, payload } as TreasuryActionEnvelope);
}

function normalizeTypedDataMessage(envelope: TreasuryActionEnvelope): Record<string, any> {
  switch (envelope.action) {
    case "approve_award":
      return {
        awardId: toOnchainId(envelope.payload.awardId),
        hackathonId: toOnchainId(envelope.payload.hackathonId),
        submissionId: toOnchainId(envelope.payload.submissionId),
        trackId: toOnchainId(envelope.payload.trackId),
        winner: getAddress(envelope.payload.winner),
        amount: BigInt(envelope.payload.amount),
        settlementMode: envelope.payload.settlementMode === "claim_token" ? 1 : 0,
        expiresAt: BigInt(envelope.payload.expiresAt),
      };
    case "mint_claim":
      return {
        awardId: toOnchainId(envelope.payload.awardId),
        hackathonId: toOnchainId(envelope.payload.hackathonId),
        submissionId: toOnchainId(envelope.payload.submissionId),
        trackId: toOnchainId(envelope.payload.trackId),
        claimant: getAddress(envelope.payload.claimant),
        amount: BigInt(envelope.payload.amount),
        metadataURI: envelope.payload.metadataURI,
        expiresAt: BigInt(envelope.payload.expiresAt),
      };
    case "release_payout":
      return {
        awardId: toOnchainId(envelope.payload.awardId),
        hackathonId: toOnchainId(envelope.payload.hackathonId),
        submissionId: toOnchainId(envelope.payload.submissionId),
        trackId: toOnchainId(envelope.payload.trackId),
        recipient: getAddress(envelope.payload.recipient),
        payoutToken: getAddress(envelope.payload.payoutToken),
        amount: BigInt(envelope.payload.amount),
        expiresAt: BigInt(envelope.payload.expiresAt),
      };
    case "refund_payout":
      return {
        hackathonId: toOnchainId(envelope.payload.hackathonId),
        trackId: toOnchainId(envelope.payload.trackId),
        recipient: getAddress(envelope.payload.recipient),
        payoutToken: getAddress(envelope.payload.payoutToken),
        amount: BigInt(envelope.payload.amount),
        expiresAt: BigInt(envelope.payload.expiresAt),
      };
  }
}

export function buildTreasuryTypedData(action: TreasuryActionType, payload: TreasuryActionEnvelope["payload"], domain: {
  chainId: number;
  verifyingContract: string;
}) {
  const envelope = normalizeEnvelope(action, payload);
  const typedDomain = buildTreasuryTypedDataDomain(domain);
  const actionName = envelope.action;
  const message = normalizeTypedDataMessage(envelope);

  return {
    domain: typedDomain,
    primaryType: TREASURY_PRIMARY_TYPES[actionName],
    types: TREASURY_TYPED_DATA_TYPES[actionName],
    message,
  };
}

export function hashTreasuryTypedData(
  action: TreasuryActionType,
  payload: TreasuryActionEnvelope["payload"],
  domain: { chainId: number; verifyingContract: string },
): `0x${string}` {
  const typedData = buildTreasuryTypedData(action, payload, domain);
  return TypedDataEncoder.hash(typedData.domain, typedData.types, typedData.message) as `0x${string}`;
}
