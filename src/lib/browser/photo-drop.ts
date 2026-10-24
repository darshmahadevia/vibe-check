const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const BROWSER_IMAGE_ERROR =
  "This site won’t let us read its image. Save the photo, then drop the saved file or use Upload a photo.";
const UNSUPPORTED_IMAGE_ERROR =
  "Couldn't read that browser image. Save the photo, then drop the saved file or use Upload a photo.";
const IMAGE_SIZE_ERROR = "That photo is too large. Try one smaller than 25 MB.";

export type PhotoDrop =
  | { kind: "file"; file: File }
  | { kind: "image-url"; url: URL }
  | { kind: "unsupported-image"; message: string }
  | { kind: "not-image" };

export function isPhotoDrag(dataTransfer: DataTransfer): boolean {
  return (
    dataTransfer.types.includes("Files") ||
    Array.from(dataTransfer.items).some((item) => item.kind === "file") ||
    dataTransfer.types.includes("text/html") ||
    dataTransfer.types.includes("text/uri-list")
  );
}

function isImageUrl(url: URL): boolean {
  return (
    /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(url.href) ||
    /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(
      url.pathname,
    )
  );
}

function absoluteUrl(source: string | undefined): URL | null {
  if (!source) return null;
  try {
    return new URL(source);
  } catch {
    return null;
  }
}

export function parsePhotoDrop(dataTransfer: DataTransfer): PhotoDrop {
  const files = Array.from(dataTransfer.files);
  const file = files.find((entry) => entry.type.startsWith("image/")) ?? files[0];
  if (file) return { kind: "file", file };

  const html = dataTransfer.getData("text/html");
  const template = document.createElement("template");
  template.innerHTML = html;
  const image = template.content.querySelector("img");
  if (html && !image) return { kind: "not-image" };

  const uri = dataTransfer
    .getData("text/uri-list")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  const uriUrl = absoluteUrl(uri);
  const imageUrl = absoluteUrl(image?.getAttribute("src")?.trim());
  const url =
    uriUrl && (isImageUrl(uriUrl) || !imageUrl || uriUrl.href === imageUrl.href)
      ? uriUrl
      : imageUrl;
  if (!url) {
    return image || dataTransfer.types.includes("Files")
      ? { kind: "unsupported-image", message: UNSUPPORTED_IMAGE_ERROR }
      : { kind: "not-image" };
  }
  if (!image && !isImageUrl(url)) return { kind: "not-image" };
  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:" &&
    !/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(url.href)
  ) {
    return { kind: "unsupported-image", message: UNSUPPORTED_IMAGE_ERROR };
  }
  if (url.protocol === "data:" && url.href.length > MAX_SOURCE_BYTES * 3 + 256)
    return { kind: "unsupported-image", message: IMAGE_SIZE_ERROR };
  return { kind: "image-url", url };
}

export async function loadBrowserPhoto({
  url,
  signal,
}: {
  url: URL;
  signal: AbortSignal;
}): Promise<File> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      mode: "cors",
    });
  } catch {
    throw new Error(BROWSER_IMAGE_ERROR);
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error(BROWSER_IMAGE_ERROR);
  }
  if (Number(response.headers.get("content-length")) > MAX_SOURCE_BYTES) {
    await response.body.cancel().catch(() => {});
    throw new Error(IMAGE_SIZE_ERROR);
  }
  const type = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type)) {
    await response.body.cancel().catch(() => {});
    throw new Error("That image didn't work. Try a JPEG or PNG.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SOURCE_BYTES) throw new Error(IMAGE_SIZE_ERROR);
      chunks.push(new Uint8Array(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw new Error(
      error instanceof Error && error.message === IMAGE_SIZE_ERROR
        ? IMAGE_SIZE_ERROR
        : BROWSER_IMAGE_ERROR,
    );
  } finally {
    reader.releaseLock();
  }
  return new File(chunks, "browser-photo", { type });
}
