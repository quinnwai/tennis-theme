import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { params } from "./params";
import {
  Sound,
  SOUNDS,
  bounceLoudness,
  isMuted,
  playThroughSilentSwitch,
  wakeOnGesture,
  type AudioContextLike,
  type AudioNodeLike,
  type BufferSourceLike,
  type GainNodeLike,
  type SoundName,
} from "./sound";

const defaults = { ...params };

// The audio puts itself to sleep when nothing has happened for a while, so time is the tests' to move.
beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  Object.assign(params, defaults);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const NAMES = Object.keys(SOUNDS) as SoundName[];
/** How long each file is, as a browser's decoder reports it. */
const LENGTH: Record<SoundName, number> = { hit: 4.032, bounce: 0.888, rising: 0.189, out: 0.708 };
const nameOf = (file: string) => NAMES.find((name) => SOUNDS[name].file === file)!;
/** Let everything that is waiting on a promise run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

interface Decoded {
  duration: number;
  name: SoundName;
}

interface FakeGain extends GainNodeLike {
  /** When its volume was told to fade out, if it was. */
  fadedAt?: number;
}

/** A sound the page asked the audio to start. */
interface Started {
  name: SoundName;
  at: number;
  offset: number;
  duration: number;
  volume: number;
  gain: FakeGain;
  /** When it was told to stop, if it was cut short. */
  stoppedAt?: number;
}

/**
 * A stand-in for the browser's audio that writes down what it is asked to do. A file's "bytes" are its own
 * address, which is how a fake decoder knows which sound it is looking at.
 */
function fakeAudio(
  options: {
    failLoad?: SoundName;
    noAudio?: boolean;
    startAsleep?: boolean;
    /** The context only reports a change of state a moment after it is asked, as a real one does. */
    slowState?: boolean;
    /** Waking the context never finishes, as when a phone call has taken the audio. */
    stuckAsleep?: boolean;
    /** Making a sound throws, as on a context that has been closed. */
    breakNodes?: boolean;
  } = {},
) {
  const state = { now: 0, muted: false, contexts: 0, resumes: 0, suspends: 0, contextState: "running" };
  const loads: string[] = [];
  const started: Started[] = [];

  const context: AudioContextLike = {
    get currentTime() {
      return state.now;
    },
    get state() {
      return state.contextState;
    },
    destination: { connect: () => undefined },
    resume: async () => {
      state.resumes++;
      if (options.stuckAsleep) return new Promise<void>(() => undefined);
      if (options.slowState) await Promise.resolve();
      state.contextState = "running";
    },
    suspend: async () => {
      state.suspends++;
      if (options.slowState) await Promise.resolve();
      state.contextState = "suspended";
    },
    createGain: () => {
      const gain: FakeGain = {
        gain: {
          value: 1,
          setTargetAtTime: (_target, at) => {
            gain.fadedAt = at;
          },
        },
        connect: () => undefined,
      };
      return gain;
    },
    createBufferSource: () => {
      if (options.breakNodes) throw new Error("Cannot create a node on a closed context");
      let entry: Started | undefined;
      let into: FakeGain | undefined;
      const source: BufferSourceLike & { buffer: Decoded | null } = {
        buffer: null,
        connect(to: AudioNodeLike) {
          into = to as FakeGain;
        },
        start(at, offset, duration) {
          entry = { name: source.buffer!.name, at, offset, duration, volume: into!.gain.value, gain: into! };
          started.push(entry);
        },
        stop(at) {
          entry!.stoppedAt = at;
        },
      };
      return source;
    },
  };

  const env = {
    createContext: () => {
      if (options.noAudio) throw new Error("no Web Audio here");
      state.contexts++;
      state.contextState = options.startAsleep ? "suspended" : "running";
      return context;
    },
    load: async (url: string) => {
      loads.push(url);
      if (options.failLoad && SOUNDS[options.failLoad].file === url) throw new Error("not found");
      return new TextEncoder().encode(url).buffer as ArrayBuffer;
    },
    decode: async (data: ArrayBuffer) => {
      const name = nameOf(new TextDecoder().decode(data));
      return { duration: LENGTH[name], name } satisfies Decoded;
    },
    muted: () => state.muted,
  };

  /** The sounds that are still playing at the moment: not cut short, not finished. */
  const playing = () => started.filter((s) => s.stoppedAt === undefined && s.at + s.duration > state.now);
  return { env, state, loads, started, playing };
}

/** A sound whose visitor has already done something, with the files ready to play. */
async function awake(options?: Parameters<typeof fakeAudio>[0]) {
  const audio = fakeAudio(options);
  const sound = new Sound(audio.env);
  await settle();
  sound.interact();
  return { ...audio, sound };
}

