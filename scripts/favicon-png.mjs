// Draws the page's SVG icon at 64 x 64 on a transparent background and saves it as the PNG icon, the one
// that browsers which do not take SVG icons use. It draws in the same headless Chromium as the browser tests.
// Run it after changing public/tennis/favicon.svg. The size has to match `sizes` on the PNG's link in index.html.
//
// Run with: PLAYWRIGHT_BROWSERS_PATH=0 node scripts/favicon-png.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const SVG = "public/tennis/favicon.svg";
const PNG = "public/tennis/favicon.png";
const SIZE = 64;

const source = `data:image/svg+xml;base64,${readFileSync(SVG).toString("base64")}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
await page.setContent(
  `<style>html,body{margin:0;background:transparent}img{display:block}</style>` +
    `<img id="icon" src="${source}" width="${SIZE}" height="${SIZE}">`,
);
await page.evaluate(() => document.getElementById("icon").decode());
writeFileSync(PNG, await page.screenshot({ omitBackground: true }));
await browser.close();
console.log(`wrote ${PNG}`);
