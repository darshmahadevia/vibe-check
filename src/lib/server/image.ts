import "server-only";
import sharp from "sharp";
import { RecommendationError } from "./gemma";

export const MAX_BODY_BYTES = 1_200_000;
export async function readPhoto(request: Request): Promise<Uint8Array> {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    throw new RecommendationError("invalid_image", "That file didn't work. Try a JPEG or PNG.", 400);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RecommendationError("invalid_image", "Choose a photo first.", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RecommendationError("image_too_large", "That photo is too large. Choose it again to resize it.", 413);
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks);
    const form = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const photo = form.get("photo");
    if (!(photo instanceof File) || photo.type !== "image/jpeg") throw new Error("Invalid image");
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const image = sharp(bytes, { limitInputPixels: 768 * 768, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== "jpeg" || !metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > 768) throw new Error("Invalid image");
    return await image.jpeg().toBuffer();
  } catch (error) {
    if (error instanceof RecommendationError) throw error;
    throw new RecommendationError("invalid_image", "That file didn't work. Try a JPEG or PNG.", 400);
  } finally { reader.releaseLock(); }
}
