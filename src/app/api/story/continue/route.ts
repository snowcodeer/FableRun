import {
  fallbackStoryContinuation,
  isCanonicalStoryChoice,
  routeLabelFor,
  type StoryContinuation,
} from "@/lib/story/freeform-choice";

export const runtime = "nodejs";

const DEFAULT_MODEL = "gpt-5.4-mini";
const MAX_REQUEST_BYTES = 2_048;
const MAX_CHOICE_LENGTH = 280;
const PROVIDER_TIMEOUT_MS = 7_000;

interface ContinueRequest {
  choiceText: string;
  relationshipName: string;
  relationshipLabel: string;
}
interface OpenAIResponseBody {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

function parseRequest(value: unknown): ContinueRequest | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.choiceText !== "string") return null;
  if (
    candidate.relationshipName !== undefined &&
    typeof candidate.relationshipName !== "string"
  ) return null;
  if (
    candidate.relationshipLabel !== undefined &&
    typeof candidate.relationshipLabel !== "string"
  ) return null;

  const choiceText = candidate.choiceText.trim().slice(0, MAX_CHOICE_LENGTH);
  if (choiceText.length < 2) return null;

  return {
    choiceText,
    relationshipName:
      (candidate.relationshipName as string | undefined)?.trim().slice(0, 24) || "Alex",
    relationshipLabel:
      (candidate.relationshipLabel as string | undefined)?.trim().slice(0, 24) || "friend",
  };
}

function outputText(body: OpenAIResponseBody): string | null {
  if (typeof body.output_text === "string" && body.output_text.trim()) {
    return body.output_text.trim();
  }
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text.trim();
      }
    }
  }
  return null;
}

function parseContinuation(text: string): Omit<StoryContinuation, "source"> | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (!isCanonicalStoryChoice(value.routeId)) return null;
    if (typeof value.reply !== "string") return null;
    const reply = value.reply.trim();
    if (reply.length < 8 || reply.length > 260) return null;
    return {
      routeId: value.routeId,
      routeLabel: routeLabelFor(value.routeId),
      reply,
    };
  } catch {
    return null;
  }
}

async function continueWithModel(
  input: ContinueRequest,
  options: {
    endpoint: string;
    token: string;
    model: string;
    source: "openai" | "gateway";
  },
): Promise<StoryContinuation | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(options.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        store: false,
        reasoning: { effort: "none" },
        max_output_tokens: 180,
        instructions: [
          "You are the story director for FableRun, a safe interactive running story.",
          "The runner may propose any fictional action. Acknowledge its intent, but never invent a new exercise, obstacle, speed target, physical risk, or unsafe instruction.",
          "Map the action onto exactly one tested route: rescue_together for reaching the trapped character through the service tunnel, or signal_escape for reaching the flare and calling evacuation.",
          "Write the reply as the named character speaking to the runner, in one or two vivid sentences under 240 characters.",
          "If the request is violent, sexual, self-harming, illegal, impossible, or unsafe, gently transform it into a controlled safe move while keeping the story moving.",
          "Do not mention route IDs, AI, policies, prompts, or workout metrics.",
        ].join(" "),
        input: JSON.stringify({
          runnerAction: input.choiceText,
          characterName: input.relationshipName,
          relationship: input.relationshipLabel,
          currentSituation:
            "The character is trapped beyond a depot. The service tunnel and rooftop evacuation flare are the two validated exits.",
        }),
        text: {
          format: {
            type: "json_schema",
            name: "fablerun_story_choice",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                routeId: {
                  type: "string",
                  enum: ["rescue_together", "signal_escape"],
                },
                reply: { type: "string", minLength: 8, maxLength: 260 },
              },
              required: ["routeId", "reply"],
            },
          },
          verbosity: "low",
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const body = (await response.json()) as OpenAIResponseBody;
    const text = outputText(body);
    if (!text) return null;
    const continuation = parseContinuation(text);
    return continuation ? { ...continuation, source: options.source } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return Response.json(
      { ok: false, message: "That choice is too long." },
      { status: 413, headers: { "cache-control": "no-store" } },
    );
  }

  let input: ContinueRequest | null = null;
  try {
    input = parseRequest(await request.json());
  } catch {
    // Invalid JSON is handled by the shared invalid-request response below.
  }
  if (!input) {
    return Response.json(
      { ok: false, message: "Say or type a story choice first." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const fallback = fallbackStoryContinuation(
    input.choiceText,
    input.relationshipName,
  );
  const configuredModel = process.env.OPENAI_STORY_MODEL || DEFAULT_MODEL;
  const gatewayToken = (
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
  )?.trim();
  const openAIKey = process.env.OPENAI_API_KEY?.trim();

  // Vercel supplies a short-lived OIDC token automatically in production. It
  // keeps the app deployable without another long-lived secret and can still
  // route the exact OpenAI model selected above. Direct OpenAI remains the
  // local/non-Vercel path and the finite story bridge is the final fallback.
  const gatewayContinuation = gatewayToken
    ? await continueWithModel(input, {
        endpoint: "https://ai-gateway.vercel.sh/v1/responses",
        token: gatewayToken,
        model: configuredModel.includes("/")
          ? configuredModel
          : `openai/${configuredModel}`,
        source: "gateway",
      })
    : null;
  const openAIContinuation = !gatewayContinuation && openAIKey
    ? await continueWithModel(input, {
        endpoint: "https://api.openai.com/v1/responses",
        token: openAIKey,
        model: configuredModel.replace(/^openai\//, ""),
        source: "openai",
      })
    : null;
  const continuation = gatewayContinuation ?? openAIContinuation ?? fallback;

  return Response.json(
    { ok: true, continuation },
    {
      headers: {
        "cache-control": "no-store",
        "x-story-source": continuation.source,
      },
    },
  );
}
