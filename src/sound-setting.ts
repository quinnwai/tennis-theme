/**
 * Whether the visitor wants sound, kept in browser storage under "site:sound" so that it is remembered from
 * visit to visit and shared by every skin of the homepage (the "site:" prefix is for settings shared that way).
 *
 * There are two settings: on, which plays at one quiet level (a toy cannot know what else is playing on the
 * phone, so a quiet start is the polite one), and off, which is mute. The button flips between them. Nothing is
 * stored until the visitor first presses it, and a missing key means on. Only an explicit "off" has ever meant
 * off, so anything else stored (the earlier "soft", "medium" and "loud", another skin's "on") is read as on.
 * Only the button writes it. Whatever makes a sound reads it first, each time.
 */
export const SOUND_KEY = "site:sound";

export const SOUND_LEVELS = ["on", "off"] as const;

export type SoundSetting = (typeof SOUND_LEVELS)[number];

export const DEFAULT_SOUND: SoundSetting = "on";

/** The setting a stored word means: "off" is off, and anything else is on. */
export function parseSound(stored: string | null): SoundSetting {
  return stored === "off" ? "off" : "on";
}

/** The other setting. */
export function nextSound(level: SoundSetting): SoundSetting {
  return level === "on" ? "off" : "on";
}

/**
 * Storage can be blocked: some browsers throw at the mere mention of it, others when asked to keep something.
 * Then the page runs on without it: the button still steps on screen, but nothing is kept and this reads as the default.
 */
export function readSound(): SoundSetting {
  try {
    return parseSound(localStorage.getItem(SOUND_KEY));
  } catch {
    return DEFAULT_SOUND;
  }
}

export function writeSound(setting: SoundSetting): void {
  try {
    localStorage.setItem(SOUND_KEY, setting);
  } catch {
    // Nothing is kept: see above.
  }
}
