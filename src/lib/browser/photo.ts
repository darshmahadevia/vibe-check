export type PreparedPhoto = {
  blob: Blob;
  preview: string;
  width: number;
  height: number;
};
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 25 * 1024 * 1024
  ) {
    throw new Error("That file didn't work. Try a JPEG or PNG.");
  }
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("JPEG conversion failed")),
        "image/jpeg",
        0.85,
      ),
    );
    if (blob.size > 1_000_000) throw new Error("Image too large");
    return {
      blob,
      preview: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    throw new Error("That file didn't work. Try a JPEG or PNG.");
  } finally {
    bitmap?.close();
  }
}
