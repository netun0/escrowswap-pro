import type { SimilarityCluster, SubmissionRecord, Track } from "../../packages/shared/src/index.js";
import { OPENAI_API_KEY } from "./config.js";

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
const CLUSTER_AGENT_ID = "converge-similarity";

const STOP_WORDS = new Set([
  "about",
  "across",
  "after",
  "agent",
  "agents",
  "also",
  "app",
  "apps",
  "around",
  "based",
  "between",
  "blockchain",
  "build",
  "builder",
  "builders",
  "building",
  "chain",
  "contracts",
  "creates",
  "create",
  "crypto",
  "data",
  "defi",
  "demo",
  "deploy",
  "deployed",
  "design",
  "developer",
  "developers",
  "event",
  "experience",
  "flows",
  "github",
  "hackathon",
  "hedera",
  "index",
  "like",
  "management",
  "move",
  "native",
  "onchain",
  "platform",
  "product",
  "products",
  "project",
  "projects",
  "protocol",
  "protocols",
  "real",
  "simple",
  "smart",
  "solution",
  "state",
  "submission",
  "submissions",
  "system",
  "testnet",
  "tool",
  "tools",
  "track",
  "using",
  "users",
  "web3",
  "with",
  "working",
]);

const TOPIC_TEMPLATES = [
  {
    label: "Payout rails & work commerce",
    theme: "Escrow, invoicing, milestone release, and contractor compensation flows onchain.",
    keywords: ["escrow", "invoice", "payroll", "payout", "payment", "billing", "milestone", "contractor", "freelancer"],
  },
  {
    label: "Yield & liquidity design",
    theme: "Capital efficiency, LP positioning, locking, and yield optimization mechanics.",
    keywords: ["yield", "liquidity", "rebalanc", "apy", "lock", "market", "trad", "pool", "lp"],
  },
  {
    label: "Data & developer surfaces",
    theme: "Indexing, query layers, APIs, and developer-facing access to chain state.",
    keywords: ["graphql", "query", "index", "schema", "subscription", "developer", "api", "sdk"],
  },
  {
    label: "Identity & trust layers",
    theme: "Identity, credentials, reputation, and trust verification primitives.",
    keywords: ["identity", "credential", "reputation", "proof", "trust", "verify", "attest"],
  },
  {
    label: "Automation & agent workflows",
    theme: "Agentic task execution, orchestration, and automated decision loops.",
    keywords: ["agent", "automation", "orchestrat", "workflow", "copilot", "assistant", "task"],
  },
] as const;

type SparseVector = Map<string, number>;

type ClusterDocument = {
  submission: SubmissionRecord;
  text: string;
  tokens: string[];
  vector: SparseVector;
};

type CacheEntry = {
  signature: string;
  clusters: SimilarityCluster[];
};

const clusterCache = new Map<string, CacheEntry>();

export async function getSubmissionClusters(params: {
  hackathonId: string;
  submissions: SubmissionRecord[];
  tracks: Track[];
}): Promise<SimilarityCluster[]> {
  const signature = params.submissions
    .map((submission) =>
      [
        submission.id,
        submission.projectName,
        submission.description,
        submission.trackId,
        submission.status,
        submission.updatedAt,
      ].join("::"),
    )
    .join("|");
  const cached = clusterCache.get(params.hackathonId);
  if (cached?.signature === signature) {
    return cached.clusters;
  }

  const clusters = await buildSubmissionClusters(params.submissions, params.tracks);
  clusterCache.set(params.hackathonId, { signature, clusters });
  return clusters;
}

async function buildSubmissionClusters(submissions: SubmissionRecord[], tracks: Track[]): Promise<SimilarityCluster[]> {
  if (submissions.length === 0) return [];

  const trackLookup = new Map(tracks.map((track) => [track.id, track]));
  const documents = submissions.map((submission) => {
    const track = trackLookup.get(submission.trackId);
    const text = [
      submission.projectName,
      track?.name ?? submission.trackId,
      submission.description,
      submission.teamName,
      submission.deployedContracts.map((contract) => contract.label).join(" "),
    ]
      .filter(Boolean)
      .join("\n");
    return {
      submission,
      text,
      tokens: tokenize(text),
      vector: new Map<string, number>(),
    };
  });

  hydrateSparseVectors(documents);

  const embeddingVectors = await fetchEmbeddings(documents.map((doc) => doc.text));
  const similarityMatrix = embeddingVectors
    ? buildDenseSimilarityMatrix(embeddingVectors)
    : buildSparseSimilarityMatrix(documents.map((doc) => doc.vector));
  const threshold = computeMergeThreshold(similarityMatrix, Boolean(embeddingVectors));
  const clusters = hierarchicalClusters(documents.length, similarityMatrix, threshold);

  return clusters
    .map((indices, clusterIndex) =>
      buildCluster({
        documents,
        similarityMatrix,
        indices,
        clusterIndex,
        method: embeddingVectors ? "embeddings" : "lexical",
        model: embeddingVectors ? EMBEDDING_MODEL : "tfidf-local",
        trackLookup,
      }),
    )
    .sort((left, right) => {
      const sizeDelta = right.submissionIds.length - left.submissionIds.length;
      if (sizeDelta !== 0) return sizeDelta;
      return (right.cohesion ?? 0) - (left.cohesion ?? 0);
    });
}

