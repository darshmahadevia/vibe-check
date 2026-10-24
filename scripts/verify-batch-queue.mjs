import assert from "node:assert/strict";
const { chromium } = await import(process.env.VIBE_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.VIBE_CHROME_PATH ? { executablePath: process.env.VIBE_CHROME_PATH } : {}),
});
const target = process.env.VIBE_CHECK_URL || "http://127.0.0.1:3000";
const checks = [];
const record = (condition, label) => { assert(condition, label); checks.push(label); };
const params = ["energy", "positivity", "tempo", "texture", "space", "nostalgia"];
const cover = "https://i.scdn.co/image/abc123";
const failedCover = "https://i.scdn.co/image/broken123";
const profile = Object.fromEntries(params.map((p) => [p, 5]));
const fixture = {
  requestId: "batch-fixture", winnerId: 0, vibe_summary: "An unhurried afternoon in warm light.",
  photo_profile: Object.fromEntries(params.map((p) => [p, { score: 5, evidence: "Soft light and a still scene." }])),
  weights: Object.fromEntries(params.map((p) => [p, 1 / 6])),
  weights_reason: "An even balance across the mood.",
  candidates: Array.from({ length: 8 }, (_, id) => {
    const trackId = String(id).padStart(22, "0");
    return { id, rank: id + 1, score: 100 - id, title: `Song ${id}`, artist: `Artist ${id}`,
      profile, gaps: Object.fromEntries(params.map((p) => [p, 0])), fit_note: "A gentle arrangement.",
      resolution: { kind: "verified", trackId, uri: `spotify:track:${trackId}`,
        url: `https://open.spotify.com/track/${trackId}`, title: `Song ${id}`, artist: `Artist ${id}`,
        ...(id === 1 ? { albumCoverUrl: cover } : id === 3 ? { albumCoverUrl: failedCover } : {}),
      },
    };
  }),
};
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const pending = [];
  const requested = [];
  await context.route("https://open.spotify.com/embed/**", (route) => route.fulfill({ body: "", contentType: "text/html" }));
  await context.route(cover, (route) => route.fulfill({ body: '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250"><rect width="250" height="250" fill="#84583a"/></svg>', contentType: "image/svg+xml" }));
  await context.route(failedCover, (route) => route.fulfill({ status: 404 }));
  await context.route("**/api/recommend", (route) => route.fulfill({ json: fixture }));
  await context.route("**/api/spotify/config", (route) => route.fulfill({ json: { clientId: "fixture-client" } }));
  await context.route("https://accounts.spotify.com/authorize?**", (route) => {
    const authorize = new URL(route.request().url());
    const callback = new URL("/spotify/callback", target);
    callback.searchParams.set("state", authorize.searchParams.get("state"));
    callback.searchParams.set("code", "fixture-code");
    return route.fulfill({ status: 302, headers: { location: callback.href } });
  });
  await context.route("https://accounts.spotify.com/api/token", (route) => route.fulfill({ json: {
    access_token: "fixture-token", token_type: "Bearer", expires_in: 3600,
  } }));
  await context.route("https://api.spotify.com/v1/me/player/queue?**", (route) => {
    requested.push(new URL(route.request().url()).searchParams.get("uri"));
    pending.push(route);
  });
  async function nextQueue() {
    await page.waitForFunction(() => document.querySelector('.candidate-queue-status') !== null);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (pending.length) return pending.shift();
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error("Expected queue request");
  }
  async function respond(status) {
    await (await nextQueue()).fulfill({ status, body: "" });
  }
  const select = (id) => page.getByRole("checkbox", { name: `Select Song ${id} by Artist ${id} for queue`, exact: true });
  const batch = () => page.getByRole("button", { name: /^(Connect & add selected|Add selected) \(/ });
  const queued = page.locator('.sleeve-trigger[data-disc-kind="queued"]');
  await page.goto(target, { waitUntil: "networkidle" });
  const photo = { name: "moment.png", mimeType: "image/png", buffer: Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 200;
    const context = canvas.getContext("2d"); context.fillStyle = "#747a57"; context.fillRect(0, 0, 300, 200);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64") };
  async function find() {
    await page.getByLabel("Upload a photo", { exact: true }).setInputFiles(photo);
    await page.getByRole("button", { name: "Find my song", exact: true }).click();
    await page.getByRole("heading", { name: "Curate your queue" }).waitFor();
  }
  await find();
  await select(3).check(); await select(1).check(); await select(2).check();
  await page.getByRole("button", { name: "Compare Song 5 by Artist 5", exact: true }).click();
  record(await select(1).isChecked() && await select(2).isChecked() && await select(3).isChecked(), "Comparison keeps independent batch selection");
  await batch().click();
  const first = await nextQueue();
  record(requested[0] === fixture.candidates[1].resolution.uri, "Login resumes selected songs in rank order without adding winner");
  record(await queued.count() === 0, "Pending batch adds no song CDs");
  record(await page.getByRole("button", { name: "Select available", exact: true }).isDisabled(), "Batch locks selection and individual queue controls");
  await first.fulfill({ status: 204, body: "" });
  await respond(503);
  await batch().waitFor();
  record(requested.length === 2 && await queued.count() === 1, "First failure stops batch after confirmed successes");
  record(!await select(1).isChecked() && await select(2).isChecked() && await select(3).isChecked(), "Failed and remaining songs stay selected");
  record(await batch().innerText() === "Add selected (2)", "Selection count excludes confirmed song");
  await page.locator('.artwork-queued img').waitFor();
  const coverImage = page.locator('.artwork-queued img');
  record(await coverImage.getAttribute("src") === cover, "Confirmed CD carries Spotify album art");
  record(await coverImage.evaluate(async (image) => {
    await image.decode();
    const bounds = image.getBoundingClientRect();
    return image.naturalWidth > 0 && image.naturalHeight > 0 && bounds.width > 0 && bounds.height > 0;
  }), "Confirmed album image decodes and renders with positive dimensions");
  await page.locator(".workbench").screenshot({ path: process.env.VIBE_ALBUM_SCREENSHOT || "/tmp/vibe-album-cds.png", style: "nextjs-portal { display:none!important; }" });
  await batch().click(); await respond(204); await respond(401);
  await batch().waitFor();
  record(await select(3).isChecked() && await batch().innerText() === "Connect & add selected (1)", "Reconnect failure retains remaining selected song");
  const beforeConnect = requested.length;
  await page.getByRole("button", { name: "Connect Spotify", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect Spotify", exact: true }).waitFor();
  record(requested.length === beforeConnect && await select(3).isChecked(), "Header reconnect preserves selection and never queues winner");
  await batch().click(); await respond(204); await batch().waitFor();
  record(await queued.count() === 3, "Three distinct confirmations create three CDs");
  await page.waitForFunction(() => [...document.querySelectorAll('.artwork-queued strong')].some((node) => node.textContent === "Song 3"));
  record(await page.locator('.artwork-queued strong').count() === 2, "Absent and failed artwork fall back to track lettering");
  record(await select(1).isDisabled() && await select(2).isDisabled() && await select(3).isDisabled(), "Confirmed tracks cannot be selected again");
  await select(4).check(); await select(5).check(); await batch().click();
  const stale = await nextQueue();
  const beforeStale = requested.length;
  await page.getByRole("button", { name: "Try another photo", exact: true }).click();
  await stale.fulfill({ status: 204, body: "" });
  await page.waitForTimeout(150);
  record(requested.length === beforeStale && await page.locator('.sleeve-trigger').count() === 0, "Reset stops batch remainder and rejects stale CD confirmation");
  fixture.requestId = "automatic-fixture";
  await find();
  const automatic = await nextQueue();
  record(await page.getByRole("button", { name: "Select available", exact: true }).isDisabled(), "Automatic winner request locks batch controls");
  const beforeAutomatic = requested.length;
  await page.getByRole("button", { name: "Select available", exact: true }).evaluate((button) => button.click());
  record(requested.length === beforeAutomatic, "Batch cannot interleave with an automatic queue request");
  await automatic.fulfill({ status: 204, body: "" });
  await page.getByText("Added to your Spotify queue.", { exact: true }).waitFor();
  await select(4).check(); await select(5).check(); await batch().click();
  const replaced = await nextQueue();
  const beforeReplacement = requested.length;
  await page.getByLabel("Upload a photo", { exact: true }).setInputFiles(photo);
  await replaced.fulfill({ status: 204, body: "" });
  await page.waitForTimeout(150);
  record(requested.length === beforeReplacement && await queued.count() === 0, "Replacing photo stops pending batch remainder");
  fixture.requestId = "unverified-fixture"; fixture.winnerId = null;
  fixture.candidates = fixture.candidates.map((song) => ({ ...song, resolution: { kind: "unverified", url: "https://open.spotify.com/search/song" } }));
  await page.getByRole("button", { name: "Find my song", exact: true }).click();
  await page.getByRole("heading", { name: "No verified Spotify match" }).waitFor();
  record(await page.getByRole("button", { name: "Select available", exact: true }).isDisabled(), "All-unverified results disable select available");
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    record(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
  }
  record(errors.length === 0, `No browser runtime errors (${errors.join(", ")})`);
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally { await browser.close(); }
