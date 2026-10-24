import assert from "node:assert/strict";
import fs from "node:fs";
const { chromium } = await import(process.env.VIBE_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.VIBE_CHROME_PATH ? { executablePath: process.env.VIBE_CHROME_PATH } : {}),
});
const target = process.env.VIBE_CHECK_URL || "http://127.0.0.1:3000";
const captureDirectory = process.env.VIBE_SCREENSHOTS_DIR || "/tmp/vibe-ui-screenshots";
fs.mkdirSync(captureDirectory, { recursive: true });
const checks = [];
const record = (condition, label) => { assert(condition, label); checks.push(label); };
try {
  for (const settings of [
    { viewport: { width: 1280, height: 900 } },
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    { viewport: { width: 360, height: 800 }, reducedMotion: "reduce" },
  ]) {
    const page = await browser.newPage(settings);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://open.spotify.com/embed/**", (route) => route.fulfill({ body: "", contentType: "text/html" }));
    await page.goto(target, { waitUntil: "networkidle" });
    record(await page.locator(".sleeve-stage").count() === 0, "Empty state has no artwork gallery");
    record(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor === "rgb(0, 0, 0)"), "Page background is pitch black");
    const composition = await page.evaluate(() => {
      const heading = document.querySelector(".intro h1").getBoundingClientRect();
      const upload = document.querySelector(".photo-section").getBoundingClientRect();
      const action = document.querySelector(".find-song").getBoundingClientRect();
      return {
        centered: Math.abs(heading.left + heading.width / 2 - innerWidth / 2) < 2 &&
          Math.abs(upload.left + upload.width / 2 - innerWidth / 2) < 2,
        actionVisible: action.bottom <= innerHeight,
      };
    });
    record(composition.centered, `Headline and upload panel are centered at ${settings.viewport.width}px`);
    record(composition.actionVisible, `Photo actions fit in the first screen at ${settings.viewport.width}px`);
    await page.screenshot({ path: `${captureDirectory}/opening-${settings.viewport.width}.png`, fullPage: true, style: "nextjs-portal { display:none!important; }" });
    const smoke = fs.readFileSync("scripts/browser-smoke.js", "utf8");
    const report = await page.evaluate(smoke);
    record(report.passed > 20, "Photo upload, recommendations, comparison, errors, and retry work");
    await page.getByRole("button", { name: "Compare Dreams by Fleetwood Mac", exact: true }).click();
    await page.getByRole("heading", { name: "Dreams, parameter by parameter" }).waitFor();
    record(await page.locator("#winner-title").innerText() === "Holocene", "Comparison preserves the verified winner");
    const rows = page.locator(".precise-comparison .mood-row");
    record(await rows.count() === 6, "All six mood dimensions are visible");
    record(await rows.locator("meter").count() === 12, "Each dimension exposes separate labeled photo and song meters");
    record(await page.locator(".candidate-track").count() === 8, "All eight songs retain similarity bars");
    record(await page.locator(".weight-row").count() === 6, "All normalized weights remain visible");
    const photo = page.locator('.artwork-choice[aria-label="View your photo"]');
    await photo.scrollIntoViewIfNeeded();
    await photo.focus();
    await page.keyboard.press("Enter");
    record(await photo.getAttribute("aria-pressed") === "true", "Keyboard activation selects the photo");
    if (settings.hasTouch) {
      await photo.tap();
      record(await photo.getAttribute("aria-pressed") === "true", "Touch selection persists");
    }
    record(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${settings.viewport.width}px`);
    record(errors.length === 0, `No browser runtime errors at ${settings.viewport.width}px`);
    await page.locator(".workbench").screenshot({ path: `${captureDirectory}/gallery-${settings.viewport.width}.png`, style: "nextjs-portal { display:none!important; }" });
    await page.locator(".selected-comparison").screenshot({ path: `${captureDirectory}/comparison-${settings.viewport.width}.png`, style: "nextjs-portal { display:none!important; }" });
    await page.close();
  }
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally { await browser.close(); }