describe("bounceLoudness", () => {
  it("is silent for a gentle contact, which is what keeps a resting or settling ball quiet", () => {
    expect(bounceLoudness(0)).toBe(0);
    expect(bounceLoudness(0.05)).toBe(0); // what a ball at rest jitters at
    expect(bounceLoudness(params.soundBounceMinSpeed - 0.01)).toBe(0);
    expect(bounceLoudness(params.soundBounceMinSpeed)).toBeGreaterThan(0);
  });

  it("gets louder the harder the impact, in step with its speed, up to the full-volume speed and no further", () => {
    const speeds = [0.5, 1, 2, 3, 4, 5];
    const loudness = speeds.map(bounceLoudness);
    loudness.slice(1).forEach((value, i) => expect(value).toBeGreaterThan(loudness[i]));
    expect(bounceLoudness(params.soundBounceFullSpeed / 2)).toBeCloseTo(0.5);
    expect(bounceLoudness(params.soundBounceFullSpeed)).toBe(1);
    expect(bounceLoudness(params.soundBounceFullSpeed * 3)).toBe(1);
  });

  it("follows the numbers in params, so that the sliders work", () => {
    params.soundBounceMinSpeed = 1.5;
    expect(bounceLoudness(1.4)).toBe(0);
    expect(bounceLoudness(1.5)).toBeGreaterThan(0);
    params.soundBounceFullSpeed = 2;
    expect(bounceLoudness(2)).toBe(1);
  });
});

describe("isMuted", () => {
  it("is on until the visitor says off: nothing stored yet counts as on", () => {
    expect(isMuted(() => null)).toBe(false);
    expect(isMuted(() => "on")).toBe(false);
    expect(isMuted(() => "off")).toBe(true);
  });

  it("is on when the browser will not say what is stored", () => {
    expect(
      isMuted(() => {
        throw new Error("storage is blocked");
      }),
    ).toBe(false);
  });
});

