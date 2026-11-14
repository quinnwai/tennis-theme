import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Every address in the built site is relative, so the same build works at the root of a
  // domain or under a path such as /tennis/. Built files go in a folder named after this skin,
  // so no two skins of the homepage ever serve a file at the same address.
  base: "./",
  build: {
    assetsDir: "tennis",
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
