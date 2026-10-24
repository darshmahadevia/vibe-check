import { expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
import { MAX_BODY_BYTES, readPhoto } from "./image";
function request(bytes: Uint8Array, type = "image/jpeg") {
  const form = new FormData();
  form.set("photo", new Blob([Uint8Array.from(bytes)], { type }), "photo.jpg");
  return new Request("https://vibe.test/api/recommend", {
    method: "POST",
    body: form,
  });
}
it("decodes a real resized JPEG", async () => {
  const bytes = await sharp({
    create: { width: 768, height: 512, channels: 3, background: "#678985" },
  })
    .jpeg()
    .toBuffer();
  const result = await readPhoto(request(bytes));
  expect((await sharp(result).metadata()).width).toBe(768);
});
it("rejects disguised, unreadable and oversized images before inference", async () => {
  await expect(
    readPhoto(request(new Uint8Array([1, 2, 3]))),
  ).rejects.toMatchObject({ status: 400 });
  const bytes = await sharp({
    create: { width: 769, height: 400, channels: 3, background: "red" },
  })
    .jpeg()
    .toBuffer();
  await expect(readPhoto(request(bytes))).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    readPhoto(request(new Uint8Array(MAX_BODY_BYTES + 1))),
  ).rejects.toMatchObject({ status: 413 });
});
