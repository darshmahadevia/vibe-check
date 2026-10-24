import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
const { chromium } = await import(process.env.VIBE_PLAYWRIGHT_MODULE || "playwright");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.VIBE_CHROME_PATH ? { executablePath: process.env.VIBE_CHROME_PATH } : {}),
});
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vibe-drop-"));
const checks = [];
let imageServer;
const record = (condition, label) => {
  assert(condition, label);
  checks.push(label);
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const target = process.env.VIBE_CHECK_URL || "http://127.0.0.1:3000";
  await page.goto(target, { waitUntil: "networkidle" });
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const context = canvas.getContext("2d");
    context.fillStyle = "#687d6c";
    context.fillRect(0, 0, 800, 600);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const photo = path.join(directory, "moment.png");
  const invalid = path.join(directory, "invalid.txt");
  await fs.writeFile(photo, Buffer.from(encoded, "base64"));
  await fs.writeFile(invalid, "not an image");
  const session = await page.context().newCDPSession(page);
  let slowImageResponse;
  imageServer = http.createServer((request, response) => {
    const route = new URL(request.url, "http://fixture.local").pathname;
    if (route !== "/blocked.png") response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Content-Type", "image/png");
    if (route === "/slow.png") {
      slowImageResponse = response;
      return;
    }
    response.end(Buffer.from(encoded, "base64"));
  });
  await new Promise((resolve) => imageServer.listen(0, "127.0.0.1", resolve));
  const imageOrigin = `http://127.0.0.1:${imageServer.address().port}`;
  const data = (file) => ({ items: [], files: [file], dragOperationsMask: 1 });
  async function drag(type, point, file = photo) {
    await session.send("Input.dispatchDragEvent", { type, ...point, data: data(file) });
  }
  async function dropBrowserImage(url, includeHtml = true, htmlSource = url) {
    const point = await pointFor(".intro");
    const items = [{ mimeType: "text/uri-list", data: url }];
    if (includeHtml) items.push({ mimeType: "text/html", data: `<img src="${htmlSource}" alt="Dragged photo">` });
    for (const type of ["dragEnter", "dragOver", "drop"])
      await session.send("Input.dispatchDragEvent", { type, ...point, data: { items, dragOperationsMask: 1 } });
  }
  async function pointFor(selector) {
    const element = page.locator(selector);
    await element.scrollIntoViewIfNeeded();
    const box = await element.boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  async function dropAt(point, label) {
    const preview = page.locator(".photo-preview img");
    const previous = await preview.count() ? await preview.getAttribute("src") : null;
    await drag("dragEnter", point);
    await drag("dragOver", point);
    await drag("drop", point);
    const selected = await page.waitForFunction((before) => {
      const image = document.querySelector(".photo-preview img");
      return image && image.getAttribute("src") !== before;
    }, previous, { timeout: 2000 }).then(() => true, () => false);
    record(selected, label);
  }
  await dropBrowserImage(`${imageOrigin}/photo-without-extension`);
  const browserImageLoaded = await page.waitForSelector(".photo-preview img", { timeout: 2000 }).then(() => true, () => false);
  record(browserImageLoaded, "Dropping an image from another browser tab selects the photo");
  const browserImage = await page.locator(".photo-preview img").getAttribute("src");
  await dropBrowserImage(`${imageOrigin}/image.png`, false);
  await page.waitForFunction((before) => document.querySelector(".photo-preview img")?.getAttribute("src") !== before, browserImage);
  record(true, "An image URL without HTML also works");
  const beforeLinkedImage = await page.locator(".photo-preview img").getAttribute("src");
  await dropBrowserImage("https://example.com/ordinary-page", true, `${imageOrigin}/linked-photo`);
  await page.waitForFunction((before) => document.querySelector(".photo-preview img")?.getAttribute("src") !== before, beforeLinkedImage);
  record(true, "An image wrapped in a link imports the image rather than its destination page");
  await dropAt(await pointFor(".intro"), "Dropping a file on the hero selects the photo");
  await dropAt(await pointFor(".sleeve-stage"), "Dropping on the gallery replaces the photo");
  await dropAt({ x: 5, y: 300 }, "Dropping in the page gutter selects the photo");
  await dropAt(await pointFor(".actions .secondary:first-child"), "Dropping over an upload button selects the photo once");
  record(await page.locator(".artwork-choice").count() === 1, "Repeated drops retain exactly one photo selector");
  const panel = await pointFor(".photo-section");
  await drag("dragEnter", panel);
  await drag("dragOver", panel);
  await page.locator(".file-drop-feedback").getByText("Drop your photo here", { exact: true }).waitFor();
  record(true, "A native file drag displays the drop instruction");
  await drag("dragOver", await pointFor(".actions .secondary:first-child"));
  record(await page.locator(".file-drop-feedback").isVisible(), "Drop feedback stays visible over child controls");
  await page.screenshot({ path: path.join(directory, "drag-feedback.png"), style: "nextjs-portal { display:none!important; }" });
  await page.keyboard.press("Escape");
  await drag("dragCancel", panel);
  await page.locator(".file-drop-feedback").waitFor({ state: "hidden", timeout: 2000 });
  record(true, "Escape cancels a native drag and clears the feedback");
  await drag("dragEnter", panel, invalid);
  await drag("dragOver", panel, invalid);
  await drag("drop", panel, invalid);
  await page.getByRole("alert").filter({ hasText: "That file didn't work" }).waitFor();
  record(true, "An invalid dropped file shows a recovery message");
  record(await page.locator(".file-drop-feedback").count() === 0, "An invalid drop clears the drag feedback");
  const textAllowed = await page.locator(".intro").evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "ordinary text");
    const over = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer });
    const drop = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer });
    return element.dispatchEvent(over) && element.dispatchEvent(drop);
  });
  record(textAllowed, "Ordinary text drags are not intercepted");
  const linkAllowed = await page.locator(".intro").evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData("text/uri-list", "https://example.com/page");
    transfer.setData("text/html", '<a href="https://example.com/page">An ordinary link</a>');
    return element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  record(linkAllowed, "An ordinary HTML link is not mistaken for a photo");
  await dropBrowserImage(`${imageOrigin}/blocked.png`);
  await page.getByRole("alert").filter({ hasText: /save.*photo/i }).waitFor();
  record(true, "A site that blocks image access shows a save-and-upload fallback");
  await dropAt(await pointFor(".intro"), "A valid drop recovers after an invalid file");
  const oldPreview = await page.locator(".photo-preview img").getAttribute("src");
  await dropBrowserImage(`${imageOrigin}/slow.png`);
  await page.waitForFunction(() => document.querySelector(".photo-copy")?.textContent.includes("Preparing"));
  await dropAt(await pointFor(".intro"), "A local file can replace a pending browser image");
  const localPreview = await page.locator(".photo-preview img").getAttribute("src");
  if (slowImageResponse && !slowImageResponse.destroyed) slowImageResponse.end(Buffer.from(encoded, "base64"));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  record(localPreview !== oldPreview && await page.locator(".photo-preview img").getAttribute("src") === localPreview, "A late browser image cannot replace the newer local photo");
  record(page.url() === new URL(target).href, "File drops keep the browser on the app");
  console.log(`PASS ${checks.length} photo drop checks`);
  console.log(JSON.stringify(checks));
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  if (imageServer) {
    imageServer.closeAllConnections();
    await new Promise((resolve) => imageServer.close(resolve));
  }
  await fs.rm(directory, { recursive: true, force: true });
}
