/**
 * Shared AudioContext — created during user gesture to satisfy autoplay policy.
 *
 * Problem: AudioWaveSphere creates new AudioContext in a WebSocket callback
 * ~11s after user gesture → starts suspended → resume() fails silently.
 *
 * Solution: Create/resume this shared context during the user gesture (in
 * unlockAudio()), then reuse it in AudioWaveSphere. Once an AudioContext
 * has been running during a user gesture, it stays usable.
 */

let _ctx: AudioContext | null = null;

/** Get or create the shared AudioContext. Call during user gesture for best results. */
export function getSharedAudioContext(): AudioContext {
  if (!_ctx) {
    _ctx = new AudioContext();
  }
  return _ctx;
}

/** Resume the shared context if suspended. Safe to call anytime; best during user gesture. */
export function unlockSharedAudio(): void {
  const ctx = getSharedAudioContext();
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

/** Check if the shared context is running. */
export function isAudioUnlocked(): boolean {
  return _ctx !== null && _ctx.state === "running";
}
