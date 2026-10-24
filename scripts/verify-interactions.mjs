import assert from "node:assert/strict";
import fs from "node:fs";
const { chromium } = await import(process.env.VIBE_PLAYWRIGHT_MODULE || "playwright");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.VIBE_CHROME_PATH ? { executablePath: process.env.VIBE_CHROME_PATH } : {}),
});
const checks = [];
const target = process.env.VIBE_CHECK_URL || "http://127.0.0.1:3000";
const record = (condition, label) => {
  assert(condition, label);
  checks.push(label);
};

async function waitForRise(artwork, restingTop) {
  return artwork.evaluate(async (element, top) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (element.getBoundingClientRect().top < top - 15) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  }, restingTop);
}

async function stableTop(artwork) {
  return artwork.evaluate(async (element) => {
    let previous = element.getBoundingClientRect().top;
    let stable = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const current = element.getBoundingClientRect().top;
      stable = Math.abs(current - previous) < 0.1 ? stable + 1 : 0;
      if (stable >= 4) return current;
      previous = current;
    }
    throw new Error("CD motion did not settle");
  });
}

async function visibleHitPoint(button) {
  return button.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const points = [];
    for (let y = bounds.top + 8; y < bounds.bottom - 8; y += 10) {
      for (let x = bounds.left + 8; x < bounds.right - 8; x += 10) {
        if (document.elementFromPoint(x, y)?.closest("button") === element)
          points.push({ x, y, distance: Math.hypot(x - bounds.x - bounds.width / 2, y - bounds.y - bounds.height / 2) });
      }
    }
    points.sort((a, b) => a.distance - b.distance);
    return points[0] ?? null;
  });
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(target, { waitUntil: "networkidle" });
  const photoFile = {
    name: "moment.png",
    mimeType: "image/png",
    buffer: Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 800;
      const context = canvas.getContext("2d");
      const gradient = context.createLinearGradient(0, 0, 1200, 800);
      gradient.addColorStop(0, "#173e4b");
      gradient.addColorStop(0.5, "#687d6c");
      gradient.addColorStop(1, "#e6b181");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 1200, 800);
      return canvas.toDataURL("image/png").split(",")[1];
    }), "base64"),
  };
  const sleeves = page.locator(".sleeve-stage button");
  record(await sleeves.count() === 0, "The initial hero has no CDs");
  await page.getByLabel("Upload a photo", { exact: true }).setInputFiles(photoFile);
  await page.waitForFunction(() => document.querySelectorAll(".sleeve-stage button").length === 1);
  record(await sleeves.count() === 1, "A prepared photo reveals exactly one CD");
  const firstArtwork = sleeves.first().locator(".sleeve-lift");
  const restingTop = await stableTop(firstArtwork);
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".sleeve-stage")).filter === "blur(0px)");
  await page.locator(".workbench").screenshot({ path: "docs/screenshots/hero-photo.png", style: "nextjs-portal { display: none !important; }" });
  await sleeves.first().focus();
  record(await waitForRise(firstArtwork, restingTop), "Keyboard focus visibly raises a CD");
  await page.keyboard.press("Enter");
  record(await sleeves.first().getAttribute("aria-pressed") === "true", "Keyboard activation inspects the focused CD");
  await page.getByRole("link", { name: "Vibe Check", exact: true }).focus();
  await page.mouse.move(2, 2);
  for (let index = 0; index < 1; index++) {
    const sleeve = sleeves.nth(index);
    const artwork = sleeve.locator(".sleeve-lift");
    const top = await stableTop(artwork);
    const point = await visibleHitPoint(sleeve);
    record(!!point, `CD ${index + 1} has an exposed mouse target`);
    await page.mouse.move(point.x, point.y);
    record(await waitForRise(artwork, top), `Hover visibly raises CD ${index + 1}`);
    if (index === 0) {
      await stableTop(artwork);
      await page.locator(".workbench").screenshot({ path: "docs/screenshots/hero-hover.png", style: "nextjs-portal { display: none !important; }" });
    }
    await page.mouse.move(2, 2);
  }
  await stableTop(firstArtwork);
  const stage = await page.locator(".sleeve-stage").boundingBox();
  await page.mouse.move(stage.x + stage.width - 10, stage.y + 20);
  await page.waitForFunction(() => {
    const transform = getComputedStyle(document.querySelector(".sleeve-fan")).transform;
    const matrix = transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
    return Math.max(Math.abs(matrix.m13), Math.abs(matrix.m23)) > 0.01;
  });
  record(true, "The CD fan tilts toward the mouse");
  await page.mouse.move(2, 2);
  await page.waitForFunction(() => {
    const transform = getComputedStyle(document.querySelector(".sleeve-fan")).transform;
    const matrix = transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
    return Math.max(Math.abs(matrix.m13), Math.abs(matrix.m23)) < 0.0001;
  });
  record(true, "The CD fan returns to rest after the mouse leaves");
  await page.reload({ waitUntil: "networkidle" });
  const smoke = fs.readFileSync("scripts/browser-smoke.js", "utf8");
  const report = await page.evaluate(smoke.replace("passed: checks.length,", "fixture: result, passed: checks.length,"));
  record(await sleeves.count() === 1, "Recommendations alone do not add song CDs");
  const radar = page.locator(".profile-radar svg");
  record(await radar.getAttribute("role") === "img", "Mood chart exposes an accessible description");
  const initialSongShape = await page.locator(".radar-song").getAttribute("points");
  await page.locator(".candidate").nth(2).click();
  await page.waitForFunction((previous) => document.querySelector(".radar-song")?.getAttribute("points") !== previous, initialSongShape);
  record((await radar.locator("title").textContent()).includes("Dreams"), "Selecting a song updates the chart title");
  record((await page.locator(".compared-song").innerText()).includes("Dreams"), "Comparison heading identifies the selected song");
  record((await page.locator("#winner-title").innerText()) === "Holocene", "Comparing an alternative preserves the verified winner");
  record(await page.locator(".precise-comparison .mood-row").count() === 6, "Six paired mood comparisons remain visible");
  record(await page.locator(".candidate-track").count() === 8, "Every ranked song has a visual similarity bar");
  record(await page.locator(".weight-strip > span").count() === 6, "Weight distribution represents all six mood axes");
  const reduced = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await reduced.goto(target, { waitUntil: "networkidle" });
  await reduced.getByLabel("Upload a photo", { exact: true }).setInputFiles(photoFile);
  await reduced.waitForSelector(".sleeve-trigger");
  const reducedSleeve = reduced.locator(".sleeve-trigger").first();
  const reducedArtwork = reducedSleeve.locator(".sleeve-lift");
  const reducedTop = await stableTop(reducedArtwork);
  await reducedSleeve.focus();
  const focusedTop = await stableTop(reducedArtwork);
  record(Math.abs(focusedTop - reducedTop) < 1, "Reduced motion keeps focused CDs stationary");
  await reduced.keyboard.press("Enter");
  record(await reducedSleeve.getAttribute("aria-pressed") === "true", "Reduced motion preserves inspection feedback");
  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await touch.goto(target, { waitUntil: "networkidle" });
  await touch.getByLabel("Upload a photo", { exact: true }).setInputFiles(photoFile);
  await touch.waitForSelector(".sleeve-trigger");
  const touchSleeve = touch.locator(".sleeve-trigger").last();
  await touchSleeve.scrollIntoViewIfNeeded();
  const point = await visibleHitPoint(touchSleeve);
  record(!!point, "A CD has an exposed touch target on mobile");
  await touch.touchscreen.tap(point.x, point.y);
  record(await touchSleeve.getAttribute("aria-pressed") === "true", "Touch tap inspects a CD");
  record(/photo|moment/i.test(await touch.locator(".sleeve-caption").innerText()), "Touch inspection identifies the photo CD");
  record(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Touch layout has no horizontal overflow");
  const pendingQueue = [];
  async function nextQueue() {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (pendingQueue.length) return pendingQueue.shift();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Expected a Spotify queue request");
  }
  await page.route("**/api/spotify/config", (route) => route.fulfill({ json: { clientId: "browser-fixture-client" } }));
  await page.context().route("https://accounts.spotify.com/authorize?**", (route) => {
    const authorize = new URL(route.request().url());
    const callback = new URL("/spotify/callback", target);
    callback.searchParams.set("state", authorize.searchParams.get("state"));
    callback.searchParams.set("code", "browser-fixture-code");
    return route.fulfill({ status: 302, headers: { location: callback.href } });
  });
  await page.route("https://accounts.spotify.com/api/token", (route) => route.fulfill({ json: {
    access_token: "browser-fixture-token", token_type: "Bearer", expires_in: 3600,
  } }));
  await page.route("https://api.spotify.com/v1/me/player/queue?**", (route) => { pendingQueue.push(route); });
  await page.getByRole("button", { name: "Connect Spotify", exact: true }).click();
  await page.getByRole("button", { name: "Adding to queue…", exact: true }).waitFor();
  record(await sleeves.count() === 1, "A pending queue request keeps only the photo CD");
  await (await nextQueue()).fulfill({ status: 404, body: "" });
  await page.locator(".queue-status").getByText(/Open Spotify on any device/).waitFor();
  record(await sleeves.count() === 1, "A failed queue request does not create a CD");
  await page.getByRole("button", { name: "Add to queue", exact: true }).click();
  await page.getByRole("button", { name: "Adding to queue…", exact: true }).waitFor();
  record(await sleeves.count() === 1, "Retry remains pending until Spotify confirms");
  await (await nextQueue()).fulfill({ status: 204, body: "" });
  await page.waitForFunction(() => document.querySelectorAll(".sleeve-stage button").length === 2);
  record(await page.locator('.sleeve-trigger[data-disc-kind="queued"]').count() === 1, "Confirmation adds one queued song CD behind the photo");
  const photoLayer = await page.locator(".front-slot").evaluate((element) => Number(getComputedStyle(element).zIndex));
  const queuedLayer = await page.locator('.sleeve-slot[data-disc-kind="queued"]').evaluate((element) => Number(getComputedStyle(element).zIndex));
  record(photoLayer > queuedLayer, "The photo CD stays in front of the confirmed song");
  const queuedSleeve = page.locator('.sleeve-trigger[data-disc-kind="queued"]');
  await queuedSleeve.scrollIntoViewIfNeeded();
  const queuedArtwork = queuedSleeve.locator(".sleeve-lift");
  const queuedTop = await stableTop(queuedArtwork);
  const queuedPoint = await visibleHitPoint(queuedSleeve);
  record(!!queuedPoint, "The queued CD has an exposed mouse target");
  await page.mouse.move(queuedPoint.x, queuedPoint.y);
  record(await waitForRise(queuedArtwork, queuedTop), "The queued CD retains hover lift");
  await page.mouse.move(2, 2);
  await stableTop(page.locator('[data-disc-kind="photo"] .sleeve-lift'));
  await page.locator(".workbench").screenshot({ path: "docs/screenshots/hero-queued.png", style: "nextjs-portal { display: none !important; }" });
  await page.locator(".candidate").nth(3).click();
  await page.getByRole("button", { name: "Add to queue instead", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".selected-comparison button")?.disabled);
  record(await sleeves.count() === 2, "A second pending song does not appear early");
  await (await nextQueue()).fulfill({ status: 204, body: "" });
  await page.waitForFunction(() => document.querySelectorAll(".sleeve-stage button").length === 3);
  record(await page.locator('.sleeve-trigger[data-disc-kind="queued"]').count() === 2, "A second confirmed song adds a distinct CD");
  await page.getByRole("button", { name: "Add to queue instead", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".selected-comparison button")?.disabled);
  const repeatRequest = await nextQueue();
  await page.waitForTimeout(750);
  record(await sleeves.count() === 3, "Requeueing preserves previously confirmed CDs");
  await repeatRequest.fulfill({ status: 503, body: "" });
  await page.locator(".selected-comparison").getByText(/Spotify could not add the song/).waitFor();
  record(await sleeves.count() === 3, "A failed repeat request preserves the confirmed CD without duplication");
  await page.getByRole("button", { name: "Add to queue instead", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".selected-comparison button")?.disabled);
  const oldRequest = await nextQueue();
  await page.getByLabel("Upload a photo", { exact: true }).setInputFiles(photoFile);
  await page.waitForFunction(() => document.querySelectorAll(".sleeve-stage button").length === 1 && !document.querySelector(".results"));
  record(await sleeves.count() === 1, "Replacing the photo clears old song CDs");
  await oldRequest.fulfill({ status: 204, body: "" });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  record(await sleeves.count() === 1, "A late queue confirmation cannot populate a replacement photo");
  await page.route("**/api/recommend", (route) => route.fulfill({ json: { ...report.fixture, requestId: "replacement-photo" } }));
  await page.getByRole("button", { name: "Find my song", exact: true }).click();
  await page.getByRole("button", { name: "Adding to queue…", exact: true }).waitFor();
  await (await nextQueue()).fulfill({ status: 204, body: "" });
  await page.waitForFunction(() => document.querySelectorAll(".sleeve-stage button").length === 2);
  await page.getByRole("button", { name: "Try another photo", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".sleeve-stage button").length === 0);
  record(await sleeves.count() === 0, "Reset removes the photo and all queued CDs");
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally {
  await browser.close();
}
