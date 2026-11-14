import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "vite";
import packageJson from "../package.json?raw";

/** The settings Vite would start the dev server with. Reading them opens no port. */
const devServer = async () => (await resolveConfig({}, "serve")).server;

afterEach(() => vi.unstubAllEnvs());

describe("npm run dev", () => {
  it("with no flags still serves on 5173", async () => {
    vi.stubEnv("E2E_RUN", undefined);
    expect(JSON.parse(packageJson).scripts.dev).toBe("vite");
    expect((await devServer()).port).toBe(5173);
  });
});

// The browser tests start a dev server with E2E_RUN set and look for it in the pages they get back
// (e2e/which-site.spec.ts), which is how each run knows the server it is testing is its own.
describe("the marker of a browser-test run", () => {
  it("is sent along with every page when the browser tests started the server", async () => {
    vi.stubEnv("E2E_RUN", "run-1");
    expect((await devServer()).headers).toMatchObject({ "x-e2e-run": "run-1" });
  });

  it("is not sent by a dev server started any other way", async () => {
    vi.stubEnv("E2E_RUN", undefined);
    expect((await devServer()).headers).not.toHaveProperty("x-e2e-run");
  });
});
