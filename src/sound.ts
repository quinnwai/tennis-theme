import { params, type Params } from "./params";
import { SOUND_KEY, parseSound, type SoundSetting } from "./sound-setting"; // where the browser keeps how loud the visitor wants the sound, which the sound button writes

/** The five things that make a sound. */
export type SoundName = "hit" | "bounce" | "rising" | "out" | "applause" | "zipper" | "paper";

const NAMES: SoundName[] = ["hit", "bounce", "rising", "out", "applause", "zipper", "paper"];

/**
 * The files, and the stretch of each that is worth playing, in seconds. Addresses are relative to the page so
 * that the site works from a sub-path, and the files sit in the skin's own folder, like everything else the
 * build ships. Both files from Pixabay open with 1105 samples of silence, which is what a common mp3 encoder
 * adds and the browser's decoder does not take off again; skipping it is skipping a lag of 23 ms on the hit and
 * 46 ms on the bounce. The last 3 seconds of the hit are silence too, so it stops early.
 */
export const SOUNDS: Record<SoundName, { file: string; from: number; to?: number; fadeAt?: number }> = {
  hit: { file: "./tennis/sounds/soundreality-tennis-ball-hit-151257.mp3", from: 1105 / 48000, to: 0.85 },
  bounce: { file: "./tennis/sounds/freesound_community-tennisball-44184-bounce.mp3", from: 1105 / 24000 },
  rising: { file: "./tennis/sounds/rising-2-suction-pop-freesound-523687.mp3", from: 0 },
  out: { file: "./tennis/sounds/out-1-soft-whoosh-freesound-682473.mp3", from: 0 },
  // A point's applause (freesound 57587, CC0): a stadium crowd, faded out from 2.6 s so that it ends at 3.2 s.
  applause: { file: "./tennis/sounds/applause-freesound-57587.mp3", from: 0, to: 3.2, fadeAt: 2.6 },
  // The bag's zip (freesound 256404, CC0): one even pull, 0.73 s. Scrubbed, not played through (see `Sound.zipper`).
  // These two files carry the encoder's own note of its delay, so the browser has already taken it off: they are played from 0.
  zipper: { file: "./tennis/sounds/zipper-freesound-256404.mp3", from: 0 },
  // The notebook's page turn (freesound 346835, CC0): soft, 0.36 s.
  paper: { file: "./tennis/sounds/paper-freesound-346835.mp3", from: 0 },
};

/**
 * The win's cheer (Quinn-Wai's own, `successful-event.wav`, 3 s). It is not one of the sounds above: nothing fetches it until the game is
 * found (`Sound.preload`), since most visitors never get that far.
 */
const CHEER = { file: "./tennis/sounds/successful-event.wav", from: 0 };
type Playable = SoundName | "cheer";
const spec = (name: Playable): { file: string; from: number; to?: number; fadeAt?: number } => (name === "cheer" ? CHEER : SOUNDS[name]);