describe("Sound", () => {
  it("has its files fetched and decoded and its audio made by the time it is first needed, but plays nothing until the visitor has done something", async () => {
    // The audio is made at once, so that the slow part is over before the visitor first presses anything.
    const audio = fakeAudio();
    const sound = new Sound(audio.env);
    expect(audio.loads).toEqual(NAMES.map((name) => SOUNDS[name].file));
    expect(audio.state.contexts).toBe(1);
    await settle(); // everything is ready to play, so only the visitor's say-so is missing
    sound.play("hit");
    sound.bounce(5);
    sound.play("rising");
    sound.play("out");
    expect(audio.started).toEqual([]);
    expect(audio.state.resumes).toBe(0); // and not even woken
  });

  it("plays once the visitor has done something, with the audio it made at the start", async () => {
    const audio = fakeAudio();
    const sound = new Sound(audio.env);
    await settle();
    sound.interact();
    sound.interact();
    expect(audio.state.contexts).toBe(1); // a gesture wakes the audio, and does not make more
    sound.play("hit");
    expect(audio.started.map((s) => s.name)).toEqual(["hit"]);
  });

  it("leaves the audio asleep until the visitor does something, and wakes it then", async () => {
    const audio = fakeAudio({ startAsleep: true });
    const sound = new Sound(audio.env);
    await settle();
    expect(audio.state.resumes).toBe(0);
    sound.interact();
    expect(audio.state.resumes).toBe(1);
    expect(audio.state.contextState).toBe("running");
  });

  it("puts audio that a browser started running straight to sleep, since there is nothing to hear yet", async () => {
    const audio = fakeAudio(); // starts running, as where a browser lets pages play at once
    new Sound(audio.env);
    await settle();
    expect(audio.state.suspends).toBe(1);
    expect(audio.state.contextState).toBe("suspended");
  });

  it("wakes the audio for a sound, and puts it back to sleep once nothing has happened for a few seconds", async () => {
    const { sound, state } = await awake();
    expect(state.contextState).toBe("running"); // the gesture woke it
    vi.advanceTimersByTime(2999);
    expect(state.contextState).toBe("running");
    vi.advanceTimersByTime(1);
    expect(state.contextState).toBe("suspended");
    const resumes = state.resumes;
    sound.play("hit"); // a sound wakes it again, with no gesture needed this time
    expect(state.contextState).toBe("running");
    expect(state.resumes).toBe(resumes + 1);
  });

  it("leaves the audio asleep for a visitor who has sound off, and wakes it for the first gesture after they switch it on", () => {
    const audio = fakeAudio({ startAsleep: true });
    const sound = new Sound(audio.env);
    audio.state.muted = true;
    sound.interact();
    sound.interact();
    expect(audio.state.resumes).toBe(0);
    audio.state.muted = false;
    sound.interact();
    expect(audio.state.resumes).toBe(1);
  });

  it("wakes the audio for a sound asked for just after it was put to sleep, before the context has said so", async () => {
    const { sound, state } = await awake({ slowState: true });
    await settle();
    expect(state.contextState).toBe("running");
    vi.advanceTimersByTime(3000); // the audio is told to sleep, and the context still says "running" for a moment
    expect(state.contextState).toBe("running");
    const resumes = state.resumes;
    sound.play("hit");
    expect(state.resumes).toBe(resumes + 1); // so it has to be asked, not trusted, to be awake
  });

  it("starts only a couple of sounds while the audio is waking up, so that they cannot pile up behind a wake-up that stalls", async () => {
    const { sound, started, state } = await awake({ stuckAsleep: true });
    for (let i = 0; i < 6; i++) sound.play("bounce");
    expect(state.contextState).toBe("suspended"); // it never did wake
    expect(started).toHaveLength(2);
  });

  it("never lets a failure in the audio out of a sound: it is switched off with a warning, and the toy carries on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sound, started } = await awake({ breakNodes: true });
    expect(() => sound.play("hit")).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(() => sound.play("hit")).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1); // it does not keep trying, or keep complaining
    expect(started).toEqual([]);
  });

  it("keeps the audio awake for as long as sounds and gestures keep coming", async () => {
    const { sound, state } = await awake();
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(2000); // each is a long time after the last, but not as long as the audio waits...
      sound.play("bounce");
    }
    expect(state.contextState).toBe("running");
    vi.advanceTimersByTime(2000);
    sound.interact(); // ...and so is a gesture
    vi.advanceTimersByTime(2000);
    expect(state.contextState).toBe("running");
    vi.advanceTimersByTime(1000);
    expect(state.contextState).toBe("suspended");
    expect(state.suspends).toBe(2); // once when it was made, once now: never in between
  });

  it.each(NAMES)("plays the %s sound from its own file, skipping the silence the encoder left in front of it", async (name) => {
    const { sound, started } = await awake();
    sound.play(name);
    const { from, to } = SOUNDS[name];
    expect(started).toHaveLength(1);
    expect(started[0].name).toBe(name);
    expect(started[0].offset).toBe(from);
    expect(started[0].offset + started[0].duration).toBeCloseTo(Math.min(to ?? Infinity, LENGTH[name]));
  });

  it("starts the hit and the bounce after the 1105 samples of silence the encoder left, and stops the hit before its silent tail", () => {
    expect(SOUNDS.hit.from).toBeCloseTo(0.023, 3);
    expect(SOUNDS.bounce.from).toBeCloseTo(0.046, 3);
    expect(SOUNDS.rising.from).toBe(0);
    expect(SOUNDS.out.from).toBe(0);
    expect(SOUNDS.hit.to).toBeLessThan(1); // the file is 4 s long
  });

  it("plays each sound at the volume in params, scaled by how loud it was asked for, as the sliders change it", async () => {
    const { sound, started } = await awake();
    sound.play("hit");
    sound.play("hit", 0.5);
    params.soundHit = 0.2;
    sound.play("hit");
    sound.play("rising");
    sound.play("out");
    expect(started.map((s) => s.volume)).toEqual([
      defaults.soundHit,
      defaults.soundHit / 2,
      0.2,
      defaults.soundRising,
      defaults.soundOut,
    ]);
  });

  it("plays no bounce for a soft contact, and some for a hard one", async () => {
    const { sound, started } = await awake();
    sound.bounce(params.soundBounceMinSpeed - 0.01);
    sound.bounce(0.05);
    expect(started).toEqual([]);
    sound.bounce(params.soundBounceMinSpeed);
    expect(started.map((s) => s.name)).toEqual(["bounce"]);
  });

  it("plays a bounce louder the harder the impact, and no louder than the bounce volume", async () => {
    const { sound, started } = await awake();
    for (const speed of [1, 2, 3, 4.5]) sound.bounce(speed);
    sound.bounce(params.soundBounceFullSpeed);
    sound.bounce(params.soundBounceFullSpeed * 10);
    const volumes = started.map((s) => s.volume);
    expect(volumes).toHaveLength(6);
    volumes.slice(1, 5).forEach((volume, i) => expect(volume).toBeGreaterThan(volumes[i]));
    expect(volumes[4]).toBeCloseTo(params.soundBounce);
    expect(volumes[5]).toBeCloseTo(params.soundBounce);
  });

  it("never has more sounds playing at once than soundMaxVoices; the oldest give way, with a quick fade", async () => {
    params.soundMaxVoices = 4;
    const { sound, started, playing, state } = await awake();
    const names: SoundName[] = ["bounce", "hit", "out", "rising", "bounce", "bounce", "hit", "bounce", "out", "bounce"];
    names.forEach((name, i) => {
      state.now = i * 0.001; // all within a hundredth of a second, so none has finished
      sound.play(name);
      expect(playing().length).toBeLessThanOrEqual(4);
    });
    expect(started).toHaveLength(10);
    // The last four asked for are the four still playing.
    expect(playing()).toEqual(started.slice(-4));
    // Each of the others was faded out and then stopped, not cut off dead.
    for (const cut of started.slice(0, 6)) {
      expect(cut.gain.fadedAt).toBeDefined();
      expect(cut.stoppedAt).toBeGreaterThan(cut.gain.fadedAt!);
    }
  });

  it("lets sounds that have finished make room by themselves, cutting nothing", async () => {
    params.soundMaxVoices = 2;
    const { sound, started, state } = await awake();
    sound.play("bounce");
    sound.play("bounce");
    state.now = 5; // both are long over
    sound.play("bounce");
    sound.play("bounce");
    expect(started).toHaveLength(4);
    expect(started.filter((s) => s.stoppedAt !== undefined)).toEqual([]);
  });

  it("is silent while sound is off, for every sound, and speaks again the moment it is on", async () => {
    const { sound, started, state } = await awake();
    state.muted = true;
    for (const name of NAMES) sound.play(name);
    sound.bounce(params.soundBounceFullSpeed);
    expect(started).toEqual([]);
    state.muted = false;
    for (const name of NAMES) sound.play(name);
    expect(started.map((s) => s.name)).toEqual(NAMES);
  });

  it("is silent for a sound whose file has not been turned into sound yet, and plays it as soon as it has", async () => {
    const audio = fakeAudio();
    const sound = new Sound(audio.env);
    sound.interact();
    sound.play("hit"); // too soon: the decoding is still going on
    expect(audio.started).toEqual([]);
    await settle();
    sound.play("hit");
    expect(audio.started).toHaveLength(1);
  });

  it("wakes the audio again on a later gesture if it has gone back to sleep, and otherwise leaves it alone", async () => {
    const audio = fakeAudio({ startAsleep: true });
    const sound = new Sound(audio.env);
    sound.interact();
    sound.interact();
    sound.interact();
    expect(audio.state.resumes).toBe(1); // awake after the first, and left alone
    audio.state.contextState = "suspended"; // as when the browser puts a page's audio to sleep
    sound.interact();
    expect(audio.state.resumes).toBe(2);
  });

  it("plays what it can when one file fails to load, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sound, started } = await awake({ failLoad: "bounce" });
    for (const name of NAMES) sound.play(name);
    expect(started.map((s) => s.name)).toEqual(["hit", "rising", "out"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays quiet, without a fuss, where there is no Web Audio", async () => {
    const audio = fakeAudio({ noAudio: true });
    const sound = new Sound(audio.env);
    expect(() => sound.interact()).not.toThrow();
    await settle();
    sound.play("hit");
    expect(audio.started).toEqual([]);
  });
});

