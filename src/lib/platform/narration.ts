export type NarrationUnavailableReason =
  | "not_configured"
  | "provider_timeout"
  | "provider_error"
  | "browser_unsupported"
  | "playback_blocked";

export interface NarrationUnavailableResponse {
  ok: false;
  status: "unavailable";
  reason: NarrationUnavailableReason;
  message: string;
}
export interface NarrationInvalidResponse {
  ok: false;
  status: "invalid_request";
  message: string;
}

export type NarrationStatus =
  | "idle"
  | "loading"
  | "speaking"
  | "unavailable"
  | "error";

export interface NarrationSpeakOptions {
  /** Prefer ElevenLabs through the server route before browser speech. */
  preferRemote?: boolean;
  /** BCP-47 language used by the browser fallback. */
  lang?: string;
  /** 0.5-2; applied to browser speech synthesis. */
  rate?: number;
  /** 0-2; applied to browser speech synthesis. */
  pitch?: number;
}

export interface NarrationResult {
  source: "elevenlabs" | "browser" | "none";
  ok: boolean;
  reason?: NarrationUnavailableReason;
}

/** Summary returned by the optional, memory-only predictable-line prefetch. */
export interface NarrationPrefetchResult {
  requested: number;
  ready: number;
  unavailable: number;
}
