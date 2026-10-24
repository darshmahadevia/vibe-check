import fs from "node:fs";
import path from "node:path";
const { chromium } = await import(
  process.env.VIBE_PLAYWRIGHT_MODULE || "playwright"
);

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.VIBE_CHROME_PATH
      ? { executablePath: process.env.VIBE_CHROME_PATH }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const target = process.env.VIBE_CHECK_URL || "http://127.0.0.1:3000";
    const directory = path.resolve("docs/screenshots");
    const captureOptions = { style: "nextjs-portal { display: none !important; }" };
    async function waitForPlayer() {
      await page.locator(".winner").scrollIntoViewIfNeeded();
      const title = await page.locator("#winner-title").innerText();
      await page.frameLocator("iframe").getByText(title, { exact: true }).first().waitFor();
      const artwork = page.frameLocator("iframe").locator("img").first();
      await artwork.waitFor();
      await artwork.evaluate((image) => image.decode());
      await page.frameLocator("iframe").locator("body").evaluate(() =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    }
    fs.mkdirSync(directory, { recursive: true });
    await page.goto(target, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ ...captureOptions, path: path.join(directory, "desktop.png") });
    await page.locator(".workbench").screenshot({ ...captureOptions, path: path.join(directory, "hero.png") });
    const smoke = fs.readFileSync(
      path.resolve("scripts/browser-smoke.js"),
      "utf8",
    );
    console.log(JSON.stringify(await page.evaluate(smoke)));
    await page.reload({ waitUntil: "networkidle" });
    const keepResult = smoke.replace(
      'button("Try another photo").click();',
      "return { passed: checks.length, checks };",
    );
    await page.evaluate(keepResult);
    await page.locator(".candidate").nth(1).click();
    await page.mouse.move(0, 0);
    await waitForPlayer();
    await page.locator(".results").screenshot({ ...captureOptions, path: path.join(directory, "results.png") });
    await page.locator(".analysis-overview").screenshot({ ...captureOptions, path: path.join(directory, "analysis.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ ...captureOptions, path: path.join(directory, "mobile.png"), fullPage: true });
    console.log(JSON.stringify(await page.evaluate(smoke)));
    await waitForPlayer();
    await page.locator(".results").screenshot({ ...captureOptions, path: path.join(directory, "mobile-results-collapsed.png") });
    await page.locator("details").evaluate((element) => { element.open = true; });
    await waitForPlayer();
    await page.locator(".results").screenshot({ ...captureOptions, path: path.join(directory, "mobile-results.png") });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("heading", { level: 1 }).waitFor();
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      }));
      if (layout.scrollWidth > layout.width || !layout.reducedMotion)
        throw new Error(`Reduced-motion layout failed at ${width}px`);
      console.log(JSON.stringify({ check: "Reduced-motion layout", ...layout }));
    }
    if (pageErrors.length) throw new Error(pageErrors.join("\n"));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
