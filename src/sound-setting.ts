/**
 * How loud the visitor wants the sound, kept in browser storage under "site:sound" so that it is remembered from
 * visit to visit and shared by every skin of the homepage (the "site:" prefix is for settings shared that way).
 *
 * There are four levels, which the sound button steps through in this order. Nothing is stored until the visitor
 * first presses the button, and a missing key means `DEFAULT_SOUND`: soft, because a toy cannot know how loud the
 * phone is turned up or what else is playing, and a quiet start is the polite one. The earlier skins stored only
 * "on" and "off", and a skin that has not been taught the levels still does, so "on" is read as the default level;
 * "off" has always meant off. Anything else stored is read as the default level too. Only the button writes it.
 * Whatever makes a sound reads it first, each time.
 */
export const SOUND_KEY = "site:sound";

export const SOUND_LEVELS = ["off", "soft", "medium", "loud"] as const;

export type SoundSetting = (typeof SOUND_LEVELS)[number];

export const DEFAULT_SOUND: SoundSetting = "soft";

/** The level a stored word means. */
export function parseSound(stored: string | null): SoundSetting {
  return (SOUND_LEVELS as readonly string[]).includes(stored ?? "") ? (stored as SoundSetting) : DEFAULT_SOUND;
}

/** The level after this one, in the order the button steps through them, wrapping from loud to off. */
export function nextSound(level: SoundSetting): SoundSetting {
  return SOUND_LEVELS[(SOUND_LEVELS.indexOf(level) + 1) % SOUND_LEVELS.length];
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
