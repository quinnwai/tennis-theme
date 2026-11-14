import { defineConfig } from "@playwright/test";

// By default the checks run against the dev server on this machine. Set BASE_URL to run the same
// checks against a deployed copy, for example the live site. Keep the trailing slash.
const deployed = process.env.BASE_URL;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: deployed ?? "http://localhost:5173/",
    viewport: { width: 1440, height: 800 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: deployed
    ? undefined
    : {
        command: "npm run dev -- --port 5173 --strictPort",
        url: "http://localhost:5173/",
        reuseExistingServer: true,
      },
});
