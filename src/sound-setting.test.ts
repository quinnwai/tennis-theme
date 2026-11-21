import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SOUND, nextSound, parseSound, readSound, SOUND_KEY, SOUND_LEVELS, writeSound } from "./sound-setting";

/** A stand-in for the browser's storage: a plain map that remembers what it was given. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("the sound setting", () => {
  it("lives under exactly site:sound, the key every skin of the homepage shares", () => {
    expect(SOUND_KEY).toBe("site:sound");
  });

  it("has four levels, off then soft then medium then loud, and starts at soft", () => {
    expect([...SOUND_LEVELS]).toEqual(["off", "soft", "medium", "loud"]);
    expect(DEFAULT_SOUND).toBe("soft");
  });

  it("reads as soft when nothing is stored, so a new visitor gets the quiet start", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(readSound()).toBe("soft");
  });

  it("steps from off to soft to medium to loud and round to off again", () => {
    expect(nextSound("off")).toBe("soft");
    expect(nextSound("soft")).toBe("medium");
    expect(nextSound("medium")).toBe("loud");
    expect(nextSound("loud")).toBe("off");
  });

  it("stores the level's word, under that one key and no other", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    for (const level of SOUND_LEVELS) {
      writeSound(level);
      expect([...storage.data]).toEqual([["site:sound", level]]);
    }
  });

  it("reads back whatever was last written", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    for (const level of SOUND_LEVELS) {
      writeSound(level);
      expect(readSound()).toBe(level);
    }
  });

  it("reads another skin's stored off as off, and its on as the default level", () => {
    expect(parseSound("off")).toBe("off");
    expect(parseSound("on")).toBe("soft");
    vi.stubGlobal("localStorage", fakeStorage({ "site:sound": "off" }));
    expect(readSound()).toBe("off");
    vi.stubGlobal("localStorage", fakeStorage({ "site:sound": "on" }));
    expect(readSound()).toBe("soft");
  });

  it.each(["", "ON", "false", "0", "mute", "undefined", "Loud"])("reads the stray value %j as the default level: only the four words count", (value) => {
    vi.stubGlobal("localStorage", fakeStorage({ "site:sound": value }));
    expect(readSound()).toBe("soft");
  });

  it("falls back to soft, and does not throw, when the browser refuses to let the page look at its storage", () => {
    // Some browsers (for instance with all cookies blocked) throw at the mere mention of localStorage.
    vi.stubGlobal("localStorage", undefined); // so that unstubAllGlobals puts back whatever was there
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(readSound()).toBe("soft");
    expect(() => writeSound("off")).not.toThrow();
  });

  it("does not throw when storage is there but refuses to take the setting, as when it is full", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    });
    expect(() => writeSound("off")).not.toThrow();
    expect(readSound()).toBe("soft");
  });
});
