import { describe, expect, it } from "vitest";
import { buildClearSigningManifest, validateClearSigningManifest } from "../../packages/ledger-clear-signing/src/index";
import { hashTreasuryTypedData } from "../../packages/shared/src/index";

describe("ledger clear signing", () => {
  it("builds a stable approve_award digest and calldata preview", () => {
    const manifest = buildClearSigningManifest({
      action: "approve_award",
      chainId: 296,
      contractAddress: "0x00000000000000000000000000000000000004d2",
      payload: {
        awardId: "award_demo",
        hackathonId: "hackathon_demo",
        submissionId: "submission_demo",
        trackId: "track_demo",
        winner: "0x0000000000000000000000000000000000000BEE",
        amount: "25000000",
        settlementMode: "claim_token",
        expiresAt: 1_900_000_000,
      },
    });

    expect(manifest.digest).toBe(
      hashTreasuryTypedData("approve_award", manifest.rawPayload, {
        chainId: 296,
        verifyingContract: "0x00000000000000000000000000000000000004d2",
      }),
    );
    expect(manifest.functionName).toBe("executeApprovedAward");
    expect(manifest.claimMetadata?.metadataURI).toContain("jb://claim/");
    expect(validateClearSigningManifest(manifest)).toEqual({ ok: true, errors: [] });
  });

  it("builds a direct mint_claim clear-signing manifest", () => {
    const manifest = buildClearSigningManifest({
      action: "mint_claim",
      chainId: 296,
      contractAddress: "0x0000000000000000000000000000000000000ABC",
      payload: {
        awardId: "award_demo",
        hackathonId: "hackathon_demo",
        submissionId: "submission_demo",
        trackId: "track_demo",
        claimant: "0x0000000000000000000000000000000000000BEE",
        amount: "25000000",
        metadataURI: "jb://claim/demo",
        expiresAt: 1_900_000_000,
      },
    });

    expect(manifest.functionName).toBe("mintClaim");
    expect(manifest.calldataPreview.startsWith("0x")).toBe(true);
    expect(validateClearSigningManifest(manifest).ok).toBe(true);
  });
});
