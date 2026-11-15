import { params, type Params } from "./params";

/** The four things that make a sound. */
export type SoundName = "hit" | "bounce" | "rising" | "out";

const NAMES: SoundName[] = ["hit", "bounce", "rising", "out"];

/** Where the browser keeps whether the visitor has sound on. Shared by every skin of the homepage; the sound toggle writes it. */
export const SOUND_KEY = "site:sound";

/**
 * The files, and the stretch of each that is worth playing, in seconds. Addresses are relative to the page so
 * that the site works from a sub-path, and the files sit in the skin's own folder, like everything else the
 * build ships. Both files from Pixabay open with 1105 samples of silence, which is what a common mp3 encoder
 * adds and the browser's decoder does not take off again; skipping it is skipping a lag of 23 ms on the hit and
 * 46 ms on the bounce. The last 3 seconds of the hit are silence too, so it stops early.
 */
export const SOUNDS: Record<SoundName, { file: string; from: number; to?: number }> = {
  hit: { file: "./tennis/sounds/soundreality-tennis-ball-hit-151257.mp3", from: 1105 / 48000, to: 0.85 },
  bounce: { file: "./tennis/sounds/freesound_community-tennisball-44184-bounce.mp3", from: 1105 / 24000 },
  rising: { file: "./tennis/sounds/rising-2-suction-pop-freesound-523687.mp3", from: 0 },
  out: { file: "./tennis/sounds/out-1-soft-whoosh-freesound-682473.mp3", from: 0 },
};

const VOLUME: Record<SoundName, keyof Params> = {
  hit: "soundHit",
  bounce: "soundBounce",
  rising: "soundRising",
  out: "soundOut",
};

/**
 * How loud a bounce is for an impact at `speed` m/s, from 0 (silent) to 1 (as loud as the bounce plays).
 * A gentle contact, such as a ball settling or resting, makes no sound; above that the sound gets louder in
 * step with the speed, up to the speed of a full-volume bounce.
 */
export function bounceLoudness(speed: number): number {
  if (speed < params.soundBounceMinSpeed) return 0;
  return Math.min(1, speed / params.soundBounceFullSpeed);
}

/**
 * Whether the visitor has switched sound off. Only an explicit "off" counts: nothing stored yet means on, and
 * so does a browser that will not say (storage can be blocked). `read` gives what is stored under `SOUND_KEY`.
 */
export function isMuted(read: () => string | null): boolean {
  try {
    return read() === "off";
  } catch {
    return false;
  }
}

// ---- The browser, as little of it as the rules below need ----

export interface AudioBufferLike {
  readonly duration: number;
}

export interface AudioNodeLike {
  connect(to: AudioNodeLike): unknown;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: { value: number; setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown };
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  start(when: number, offset: number, duration: number): void;
  stop(when: number): void;
}

/** The part of the Web Audio context that this file uses. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: AudioNodeLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  createGain(): GainNodeLike;
  createBufferSource(): BufferSourceLike;
}

/** What `Sound` takes from the browser, kept apart so that its rules can be tested without one. */
export interface SoundEnv {
  /** Make the audio context. */
  createContext(): AudioContextLike;
  /** The bytes of a sound file. */
  load(url: string): Promise<ArrayBuffer>;
  /** Turn a file's bytes into sound that can be played. Needs no gesture from the visitor, so it can be done at once. */
  decode(data: ArrayBuffer): Promise<AudioBufferLike>;
  /** Whether the visitor has sound switched off. Asked every time a sound is about to play. */
  muted(): boolean;
}

export function browserEnv(): SoundEnv {
  // Decoded by a context that only decodes: unlike the one that plays, it is allowed to exist before the
  // visitor has done anything, and what it makes plays through any context.
  let decoder: OfflineAudioContext | undefined;
  return {
    createContext: () => new AudioContext(),
    load: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return response.arrayBuffer();
    },
    decode: (data) => (decoder ??= new OfflineAudioContext(2, 1, 44100)).decodeAudioData(data),
    muted: () => isMuted(() => localStorage.getItem(SOUND_KEY)),
  };
}

/**
 * How long the audio stays awake with nothing happening, in milliseconds. A context that is awake keeps a
 * thread running, even in silence, so it is put to sleep when the toy has been left alone. Longer than the
 * longest sound, so that nothing is cut off.
 */
const SLEEP_AFTER = 3000;

/**
 * How many sounds may be started while the audio is still waking up. Nothing runs until it has woken, which
 * takes a few milliseconds, and everything asked for in that time starts together once it does; if the
 * wake-up stalls, as when a phone call has taken the audio, the rest would pile up behind it.
 */
const WHILE_WAKING = 2;

/** A sound that is playing: when it ends, and how to cut it short. */
interface Voice {
  endsAt: number;
  cut(now: number): void;
}

