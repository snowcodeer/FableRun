import { createHash } from "node:crypto";

import type {
  NarrationInvalidResponse,
  NarrationUnavailableReason,
  NarrationUnavailableResponse,
} from "@/lib/platform/narration";

export const runtime = "nodejs";

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const MAX_TEXT_LENGTH = 800;
const MAX_REQUEST_BYTES = 4_096;
const PROVIDER_TIMEOUT_MS = 8_000;
const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{5,64}$/;
const CACHE_TTL_MS = 15 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 48;
const MAX_CACHE_BYTES = 16 * 1_024 * 1_024;

interface CachedNarration {
  audio: ArrayBuffer;
  contentType: string;
  expiresAt: number;
}

interface ProviderNarration {
  ok: true;
  audio: ArrayBuffer;
  contentType: string;
}

interface ProviderUnavailable {
  ok: false;
  reason: "provider_timeout" | "provider_error";
}

type ProviderResult = ProviderNarration | ProviderUnavailable;

// Best-effort warm-instance cache. It is bounded, ephemeral, and keyed by a
// one-way digest rather than storing narration text or any user data as a key.
const narrationCache = new Map<string, CachedNarration>();
const inFlightNarrations = new Map<string, Promise<ProviderResult>>();
let narrationCacheBytes = 0;

interface NarrationRequest {
  text: string;
  voiceId?: string;
}

type VoiceSource = "configured" | "fallback" | "override";

function jsonUnavailable(
  reason: NarrationUnavailableReason,
  message: string,
  status = 503,
): Response {
  const body: NarrationUnavailableResponse = {
    ok: false,
    status: "unavailable",
    reason,
    message,
  };
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function jsonInvalid(message: string): Response {
  const body: NarrationInvalidResponse = {
    ok: false,
    status: "invalid_request",
    message,
  };
  return Response.json(body, {
    status: 400,
    headers: { "cache-control": "no-store" },
  });
}

function parseRequest(value: unknown): NarrationRequest | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.text !== "string") return null;
  if (
    candidate.voiceId !== undefined &&
    typeof candidate.voiceId !== "string"
  ) {
    return null;
  }
  return {
    text: candidate.text.trim(),
    voiceId: candidate.voiceId,
  };
}

function narrationKey(text: string, voiceId: string): string {
  return createHash("sha256")
    .update("eleven_multilingual_v2\0")
    .update(voiceId)
    .update("\0")
    .update(text)
    .digest("hex");
}

function getCachedNarration(key: string): CachedNarration | null {
  const cached = narrationCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    narrationCache.delete(key);
    narrationCacheBytes -= cached.audio.byteLength;
    return null;
  }

  // Map insertion order doubles as a tiny LRU queue.
  narrationCache.delete(key);
  narrationCache.set(key, cached);
  return cached;
}

function cacheNarration(
  key: string,
  audio: ArrayBuffer,
  contentType: string,
): void {
  if (audio.byteLength > MAX_CACHE_BYTES) return;
  const existing = narrationCache.get(key);
  if (existing) narrationCacheBytes -= existing.audio.byteLength;
  narrationCache.delete(key);

  narrationCache.set(key, {
    audio,
    contentType,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  narrationCacheBytes += audio.byteLength;

  while (
    narrationCache.size > MAX_CACHE_ENTRIES ||
    narrationCacheBytes > MAX_CACHE_BYTES
  ) {
    const oldestKey = narrationCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = narrationCache.get(oldestKey);
    narrationCache.delete(oldestKey);
    narrationCacheBytes -= oldest?.audio.byteLength ?? 0;
  }
}

function audioResponse(
  cached: Pick<CachedNarration, "audio" | "contentType">,
  cacheStatus: "hit" | "miss" | "coalesced",
  voiceSource: VoiceSource,
): Response {
  // Slice so each Response owns an independent, immutable body view.
  const audio = cached.audio.slice(0);
  return new Response(audio, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-length": String(audio.byteLength),
      "content-type": cached.contentType,
      "x-content-type-options": "nosniff",
      "x-narration-cache": cacheStatus,
      "x-narration-voice": voiceSource,
    },
  });
}

async function requestProviderNarration(
  text: string,
  voiceId: string,
  apiKey: string,
): Promise<ProviderResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const providerResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          accept: "audio/mpeg",
          "content-type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.48,
            similarity_boost: 0.72,
            style: 0.2,
            use_speaker_boost: true,
          },
        }),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!providerResponse.ok) return { ok: false, reason: "provider_error" };
    const contentType = providerResponse.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("audio/")) {
      return { ok: false, reason: "provider_error" };
    }

    const audio = await providerResponse.arrayBuffer();
    if (audio.byteLength === 0) return { ok: false, reason: "provider_error" };
    return { ok: true, audio, contentType };
  } catch (providerError) {
    const timedOut =
      providerError instanceof Error && providerError.name === "AbortError";
    return {
      ok: false,
      reason: timedOut ? "provider_timeout" : "provider_error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonInvalid("Narration request is too large.");
  }

  let payload: NarrationRequest | null = null;
  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_REQUEST_BYTES) {
      return jsonInvalid("Narration request is too large.");
    }
    payload = parseRequest(JSON.parse(rawBody) as unknown);
  } catch {
    return jsonInvalid("Request body must be valid JSON.");
  }

  if (!payload) return jsonInvalid("A text string is required.");
  if (!payload.text) return jsonInvalid("Narration text cannot be empty.");
  if (payload.text.length > MAX_TEXT_LENGTH) {
    return jsonInvalid(`Narration text cannot exceed ${MAX_TEXT_LENGTH} characters.`);
  }

  const configuredVoiceId = process.env.ELEVENLABS_VOICE_ID;
  const voiceId = payload.voiceId ?? configuredVoiceId ?? DEFAULT_VOICE_ID;
  const voiceSource: VoiceSource = payload.voiceId
    ? "override"
    : configuredVoiceId
      ? "configured"
      : "fallback";
  if (!VOICE_ID_PATTERN.test(voiceId)) {
    return jsonInvalid("The voice identifier is invalid.");
  }

  // This unprefixed variable is read only in the Node route and never returned.
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return jsonUnavailable(
      "not_configured",
      "Remote narration is not configured; use browser narration.",
    );
  }

  const key = narrationKey(payload.text, voiceId);
  const cached = getCachedNarration(key);
  if (cached) return audioResponse(cached, "hit", voiceSource);

  const existingRequest = inFlightNarrations.get(key);
  const cacheStatus = existingRequest ? "coalesced" : "miss";
  const providerRequest =
    existingRequest ?? requestProviderNarration(payload.text, voiceId, apiKey);
  if (!existingRequest) inFlightNarrations.set(key, providerRequest);

  try {
    const result = await providerRequest;
    if (result.ok) {
      cacheNarration(key, result.audio, result.contentType);
      return audioResponse(result, cacheStatus, voiceSource);
    }

    return jsonUnavailable(
      result.reason,
      result.reason === "provider_timeout"
        ? "Remote narration timed out; use browser narration."
        : "Remote narration is temporarily unavailable; use browser narration.",
    );
  } finally {
    if (!existingRequest && inFlightNarrations.get(key) === providerRequest) {
      inFlightNarrations.delete(key);
    }
  }
}
