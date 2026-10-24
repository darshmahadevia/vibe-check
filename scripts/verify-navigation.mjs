import assert from "node:assert/strict";
const { chromium } = await import(process.env.VIBE_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.VIBE_CHROME_PATH ? { executablePath: process.env.VIBE_CHROME_PATH } : {}),
});
const target = process.env.VIBE_CHECK_URL || "http://127.0.0.1:3000";
const checks = [];
const record = (condition, label) => { assert(condition, label); checks.push(label); };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let authorize;
  await context.route("**/api/spotify/config", (route) => route.fulfill({ json: { clientId: "navigation-fixture" } }));
  await context.route("https://accounts.spotify.com/authorize?**", (route) => { authorize = route; });
  await context.route("https://accounts.spotify.com/api/token", (route) => route.fulfill({ json: {
    access_token: "navigation-fixture-token", token_type: "Bearer", expires_in: 3600,
  } }));
  async function finishLogin(success) {
    for (let attempt = 0; !authorize && attempt < 100; attempt++) await page.waitForTimeout(30);
    assert(authorize, "Expected Spotify authorization popup");
    const request = new URL(authorize.request().url());
    const callback = new URL("/spotify/callback", target);
    callback.searchParams.set("state", request.searchParams.get("state"));
    callback.searchParams.set(success ? "code" : "error", success ? "fixture-code" : "access_denied");
    const route = authorize;
    authorize = undefined;
    await route.fulfill({ status: 302, headers: { location: callback.href } });
  }
  await page.goto(target, { waitUntil: "networkidle" });
  const navigation = page.getByRole("navigation");
  record(await navigation.count() > 0, "Navbar has a navigation landmark");
  record(await page.locator(".wordmark svg").count() === 0, "Wordmark has no adjacent logo icon");
  record(await page.locator(".connection small").count() === 0, "Navbar has no inline connection helper text");
  const controls = await page.evaluate(() => [
    document.querySelector(".site-header button"),
    document.querySelector(".actions button"),
    document.querySelectorAll(".actions button")[1],
  ].map((node) => {
    const css = getComputedStyle(node);
    return [css.backgroundColor, css.color, css.borderRadius, css.minHeight];
  }));
  record(controls.every((style) => JSON.stringify(style) === JSON.stringify(controls[0])), "Navbar, upload, and camera buttons share color, radius, and height");
  record(await page.locator(".photo-status").evaluate((node) => getComputedStyle(node).borderTopStyle === "dashed"), "Upload invitation restores the reference dashed inset");
  await page.screenshot({ path: "/tmp/vibe-navbar-initial.png", fullPage: true, style: "nextjs-portal { display:none!important; }" });
  await page.getByRole("button", { name: "Connect Spotify", exact: true }).click();
  await page.getByRole("button", { name: "Connecting…", exact: true }).waitFor();
  record(await page.getByText("Signed in to Spotify", { exact: true }).count() === 0, "Pending sign-in never reports success");
  await finishLogin(false);
  await page.getByRole("alert").waitFor();
  record(await page.getByText("Signed in to Spotify", { exact: true }).count() === 0, "Denied sign-in never reports success");
  record(await page.getByRole("button", { name: "Connect Spotify", exact: true }).isEnabled(), "Denied sign-in permits retry");
  await page.getByRole("button", { name: /dismiss|close/i }).click();
  await page.getByRole("button", { name: "Connect Spotify", exact: true }).click();
  await finishLogin(true);
  const success = page.getByRole("status").filter({ hasText: "Signed in to Spotify" });
  await success.waitFor();
  record(await page.getByRole("button", { name: "Disconnect Spotify", exact: true }).isEnabled(), "Successful OAuth changes navbar to disconnect");
  record(await success.evaluate((node) => {
    for (let current = node; current; current = current.parentElement) {
      if (["fixed", "absolute"].includes(getComputedStyle(current).position)) return true;
    }
    return false;
  }), "Sign-in confirmation is an overlay popup");
  await page.screenshot({ path: "/tmp/vibe-navbar-popup.png", style: "nextjs-portal { display:none!important; }" });
  await page.setViewportSize({ width: 390, height: 844 });
  record(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Sign-in popup fits on mobile");
  await page.screenshot({ path: "/tmp/vibe-navbar-popup-mobile.png", style: "nextjs-portal { display:none!important; }" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: /dismiss|close/i }).click();
  record(await page.getByText("Signed in to Spotify", { exact: true }).count() === 0, "Sign-in confirmation can be dismissed");
  await page.getByRole("button", { name: "Disconnect Spotify", exact: true }).click();
  record(await page.getByRole("button", { name: "Connect Spotify", exact: true }).isEnabled(), "Disconnect returns navbar to connect");
  record(await page.getByText("Signed in to Spotify", { exact: true }).count() === 0, "Disconnect leaves no stale signed-in popup");
  const photo = { name: "moment.png", mimeType: "image/png", buffer: Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 200;
    const paint = canvas.getContext("2d"); paint.fillStyle = "#48675b"; paint.fillRect(0, 0, 300, 200);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64") };
  await page.getByLabel("Upload a photo", { exact: true }).setInputFiles(photo);
  await page.locator(".sleeve-stage").waitFor();
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => {
    const find = getComputedStyle(document.querySelector(".find-song"));
    const upload = getComputedStyle(document.querySelector(".actions button"));
    return find.backgroundColor === upload.backgroundColor && find.color === upload.color;
  });
  record(await page.locator(".find-song").evaluate((node) => {
    const find = getComputedStyle(node);
    const upload = getComputedStyle(document.querySelector(".actions button"));
    return ["backgroundColor", "color", "borderRadius", "minHeight"].every((property) => find[property] === upload[property]);
  }), "Enabled find and upload actions use the same control style");
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    record(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Prepared-photo navbar has no overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "New photo", exact: true }).click();
  await page.locator(".sleeve-stage").waitFor({ state: "hidden" });
  record(await page.locator(".actions").getByRole("button", { name: "Upload a photo", exact: true }).evaluate((node) => document.activeElement === node), "New photo resets the flow and focuses the visible upload button");
  await page.getByLabel("Upload a photo", { exact: true }).setInputFiles(photo);
  await page.locator(".sleeve-stage").waitFor();
  await page.getByRole("link", { name: "Vibe Check", exact: true }).click();
  await page.locator(".sleeve-stage").waitFor({ state: "hidden" });
  record(await page.getByRole("button", { name: "Find my song", exact: true }).isDisabled(), "Wordmark returns to empty photo state");
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    record(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Navigation has no overflow at ${width}px`);
  }
  record(errors.length === 0, `No browser runtime errors (${errors.join(", ")})`);
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally { await browser.close(); }
