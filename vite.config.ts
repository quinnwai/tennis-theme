import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        home: resolve(import.meta.dirname, "index.html"),
        credits: resolve(import.meta.dirname, "credits/index.html"),
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
