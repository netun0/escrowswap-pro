import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceLatestEvaluationRun = vi.fn();
const updateSubmissionStatus = vi.fn();
const recordEvent = vi.fn();

vi.mock("../../server/src/store.js", () => ({
  createApprovalRequest: vi.fn(),
  createAwardProposal: vi.fn(),
  recordEvent,
  recordHcsAudit: vi.fn(),
  replaceLatestEvaluationRun,
  updateAwardProposal: vi.fn(),
  updateSubmissionStatus,
  upsertPrizeClaim: vi.fn(),
}));

vi.mock("../../server/src/hcs.js", () => ({
  appendHcsAudit: vi.fn(async () => ({ ok: false, txId: null, sequenceNumber: null })),
}));

vi.mock("../../server/src/treasuryContract.js", () => ({
  getTreasuryWriteContract: vi.fn(),
}));

describe("evaluateSubmission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("completes eligibility when GitHub evidence requests fail", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { evaluateSubmission } = await import("../../worker/src/analysis.ts");

    await expect(
      evaluateSubmission({
        hackathon: {
          id: "hack_123",
          name: "Spring Hackathon",
          tagline: "Ship it",
          organizerAccountId: "0.0.1001",
          organizerEvmAddress: "0x0000000000000000000000000000000000001001",
          judgeAccountId: "0.0.1002",
          judgeEvmAddress: "0x0000000000000000000000000000000000001002",
          payoutTokenId: "0.0.2001",
          payoutTokenEvmAddress: "0x0000000000000000000000000000000000002001",
          autonomousThreshold: "1000",
          approvalExpirySeconds: 3600,
          startsAt: new Date("2026-04-01T00:00:00.000Z").toISOString(),
          endsAt: new Date("2026-04-10T00:00:00.000Z").toISOString(),
          submissionDeadline: new Date("2026-04-08T00:00:00.000Z").toISOString(),
          judgingEndsAt: new Date("2026-04-12T00:00:00.000Z").toISOString(),
          status: "judging",
          treasuryTxHash: null,
          tracks: [],
        },
        track: {
          id: "track_123",
          name: "Infrastructure",
          description: "Build something real",
          sponsorName: "Sponsor",
          prizeAmount: "500",
          requirements: ["public repo", "demo"],
          evaluationPolicy: {
            minQualityScore: 70,
            requiresPublicRepo: true,
            requiresReadme: true,
            requiresDemo: true,
            requiresHashscanVerification: false,
            requiresContracts: false,
          },
        },
        submission: {
          id: "submission_123",
          hackathonId: "hack_123",
          trackId: "track_123",
          projectName: "Broken Links",
          teamName: "Team",
          teamMembers: [],
          githubUrl: "https://github.com/example/repo",
          demoUrl: "https://demo.example.com",
          description: "Project description",
          payoutAccountId: "0.0.3001",
          payoutEvmAddress: "0x0000000000000000000000000000000000003001",
          deployedContracts: [],
          status: "pending",
          evaluationRuns: [],
          awardProposal: null,
          claim: null,
          createdAt: new Date("2026-04-05T10:00:00.000Z").toISOString(),
          updatedAt: new Date("2026-04-05T10:00:00.000Z").toISOString(),
        },
      }),
    ).resolves.toBeUndefined();

    expect(replaceLatestEvaluationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "submission_123",
        agentRole: "eligibility",
        status: "completed",
        result: expect.objectContaining({
          passed: false,
          githubLive: false,
          demoPresent: false,
          readmePresent: false,
          hashscanVerified: true,
          rulesMet: false,
        }),
      }),
    );
    expect(updateSubmissionStatus).toHaveBeenCalledWith("submission_123", "ineligible");
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "eligibility.completed",
        submissionId: "submission_123",
      }),
    );
  });

  it("treats protected demo urls as reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.includes("demo.example.com")) {
          return new Response("", { status: 403 });
        }

        if (url.includes("api.github.com")) {
          throw new Error("skip github enrichment");
        }

        if (url.includes("api.openai.com")) {
          throw new Error("skip ai scoring");
        }

        throw new Error(`unexpected fetch: ${String(init?.method ?? "GET")} ${url}`);
      }),
    );

    const { evaluateSubmission } = await import("../../worker/src/analysis.ts");

    await expect(
      evaluateSubmission({
        hackathon: {
          id: "hack_456",
          name: "Spring Hackathon",
          tagline: "Ship it",
          organizerAccountId: "0.0.1001",
          organizerEvmAddress: "0x0000000000000000000000000000000000001001",
          judgeAccountId: "0.0.1002",
          judgeEvmAddress: "0x0000000000000000000000000000000000001002",
          payoutTokenId: "0.0.2001",
          payoutTokenEvmAddress: "0x0000000000000000000000000000000000002001",
          autonomousThreshold: "1000",
          approvalExpirySeconds: 3600,
          startsAt: new Date("2026-04-01T00:00:00.000Z").toISOString(),
          endsAt: new Date("2026-04-10T00:00:00.000Z").toISOString(),
          submissionDeadline: new Date("2026-04-08T00:00:00.000Z").toISOString(),
          judgingEndsAt: new Date("2026-04-12T00:00:00.000Z").toISOString(),
          status: "judging",
          treasuryTxHash: null,
          tracks: [],
        },
        track: {
          id: "track_456",
          name: "Infrastructure",
          description: "Build something real",
          sponsorName: "Sponsor",
          prizeAmount: "500",
          requirements: ["demo"],
          evaluationPolicy: {
            minQualityScore: 90,
            requiresPublicRepo: false,
            requiresReadme: false,
            requiresDemo: true,
            requiresHashscanVerification: false,
            requiresContracts: false,
          },
        },
        submission: {
          id: "submission_456",
          hackathonId: "hack_456",
          trackId: "track_456",
          projectName: "Protected Demo",
          teamName: "Team",
          teamMembers: [],
          githubUrl: "https://github.com/example/repo",
          demoUrl: "https://demo.example.com",
          description: "Project description with enough detail for fallback scoring.",
          payoutAccountId: "0.0.3001",
          payoutEvmAddress: "0x0000000000000000000000000000000000003001",
          deployedContracts: [],
          status: "pending",
          evaluationRuns: [],
          awardProposal: null,
          claim: null,
          createdAt: new Date("2026-04-05T10:00:00.000Z").toISOString(),
          updatedAt: new Date("2026-04-05T10:00:00.000Z").toISOString(),
        },
      }),
    ).resolves.toBeUndefined();

    expect(replaceLatestEvaluationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "submission_456",
        agentRole: "eligibility",
        status: "completed",
        result: expect.objectContaining({
          passed: true,
          demoPresent: true,
        }),
      }),
    );
    expect(updateSubmissionStatus).toHaveBeenCalledWith("submission_456", "evaluated");
  });
});
