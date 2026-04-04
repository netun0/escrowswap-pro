export const PROJECT_SEGMENTS = [
  "ai-agents",
  "defi",
  "payments",
  "infrastructure",
  "developer-tooling",
  "consumer-app",
  "data-analytics",
  "dao-governance",
  "gaming",
  "other",
] as const;

export const PROJECT_FIT_VALUES = ["high", "medium", "low"] as const;
export const PROJECT_DELIVERY_STAGES = ["idea", "prototype", "demo-ready", "production-ready"] as const;

export type ProjectSegment = (typeof PROJECT_SEGMENTS)[number];
export type ProjectFit = (typeof PROJECT_FIT_VALUES)[number];
export type ProjectDeliveryStage = (typeof PROJECT_DELIVERY_STAGES)[number];

export type ProjectSegmentationInput = {
  projectName: string;
  description: string;
  teamName: string;
  githubUrl: string;
  demoUrl: string;
  trackHints: string[];
  capabilities: string[];
  requestedBudget: number | null;
  metadata: Record<string, unknown> | null;
};

export type ProjectSegmentationResult = {
  summary: string;
  primarySegment: ProjectSegment;
  secondarySegments: string[];
  suggestedTracks: string[];
  capabilityTags: string[];
  hederaFit: ProjectFit;
  deliveryStage: ProjectDeliveryStage;
  riskFlags: string[];
  reasoning: string;
  confidence: number;
};

export const PROJECT_SEGMENTATION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "primarySegment",
    "secondarySegments",
    "suggestedTracks",
    "capabilityTags",
    "hederaFit",
    "deliveryStage",
    "riskFlags",
    "reasoning",
    "confidence",
  ],
  properties: {
    summary: {
      type: "string",
      description: "A short factual summary of what the project does.",
    },
    primarySegment: {
      type: "string",
      enum: [...PROJECT_SEGMENTS],
      description: "The closest product segment for downstream routing.",
    },
    secondarySegments: {
      type: "array",
      description: "Other relevant segment labels beyond the primary segment.",
      items: { type: "string" },
      maxItems: 5,
    },
    suggestedTracks: {
      type: "array",
      description: "Track or category suggestions for hackathon-style sorting.",
      items: { type: "string" },
      maxItems: 5,
    },
    capabilityTags: {
      type: "array",
      description: "Short tags that capture core product capabilities.",
      items: { type: "string" },
      maxItems: 8,
    },
    hederaFit: {
      type: "string",
      enum: [...PROJECT_FIT_VALUES],
      description: "How strongly the project appears to fit Hedera-native workflows or infrastructure.",
    },
    deliveryStage: {
      type: "string",
      enum: [...PROJECT_DELIVERY_STAGES],
      description: "Estimated maturity based on the provided evidence.",
    },
    riskFlags: {
      type: "array",
      description: "Concise delivery, compliance, or product risks worth reviewing.",
      items: { type: "string" },
      maxItems: 6,
    },
    reasoning: {
      type: "string",
      description: "Short explanation for the routing decision.",
    },
    confidence: {
      type: "number",
      description: "Confidence from 0 to 1 in the segmentation decision.",
      minimum: 0,
      maximum: 1,
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}

function uniqueStrings(values: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
    if (unique.length >= maxItems) break;
  }

  return unique;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function readEnumValue<T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function readConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("confidence must be a number between 0 and 1");
  }
  return value;
}

function renderMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "none";
  const json = JSON.stringify(metadata, null, 2);
  return truncate(json, 2000);
}

export function buildProjectSegmentationInstructions(): string {
  return [
    "You segment inbound project submissions for a Hedera-backed queue.",
    "Classify the project for routing and review, not for marketing copy.",
    "Use the closest segment instead of defaulting to other.",
    "Base the delivery stage on evidence in the submission, not optimism.",
    "Keep summaries and reasoning concise and factual.",
  ].join("\n");
}

export function buildProjectSegmentationPrompt(input: ProjectSegmentationInput, sourceLabel: string): string {
  return [
    "Segment this project submission.",
    "",
    `Source: ${sourceLabel}`,
    `Project name: ${input.projectName}`,
    `Team name: ${input.teamName || "unknown"}`,
    `Description: ${input.description}`,
    `GitHub URL: ${input.githubUrl || "not provided"}`,
    `Demo URL: ${input.demoUrl || "not provided"}`,
    `Track hints: ${input.trackHints.length > 0 ? input.trackHints.join(", ") : "none"}`,
    `Capabilities: ${input.capabilities.length > 0 ? input.capabilities.join(", ") : "none"}`,
    `Requested budget: ${input.requestedBudget == null ? "unknown" : String(input.requestedBudget)}`,
    `Metadata: ${renderMetadata(input.metadata)}`,
    "",
    "Return the project's most likely segment, suggested review tracks, Hedera fit, delivery stage, risks, and a short reason.",
  ].join("\n");
}

export function parseProjectSegmentationResult(value: unknown): ProjectSegmentationResult {
  if (!isRecord(value)) {
    throw new Error("Structured output must be an object");
  }

  return {
    summary: readRequiredString(value.summary, "summary"),
    primarySegment: readEnumValue(value.primarySegment, PROJECT_SEGMENTS, "primarySegment"),
    secondarySegments: uniqueStrings(asStringArray(value.secondarySegments), 5),
    suggestedTracks: uniqueStrings(asStringArray(value.suggestedTracks), 5),
    capabilityTags: uniqueStrings(asStringArray(value.capabilityTags), 8),
    hederaFit: readEnumValue(value.hederaFit, PROJECT_FIT_VALUES, "hederaFit"),
    deliveryStage: readEnumValue(value.deliveryStage, PROJECT_DELIVERY_STAGES, "deliveryStage"),
    riskFlags: uniqueStrings(asStringArray(value.riskFlags), 6),
    reasoning: readRequiredString(value.reasoning, "reasoning"),
    confidence: readConfidence(value.confidence),
  };
}
