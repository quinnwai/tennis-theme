/**
 * Whether the visitor wants sound, kept in browser storage under "site:sound" so that it is remembered from visit
 * to visit and shared by every skin of the homepage (the "site:" prefix is for settings shared that way).
 *
 * The value is "on" or "off". Nothing is stored until the visitor flips the sound toggle, so a missing key means on;
 * so does any other value. Only the toggle writes it. Whatever makes a sound reads it first, each time.
 */
export const SOUND_KEY = "site:sound";

export type SoundSetting = "on" | "off";

/**
 * Storage can be blocked: some browsers throw at the mere mention of it, others when asked to keep something.
 * Then the page runs on without it: the toggle still flips on screen, but nothing is kept and this reads as on.
 */
export function readSound(): SoundSetting {
  try {
    return localStorage.getItem(SOUND_KEY) === "off" ? "off" : "on";
  } catch {
    return "on";
  }
}

export function writeSound(setting: SoundSetting): void {
  try {
    localStorage.setItem(SOUND_KEY, setting);
  } catch {
    // Nothing is kept: see above.
  }
}