/**
 * The toy's sounds. Each one answers something the visitor did, and the page asks for it with `play` or
 * `bounce`. Nothing is heard before the visitor has done something on the page, or while sound is switched
 * off, and no more than `soundMaxVoices` sounds play at once, so a court full of balls is a patter and not
 * a wall of noise.
 */
export class Sound {
  /**
   * The audio context, made as soon as there is a `Sound`, so that the slow part is over before anyone
   * presses anything: the first context in a browser can take a tenth of a second or more of the page's one
   * thread, and a stall like that in the middle of a press makes a tap last as long as a hold. It is then
   * kept asleep, woken by the visitor's gestures and by sounds, and put back to sleep when nothing has
   * happened for a while (see `SLEEP_AFTER`).
   */
  private ctx: AudioContextLike | null = null;
  /** Whether the visitor has done anything on the page yet. */
  private interacted = false;
  /**
   * Whether this class has left the audio asleep. The context's own `state` only changes a moment after a
   * call to `resume` or `suspend`, so a sound asked for in that moment would otherwise find it still
   * "running" and be started on a context that is about to sleep.
   */
  private asleep = true;
  private sleepTimer: ReturnType<typeof setTimeout> | undefined;
  private buffers = new Map<SoundName, AudioBufferLike>();
  private voices: Voice[] = [];

  /**
   * Makes the context, and starts fetching and decoding the files so that they are ready when the visitor
   * first does something.
   */
  constructor(private env: SoundEnv) {
    // The fetching goes on while the context is made, which blocks the page for a moment.
    for (const name of NAMES) {
      env
        .load(SOUNDS[name].file)
        .then((data) => env.decode(data))
        .then((buffer) => void this.buffers.set(name, buffer))
        .catch((error) => console.warn(`The "${name}" sound could not be loaded.`, error));
    }
    try {
      this.ctx = env.createContext();
      // A browser that lets audio start by itself starts it running; there is nothing to hear yet.
      void this.ctx.suspend().catch(() => {});
    } catch {
      // No Web Audio here: the toy stays quiet.
    }
  }

  /**
   * The visitor has done something on the page. From now on sounds play, and the audio is woken, which a
   * browser only allows from a gesture, unless sound is off: the audio is left asleep for a visitor who
   * does not want it. Cheap, and safe to call again and again.
   */
  interact(): void {
    this.interacted = true;
    if (!this.env.muted()) this.wake();
  }

  /** Wake the audio if it is asleep, and keep it awake for a while longer. */
  private wake(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // The browser may also have put it to sleep itself, as a phone does when a call comes in.
    if (this.asleep || ctx.state !== "running") void ctx.resume().catch(() => {});
    this.asleep = false;
    clearTimeout(this.sleepTimer);
    this.sleepTimer = setTimeout(() => {
      this.asleep = true;
      void ctx.suspend().catch(() => {});
    }, SLEEP_AFTER);
  }

  /** Play a sound at `loudness` (0 to 1) of its own volume. */
  play(name: SoundName, loudness = 1): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(name);
    if (!this.interacted || !ctx || !buffer || this.env.muted()) return;
    const volume = loudness * params[VOLUME[name]];
    const { from, to } = SOUNDS[name];
    const length = Math.min(to ?? Infinity, buffer.duration) - from;
    if (!(volume > 0 && length > 0)) return;

    this.wake();
    const now = ctx.currentTime;
    this.voices = this.voices.filter((voice) => voice.endsAt > now);
    if (ctx.state !== "running" && this.voices.length >= WHILE_WAKING) return;
    try {
      // Make room for this one: the oldest sounds, the nearest to finished, give way.
      const room = Math.max(1, Math.floor(params.soundMaxVoices));
      while (this.voices.length >= room) this.voices.shift()!.cut(now);

      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(now, from, length);
      this.voices.push({
        endsAt: now + length,
        cut(at) {
          gain.gain.setTargetAtTime(0, at, 0.01); // a quick fade, so that cutting a sound short does not click
          source.stop(at + 0.05);
        },
      });
    } catch (error) {
      // A sound must never take the toy down with it, and a context that cannot make one will not start to.
      console.warn("The sound broke, and is switched off.", error);
      this.ctx = null;
    }
  }

  /** A ball struck something at `speed` m/s. */
  bounce(speed: number): void {
    const loudness = bounceLoudness(speed);
    if (loudness > 0) this.play("bounce", loudness);
  }
}

/**
 * Wake the sound on the visitor's gestures. Browsers differ in which gesture counts, so every kind that any
 * of them counts is listened for. Pressing is not one of them everywhere (on a phone only letting go
 * counts), and the audio has no business starting while a press is still being judged to be a tap or a hold.
 */
export function wakeOnGesture(sound: Sound, target: EventTarget): void {
  for (const type of ["pointerup", "touchend", "click", "keydown"]) {
    target.addEventListener(type, () => sound.interact(), { capture: true, passive: true });
  }
}
