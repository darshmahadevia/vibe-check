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
    const target = process.env.VIBE_CHECK_URL || "http://127.0.0.1:3000";
    const directory = path.resolve("docs/screenshots");
    fs.mkdirSync(directory, { recursive: true });
    await page.goto(target, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("heading", { name: "Find the song for this moment." })
      .waitFor();
    await page.screenshot({ path: path.join(directory, "desktop.png") });
    const smoke = fs.readFileSync(
      path.resolve("scripts/browser-smoke.js"),
      "utf8",
    );
    console.log(JSON.stringify(await page.evaluate(smoke)));
    await page.reload({ waitUntil: "domcontentloaded" });
    const keepResult = smoke.replace(
      'button("Try another photo").click();',
      "return { passed: checks.length, checks };",
    );
    await page.evaluate(keepResult);
    await page.locator(".candidate").nth(1).click();
    await page.evaluate(() =>
      document.querySelector("details").scrollIntoView({ block: "start" }),
    );
    await page.screenshot({ path: path.join(directory, "results.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByRole("heading", { name: "Find the song for this moment." })
      .waitFor();
    await page.screenshot({ path: path.join(directory, "mobile.png") });
    console.log(JSON.stringify(await page.evaluate(smoke)));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
