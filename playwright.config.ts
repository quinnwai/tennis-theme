import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";

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

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: deployed ?? (process.env.E2E_PORT ? `http://127.0.0.1:${process.env.E2E_PORT}/` : undefined),
    viewport: { width: 1440, height: 800 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: run
    ? {
        command: `npm run dev -- --host 127.0.0.1 --port ${process.env.E2E_PORT || 0} --strictPort`,
        wait: { stdout: /http:\/\/127\.0\.0\.1:(?<e2e_port>\d+)\// },
        env: { E2E_RUN: run },
      }
    : undefined,
});
