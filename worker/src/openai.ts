import { OPENAI_API_KEY, OPENAI_MODEL } from "../../server/src/config.js";

type JsonSchema = Record<string, unknown>;

function extractOutputText(payload: any): string {
  if (typeof payload.output_text === "string" && payload.output_text) return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  throw new Error("OpenAI response did not include output text");
}

export async function runStructuredPrompt<T>(params: {
  name: string;
  system: string;
  user: string;
  schema: JsonSchema;
}): Promise<{ output: T; model: string }> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: params.system }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: params.user }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: params.name,
          strict: true,
          schema: params.schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `OpenAI responses API failed with ${response.status}`);
  }

  const payload = await response.json();
  const outputText = extractOutputText(payload);
  return {
    output: JSON.parse(outputText) as T,
    model: OPENAI_MODEL,
  };
}