async function fetchEmbeddings(inputs: string[]): Promise<number[][] | null> {
  if (!OPENAI_API_KEY || inputs.length < 2) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: inputs,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embeddings = payload.data?.map((entry) => (Array.isArray(entry.embedding) ? entry.embedding : [])) ?? [];
    if (embeddings.length !== inputs.length || embeddings.some((embedding) => embedding.length === 0)) {
      return null;
    }
    return embeddings;
  } catch {
    return null;
  }
}

function hydrateSparseVectors(documents: ClusterDocument[]) {
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const token of new Set(document.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  for (const document of documents) {
    const counts = new Map<string, number>();
    for (const token of document.tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    for (const [token, count] of counts.entries()) {
      const idf = Math.log((documents.length + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1;
      document.vector.set(token, count * idf);
    }
  }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map(normalizeToken)
    .filter((token): token is string => Boolean(token));
}

function normalizeToken(value: string): string | null {
  if (!value || value.length < 3 || STOP_WORDS.has(value) || /^\d+$/.test(value)) {
    return null;
  }

  let token = value;
  if (token.endsWith("ies") && token.length > 5) token = `${token.slice(0, -3)}y`;
  else if (token.endsWith("ing") && token.length > 5) token = token.slice(0, -3);
  else if (token.endsWith("ed") && token.length > 4) token = token.slice(0, -2);
  else if (token.endsWith("s") && token.length > 4) token = token.slice(0, -1);

  if (token.length < 3 || STOP_WORDS.has(token)) {
    return null;
  }
  return token;
}

function buildDenseSimilarityMatrix(vectors: number[][]): number[][] {
  return vectors.map((left, leftIndex) =>
    vectors.map((right, rightIndex) => {
      if (leftIndex === rightIndex) return 1;
      return cosineSimilarity(left, right);
    }),
  );
}

function buildSparseSimilarityMatrix(vectors: SparseVector[]): number[][] {
  return vectors.map((left, leftIndex) =>
    vectors.map((right, rightIndex) => {
      if (leftIndex === rightIndex) return 1;
      return sparseCosineSimilarity(left, right);
    }),
  );
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function sparseCosineSimilarity(left: SparseVector, right: SparseVector): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const value of left.values()) {
    leftNorm += value * value;
  }
  for (const value of right.values()) {
    rightNorm += value * value;
  }

  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  for (const [key, value] of smaller.entries()) {
    dot += value * (larger.get(key) ?? 0);
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function computeMergeThreshold(similarityMatrix: number[][], usedEmbeddings: boolean): number {
  const scores: number[] = [];
  for (let row = 0; row < similarityMatrix.length; row += 1) {
    for (let col = row + 1; col < similarityMatrix.length; col += 1) {
      scores.push(similarityMatrix[row][col] ?? 0);
    }
  }
  if (scores.length === 0) return 1;

  const mean = scores.reduce((total, value) => total + value, 0) / scores.length;
  const variance = scores.reduce((total, value) => total + (value - mean) ** 2, 0) / scores.length;
  const stddev = Math.sqrt(variance);
  const floor = usedEmbeddings ? 0.42 : 0.16;
  return Math.max(floor, Math.min(0.84, mean + stddev * 0.45));
}

function hierarchicalClusters(size: number, similarityMatrix: number[][], threshold: number): number[][] {
  const clusters = Array.from({ length: size }, (_, index) => [index]);
  while (clusters.length > 1) {
    let bestLeft = -1;
    let bestRight = -1;
    let bestScore = -1;

    for (let leftIndex = 0; leftIndex < clusters.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
        const score = averageClusterSimilarity(clusters[leftIndex], clusters[rightIndex], similarityMatrix);
        if (score > bestScore) {
          bestScore = score;
          bestLeft = leftIndex;
          bestRight = rightIndex;
        }
      }
    }

    if (bestScore < threshold || bestLeft === -1 || bestRight === -1) {
      break;
    }

    clusters[bestLeft] = [...clusters[bestLeft], ...clusters[bestRight]].sort((left, right) => left - right);
    clusters.splice(bestRight, 1);
  }
  return clusters;
}

function averageClusterSimilarity(left: number[], right: number[], similarityMatrix: number[][]): number {
  let total = 0;
  let count = 0;
  for (const leftIndex of left) {
    for (const rightIndex of right) {
      total += similarityMatrix[leftIndex][rightIndex] ?? 0;
      count += 1;
    }
  }
  return count ? total / count : 0;
}

function buildCluster(params: {
  documents: ClusterDocument[];
  similarityMatrix: number[][];
  indices: number[];
  clusterIndex: number;
  method: SimilarityCluster["method"];
  model: string;
  trackLookup: Map<string, Track>;
}): SimilarityCluster {
  const clusterDocuments = params.indices.map((index) => params.documents[index]);
  const keywords = pickClusterKeywords(clusterDocuments);
  const template = matchTemplate(keywords);
  const label = template?.label ?? fallbackLabel(keywords);
  const theme = template?.theme ?? fallbackTheme(keywords, clusterDocuments, params.trackLookup);
  const cohesion = calculateClusterCohesion(params.indices, params.similarityMatrix);
  const clusteredAt = clusterDocuments
    .map((entry) => entry.submission.updatedAt)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];

  return {
    id: `cluster-${slugify(label)}-${params.clusterIndex + 1}`,
    label,
    theme,
    agentRationale: buildRationale(clusterDocuments, keywords, theme),
    agentId: CLUSTER_AGENT_ID,
    method: params.method,
    model: params.model,
    keywords,
    cohesion,
    clusteredAt,
    submissionIds: clusterDocuments.map((entry) => entry.submission.id),
  };
}

function pickClusterKeywords(documents: ClusterDocument[]): string[] {
  const weights = new Map<string, number>();
  for (const document of documents) {
    for (const [token, value] of document.vector.entries()) {
      weights.set(token, (weights.get(token) ?? 0) + value);
    }
  }
  return [...weights.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([token]) => token)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
    .slice(0, 5);
}

function matchTemplate(keywords: string[]) {
  let best: (typeof TOPIC_TEMPLATES)[number] | null = null;
  let bestScore = 0;
  for (const template of TOPIC_TEMPLATES) {
    const score = keywords.reduce((total, keyword) => {
      return total + template.keywords.filter((candidate) => keyword.includes(candidate) || candidate.includes(keyword)).length;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      best = template;
    }
  }
  return bestScore > 0 ? best : null;
}

function fallbackLabel(keywords: string[]): string {
  if (keywords.length >= 2) {
    return `${titleCase(keywords[0])} & ${titleCase(keywords[1])}`;
  }
  if (keywords.length === 1) {
    return `${titleCase(keywords[0])} theme`;
  }
  return "Emerging ideas";
}

function fallbackTheme(keywords: string[], documents: ClusterDocument[], trackLookup: Map<string, Track>): string {
  if (keywords.length) {
    return `Projects centered on ${humanList(keywords.slice(0, 3))}.`;
  }
  const trackNames = [...new Set(documents.map((document) => trackLookup.get(document.submission.trackId)?.name ?? document.submission.trackId))];
  if (trackNames.length) {
    return `Projects sharing a similar shape inside ${humanList(trackNames)}.`;
  }
  return "Projects with a similar product surface.";
}

function buildRationale(documents: ClusterDocument[], keywords: string[], theme: string): string {
  const names = documents.map((document) => document.submission.projectName);
  if (documents.length === 1) {
    return `${names[0]} stands apart as its own theme, with the strongest language around ${humanList(keywords.slice(0, 3)) || "a distinct implementation niche"}.`;
  }
  return `${humanList(names)} group together because they repeatedly signal ${humanList(keywords.slice(0, 4)) || "a shared set of product primitives"}, indicating a common idea neighborhood. ${theme}`;
}

function calculateClusterCohesion(indices: number[], similarityMatrix: number[][]): number | null {
  if (indices.length < 2) return null;
  let total = 0;
  let count = 0;
  for (let left = 0; left < indices.length; left += 1) {
    for (let right = left + 1; right < indices.length; right += 1) {
      total += similarityMatrix[indices[left]][indices[right]] ?? 0;
      count += 1;
    }
  }
  if (!count) return null;
  return Number((total / count).toFixed(2));
}

function humanList(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function titleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
