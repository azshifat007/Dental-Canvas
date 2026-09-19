/**
 * Clinic logo file handling for Settings → Profile.
 *
 * The logo is stored as a data URL in the settings table (no file storage on
 * the serverless API) and printed on prescription/invoice letterheads. The
 * server refuses anything that is not a small `data:image/*` URL, so this
 * helper validates and — for photos — downscales before it ever hits the wire.
 */

/** Must match the server-side cap in src/server/index.ts (isSafeLogoDataUrl). */
const MAX_LOGO_LENGTH = 400_000;
/** Downscaled images are drawn at most this tall (plenty for a letterhead). */
const MAX_HEIGHT_PX = 256;

export class LogoError extends Error {}

export async function fileToLogoDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new LogoError("Please choose an image file (PNG, SVG, JPEG…).");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new LogoError("That image is too large (over 8 MB).");
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new LogoError("Could not read the file."));
    reader.readAsDataURL(file);
  });

  if (dataUrl.length <= MAX_LOGO_LENGTH) return dataUrl;

  // Too big as-is (typical for photos): downscale on a canvas. PNG first so
  // transparent logos stay transparent; JPEG fallback if PNG still overflows.
  const png = await downscale(dataUrl, "image/png");
  if (png.length <= MAX_LOGO_LENGTH) return png;
  const jpeg = await downscale(dataUrl, "image/jpeg");
  if (jpeg.length <= MAX_LOGO_LENGTH) return jpeg;
  throw new LogoError("Logo is too large even after resizing — try a smaller image.");
}

async function downscale(dataUrl: string, mime: "image/png" | "image/jpeg"): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new LogoError("Could not decode the image."));
    el.src = dataUrl;
  });

  const scale = Math.min(1, MAX_HEIGHT_PX / img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new LogoError("Could not process the image.");
  if (mime === "image/jpeg") {
    // JPEG has no alpha — flatten onto white so transparent areas stay sane.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(mime, 0.85);
}
