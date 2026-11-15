import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// By default each run starts a dev server of its own and tests that. Set BASE_URL to run the same
// checks against a deployed copy, for example the live site. Keep the trailing slash.
const deployed = process.env.BASE_URL;

// People and agents run these checks from several checkouts at the same moment, so a run never
// trusts a server that happens to be there already; it could be another checkout's.
// - Vite picks the port (`--port 0`), or E2E_PORT sets one by hand. A port that is taken stops the
//   run instead of being shared.
// - The server counts as started when the process this run launched prints its address. The port is
//   read from that line and left in E2E_PORT for the workers. There is no `url` on purpose: a url is
//   answered by whoever is listening. If the pattern below stops matching Vite's startup line, runs
//   time out waiting for the server.
// - E2E_RUN is a marker that only this run's server sends back (see vite.config.ts); the check for it
//   is in e2e/which-site.spec.ts.
// The address is the IPv4 one on purpose: "localhost" can mean ::1 to one program and 127.0.0.1 to
// another. Playwright loads this file in the runner and again in every worker, which inherit the
// runner's environment, where E2E_PORT and E2E_RUN are settled by then.
const run = deployed ? undefined : (process.env.E2E_RUN ||= randomUUID());

// Every page makes an audio context when it starts (see src/sound.ts), and the first one in a browser
// blocks the page while the browser starts its audio. That takes 0.2 to 0.4 s when many browsers do it at
// once, as in a parallel run, and the timing checks in these tests suffer for it. With the audio inside
// the browser's own process it takes about 50 ms.
const launchOptions = { args: ["--disable-features=AudioServiceOutOfProcess"] };

// A phone, as Chromium plays one: the phone's window size, pixel density and user agent, a touch screen in
// place of a mouse (so `(pointer: coarse)` holds), and a layout that follows the page's viewport tag. The size is
// what Safari or Chrome leaves for the page, with the browser's own bars already taken off. It is still
// Chromium's engine: these projects cannot say how Safari behaves, which is why the phone checks also go to
// Quinn-Wai on a real iPhone and a real Android phone. `devices` names each one's engine (WebKit for the
// iPhones); the engine is left out here on purpose, so that the browser that is installed for the rest is used.
const phone = (device: string) => {
  const { defaultBrowserType: _engine, ...description } = devices[device];
  return { ...description, browserName: "chromium" as const, launchOptions };
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: deployed ?? (process.env.E2E_PORT ? `http://127.0.0.1:${process.env.E2E_PORT}/` : undefined),
    viewport: { width: 1440, height: 800 },
  },
  projects: [
    // The desktop window the first draft was made for. e2e/phone.spec.ts is about phones only.
    { name: "chromium", testIgnore: /phone\.spec\.ts/, use: { browserName: "chromium", launchOptions } },
    // A phone held sideways, which is how it is played: every check of every spec runs here too, on a touch screen, plus the
    // phone checks in e2e/phone.spec.ts for a phone held sideways. (The groups of that file are told apart by their titles.)
    // The iPhone's window is the one iOS 26's Safari leaves: 750 by 280, which is what Quinn-Wai's iPhone showed (two rows of toolbar
    // take 110 of its 390 points). The descriptor's own 342 is from the Safari before that.
    { name: "iphone-landscape", grepInvert: /a phone held upright/, use: { ...phone("iPhone 13 landscape"), viewport: { width: 750, height: 280 } } },
    { name: "pixel-landscape", grepInvert: /a phone held upright/, use: phone("Pixel 7 landscape") },
    // A phone held upright is shown the rotate prompt, and the checks of a phone held upright and of every phone are all that is asked of it.
    { name: "iphone-portrait", testMatch: /phone\.spec\.ts/, grepInvert: /a phone held sideways/, use: phone("iPhone 13") },
    { name: "pixel-portrait", testMatch: /phone\.spec\.ts/, grepInvert: /a phone held sideways/, use: phone("Pixel 7") },
  ],
  webServer: run
    ? {
        command: `npm run dev -- --host 127.0.0.1 --port ${process.env.E2E_PORT || 0} --strictPort`,
        wait: { stdout: /http:\/\/127\.0\.0\.1:(?<e2e_port>\d+)\// },
        env: { E2E_RUN: run },
      }
    : undefined,
});