describe("wakeOnGesture", () => {
  it.each(["pointerup", "touchend", "click", "keydown"])("wakes the audio on a %s", async (type) => {
    const audio = fakeAudio({ startAsleep: true });
    const target = new EventTarget();
    wakeOnGesture(new Sound(audio.env), target);
    expect(audio.state.resumes).toBe(0);
    target.dispatchEvent(new Event(type));
    expect(audio.state.resumes).toBe(1);
  });

  it("does not wake it for anything that is not a gesture, such as the pointer drifting over the page", () => {
    const audio = fakeAudio({ startAsleep: true });
    const target = new EventTarget();
    wakeOnGesture(new Sound(audio.env), target);
    for (const type of ["pointermove", "mousemove", "scroll", "resize"]) target.dispatchEvent(new Event(type));
    expect(audio.state.resumes).toBe(0);
  });

  it("does not wake it for a press, only for letting go: a press is still being judged a tap or a hold, and on a phone it is not a gesture", () => {
    const audio = fakeAudio({ startAsleep: true });
    const target = new EventTarget();
    wakeOnGesture(new Sound(audio.env), target);
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("touchstart"));
    expect(audio.state.resumes).toBe(0);
    target.dispatchEvent(new Event("pointerup"));
    expect(audio.state.resumes).toBe(1);
  });
});

describe("playThroughSilentSwitch", () => {
  it("asks Safari to treat the page's audio as playback, which the iPhone's silent switch does not mute", () => {
    const nav = { audioSession: { type: "auto" } };
    playThroughSilentSwitch(nav);
    expect(nav.audioSession.type).toBe("playback");
  });

  it("does nothing in a browser without an audio session, or one that refuses", () => {
    expect(() => playThroughSilentSwitch({})).not.toThrow();
    const strict = {
      audioSession: {
        set type(_: string) {
          throw new Error("no");
        },
        get type() {
          return "auto";
        },
      },
    };
    expect(() => playThroughSilentSwitch(strict)).not.toThrow();
  });
});
