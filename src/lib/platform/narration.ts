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

export type NarrationVoiceRole =
  | "narrator"
  | "character_female"
  | "character_male";

export interface NarrationLine {
  text: string;
  voice?: NarrationVoiceRole;
}

export interface NarrationSpeakOptions {
  /** Prefer ElevenLabs through the server route before browser speech. */
  preferRemote?: boolean;
  /** BCP-47 language used by the browser fallback. */
  lang?: string;
  /** 0.5-2; applied to browser speech synthesis. */
  rate?: number;
  /** 0-2; applied to browser speech synthesis. */
  pitch?: number;
  /** Server-mapped cast voice; no provider voice ID is exposed to the client. */
  voice?: NarrationVoiceRole;
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