const VOLUME: Record<Playable, keyof Params> = {
  cheer: "cheerVolume",
  hit: "soundHit",
  bounce: "soundBounce",
  rising: "soundRising",
  out: "soundOut",
  applause: "soundApplause",
  zipper: "soundZipper",
  paper: "soundPaper",
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
 * Whether the visitor has switched sound off. Only an explicit "off" counts: nothing stored yet means on,
 * and so does a browser that will not say (storage can be blocked). `read` gives what is stored under `SOUND_KEY`.
 */
export function isMuted(read: () => string | null): boolean {
  try {
    return parseSound(read()) === "off";
  } catch {
    return false;
  }
}

/**
 * What every sound is multiplied by: nothing when off, and `soundGain` (the quiet level the volumes in the settings
 * are played at) when on.
 */
export function levelGain(level: SoundSetting): number {
  return level === "off" ? 0 : params.soundGain;
}

/** What the level stored under `SOUND_KEY` multiplies sounds by; a browser that will not say gets on's. */
function storedGain(read: () => string | null): number {
  try {
    return levelGain(parseSound(read()));
  } catch {
    return levelGain(parseSound(null));
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
  readonly gain: {
    value: number;
    setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
    setValueAtTime?(value: number, startTime: number): unknown;
    cancelScheduledValues?(startTime: number): unknown;
  };
}

export interface CompressorLike extends AudioNodeLike {
  readonly threshold: { value: number };
  readonly knee: { value: number };
  readonly ratio: { value: number };
  readonly attack: { value: number };
  readonly release: { value: number };
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  readonly playbackRate?: { value: number };
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
  createDynamicsCompressor(): CompressorLike;
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
  /** What a sound is multiplied by at the level the visitor has chosen (see `levelGain`). Asked every time a sound is about to play. */
  gain(): number;
}

/**
 * On an iPhone, Web Audio counts as "ambient" sound by default and is silenced by the ring/silent switch, which
 * is how a toy can be perfectly quiet on a phone that is otherwise fine. Safari 16.4 and later let a page say
 * its audio is "playback", which the switch does not mute. Other browsers have no `audioSession`, and ignore this.
 */
export function playThroughSilentSwitch(nav: { audioSession?: { type: string } }): void {
  try {
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    // An older or stricter browser: the switch keeps its say.
  }
}

export function browserEnv(): SoundEnv {
  // Decoded by a context that only decodes: unlike the one that plays, it is allowed to exist before the
  // visitor has done anything, and what it makes plays through any context.
  let decoder: OfflineAudioContext | undefined;
  return {
    createContext: () => {
      playThroughSilentSwitch(navigator as unknown as { audioSession?: { type: string } });
      return new AudioContext();
    },
    load: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return response.arrayBuffer();
    },
    decode: (data) => (decoder ??= new OfflineAudioContext(2, 1, 44100)).decodeAudioData(data),
    muted: () => isMuted(() => localStorage.getItem(SOUND_KEY)),
    gain: () => storedGain(() => localStorage.getItem(SOUND_KEY)),
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

/**
 * What every sound passes through on the way to the speaker: a limiter, which only acts when several sounds pile
 * up past full scale. There is no tone filter. An analysis of the files showed the hit's energy sits at 0.5 to 2 kHz,
 * not in the highs, so cutting the highs changed nothing audible, and the first version's filter was dropped.
 */
function buildMaster(ctx: AudioContextLike) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;
  limiter.connect(ctx.destination);
  return { input: limiter as AudioNodeLike };
}

/** The playback rates the zipper's scrub is held to, and how far (seconds) its playhead may stray from the pull before a new voice starts. */
const ZIP_RATE = [0.5, 2] as const;
const ZIP_DRIFT = 0.12;
/** How long, seconds, the zipper goes on after the pull's last move: the 50 ms it may take to stop, less the fade's three time constants. */
const ZIP_HOLD = 0.03;

/** A sound that is playing: when it ends, and how to cut it short. */
interface Voice {
  endsAt: number;
  cut(now: number): void;
}

/**
 * The toy's sounds. Each one answers something the visitor did, and the page asks for it with `play` or
 * `bounce`. Nothing is heard before the visitor has done something on the page, or while sound is switched
 * off, and no more than `soundMaxVoices` sounds of the patter play at once (the kept sounds are never one of them, and never cut short), so a court full of balls is a patter and not
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
  /** Where every sound goes on its way out: the limiter (see `buildMaster`). */
  private master: { input: AudioNodeLike } | null = null;
  private buffers = new Map<Playable, AudioBufferLike>();
  private loading = new Set<Playable>();
  /** The patter: the sounds that share `soundMaxVoices` places, and give way to each other. */
  private voices: Voice[] = [];
  /** The zipper's voice, while the pull is moving (see `zipper`), and where the pull was last heard. */
  private zipVoice: { source: BufferSourceLike; gain: GainNodeLike; dir: 1 | -1; offset: number; at: number; rate: number; volume: number } | null = null;
  private zipLast = { pos: 0, ms: 0 };
  /** When the longest kept sound ends, on the context's clock, so that the audio is not put to sleep inside it. */
  private keptEndsAt = 0;

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
      const ctx = env.createContext();
      this.master = buildMaster(ctx);
      this.ctx = ctx;
      // A browser that lets audio start by itself starts it running; there is nothing to hear yet.
      void ctx.suspend().catch(() => {});
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
    const sleep = () => {
      // Never inside a kept sound, the applause or the cheer: look again when it has ended.
      const left = this.keptEndsAt - ctx.currentTime;
      if (left > 0) {
        this.sleepTimer = setTimeout(sleep, left * 1000);
        return;
      }
      this.asleep = true;
      void ctx.suspend().catch(() => {});
    };
    this.sleepTimer = setTimeout(sleep, SLEEP_AFTER);
  }

  /** Start fetching the cheer, which is not fetched with the rest. Safe to call again and again. */
  preload(name: "cheer"): void {
    if (this.loading.has(name)) return;
    this.loading.add(name);
    this.env
      .load(spec(name).file)
      .then((data) => this.env.decode(data))
      .then((buffer) => void this.buffers.set(name, buffer))
      .catch((error) => console.warn(`The "${name}" sound could not be loaded.`, error));
  }

  /**
   * Play a sound at `loudness` (0 to 1) of its own volume. `kept`: it answers one deliberate action (a can's pop on a pour, the zipper,
   * the paper), so it is never cut short and does not count toward `soundMaxVoices`. The hit, the applause and the cheer are always kept.
   */
  play(name: Playable, loudness = 1, kept = false): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(name);
    if (!this.interacted || !ctx || !buffer || this.env.muted()) return;
    const volume = Math.min(1, loudness * params[VOLUME[name]] * this.env.gain());
    const { from, to } = spec(name);
    const length = Math.min(to ?? Infinity, buffer.duration) - from;
    if (!(volume > 0 && length > 0)) return;

    this.wake();
    const now = ctx.currentTime;
    this.voices = this.voices.filter((voice) => voice.endsAt > now);
    const isKept = kept || name === "hit" || name === "applause" || name === "cheer"; // never interrupted, and not counted in the most sounds at once
    if (!isKept && ctx.state !== "running" && this.voices.length >= WHILE_WAKING) return;
    try {
      // Make room for this one: the oldest sounds, the nearest to finished, give way. A kept sound needs no room.
      const room = Math.max(1, Math.floor(params.soundMaxVoices));
      while (!isKept && this.voices.length >= room) this.voices.shift()!.cut(now);

      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(this.master!.input);
      source.start(now, from, length);
      const fadeAt = spec(name).fadeAt;
      if (fadeAt !== undefined && fadeAt - from < length) gain.gain.setTargetAtTime(0, now + fadeAt - from, 0.15);
      if (isKept) {
        this.keptEndsAt = Math.max(this.keptEndsAt, now + length); // never one of the voices that can give way, nor cut short
        return;
      }
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

  /**
   * The bag's zip moved to `pos` (0 shut, 1 open): the zipper rasps while it moves and stops within about 50 ms of its stopping. The file is
   * one even pull and does not loop, so it is scrubbed: the voice starts at the offset of the pull's position (opening) or of its mirror
   * (closing; the file always plays forward), at a rate that follows the pull's speed (a whole pull in the file's length is rate 1, clamped to
   * `ZIP_RATE`). Each move pushes the fade-out back to `hold` seconds on, so a pull that stops falls silent by itself. A voice is started
   * afresh when the direction turns, when the sound has run out, or when it has drifted from the pull. A kept sound (never cut, not counted).
   */
  zipper(pos: number, hold = ZIP_HOLD): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get("zipper");
    const ms = performance.now();
    const last = this.zipLast;
    this.zipLast = { pos, ms };
    if (!this.interacted || !ctx || !buffer || this.env.muted() || pos === last.pos) return;
    const volume = Math.min(1, params.soundZipper * this.env.gain());
    const length = buffer.duration;
    if (!(volume > 0 && length > 0)) return;
    const dir = pos > last.pos ? 1 : -1;
    const seconds = (ms - last.ms) / 1000;
    const rate = seconds > 0 && seconds < 0.2 ? Math.min(ZIP_RATE[1], Math.max(ZIP_RATE[0], (Math.abs(pos - last.pos) / seconds) * length)) : 1;
    const offset = Math.min(length - 0.02, Math.max(0, (dir > 0 ? pos : 1 - pos) * length));

    this.wake();
    const now = ctx.currentTime;
    let voice = this.zipVoice;
    if (voice) {
      const playhead = voice.offset + (now - voice.at) * voice.rate;
      if (voice.dir !== dir || playhead >= length - 0.02 || Math.abs(playhead - offset) > ZIP_DRIFT) {
        this.stopZipper(0.01);
        voice = null;
      } else {
        voice.offset = playhead;
        voice.at = now;
        voice.rate = rate;
        if (voice.source.playbackRate) voice.source.playbackRate.value = rate;
      }
    }
    try {
      if (!voice) {
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = buffer;
        gain.gain.value = volume;
        if (source.playbackRate) source.playbackRate.value = rate;
        source.connect(gain);
        gain.connect(this.master!.input);
        source.start(now, offset, length - offset);
        voice = this.zipVoice = { source, gain, dir, offset, at: now, rate, volume };
      }
      this.keptEndsAt = Math.max(this.keptEndsAt, now + hold + 0.1);
      this.fadeZipper(voice, now + hold, 0.01);
    } catch (error) {
      console.warn("The sound broke, and is switched off.", error);
      this.ctx = null;
    }
  }

  /** Let the zipper fall silent, `after` seconds from now (at once if the pull has just stopped, as a run of the zip has ended). */
  stopZipper(after = 0.03): void {
    const voice = this.zipVoice;
    if (!voice || !this.ctx) return;
    this.zipVoice = null;
    const now = this.ctx.currentTime;
    this.fadeZipper(voice, now + after, 0.01);
    voice.source.stop(now + after + 0.05);
  }

  private fadeZipper(voice: { gain: GainNodeLike; volume: number }, at: number, timeConstant: number): void {
    const param = voice.gain.gain;
    if (param.cancelScheduledValues && param.setValueAtTime) {
      param.cancelScheduledValues(0);
      param.setValueAtTime(voice.volume, this.ctx!.currentTime);
    }
    param.setTargetAtTime(0, at, timeConstant);
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
