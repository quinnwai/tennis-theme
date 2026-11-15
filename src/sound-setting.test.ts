import { afterEach, describe, expect, it, vi } from "vitest";
import { readSound, SOUND_KEY, writeSound } from "./sound-setting";

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

  it("reads as on when nothing is stored, so sound is on by default", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(readSound()).toBe("on");
  });

  it("stores the words on and off, under that one key and no other", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    writeSound("off");
    expect([...storage.data]).toEqual([["site:sound", "off"]]);
    writeSound("on");
    expect([...storage.data]).toEqual([["site:sound", "on"]]);
  });

  it("reads back whatever was last written", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    writeSound("off");
    expect(readSound()).toBe("off");
    writeSound("on");
    expect(readSound()).toBe("on");
  });

  it("reads another skin's stored off as off", () => {
    vi.stubGlobal("localStorage", fakeStorage({ "site:sound": "off" }));
    expect(readSound()).toBe("off");
  });

  it.each(["", "ON", "false", "0", "mute", "undefined"])("reads the stray value %j as on: only off turns sound off", (value) => {
    vi.stubGlobal("localStorage", fakeStorage({ "site:sound": value }));
    expect(readSound()).toBe("on");
  });

  it("falls back to on, and does not throw, when the browser refuses to let the page look at its storage", () => {
    // Some browsers (for instance with all cookies blocked) throw at the mere mention of localStorage.
    vi.stubGlobal("localStorage", undefined); // so that unstubAllGlobals puts back whatever was there
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(readSound()).toBe("on");
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
    expect(readSound()).toBe("on");
  });
});
