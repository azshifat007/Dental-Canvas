/**
 * Shared paper-document helpers for the printable sheets (prescriptions,
 * invoices). The sheets are plain inline-styled markup, so printing works by
 * cloning the rendered DOM into a dedicated iframe with A4 @page rules — this
 * keeps the app's dark theme and layout out of the paper output.
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/**
 * Print the current markup of a sheet host element on A4 paper. Clones the
 * host's live DOM into a hidden iframe so the app stylesheet can never leak
 * onto the paper, then removes the iframe shortly after the dialog closes.
 */
export function printSheetHtml(host: HTMLElement | null, title: string): void {
  if (!host) return;
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
      <style>
        @page { size: A4; margin: 0; }
        html, body { margin: 0; padding: 0; background: #ffffff; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      </style></head><body>${host.innerHTML}</body></html>`,
  );
  doc.close();
  const done = () => {
    window.setTimeout(() => frame.remove(), 500);
    frame.removeEventListener("load", done);
  };
  frame.addEventListener("load", () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    done();
  });
}

// html-to-image is lazy-loaded on first PDF download — printing never pays for it.
async function loadHtmlToImage(): Promise<typeof import("html-to-image")> {
  return import("html-to-image");
}

/**
 * The app loads Inter from Google Fonts. The renderer cannot read cssRules
 * off a cross-origin stylesheet (SecurityError) and its own font pipeline
 * stalls on it, so we fetch the CSS text and the woff2 files it references
 * ourselves — both endpoints are CORS-enabled — and inline them as data URLs.
 * The result is cached; a failure or timeout degrades to system fonts rather
 * than failing the download.
 */
let fontEmbedCss: string | null | undefined;
async function getFontEmbedCss(): Promise<string | null> {
  if (fontEmbedCss !== undefined) return fontEmbedCss;
  fontEmbedCss = await Promise.race([
    (async () => {
      try {
        // Must be the actual stylesheet — a preconnect <link> shares the domain
        // and would fetch the bare origin (CORS-blocked, not CSS).
        const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]');
        if (!link) return null;
        const css = await fetch(link.href).then((r) => r.text());
        const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
        if (urls.length === 0) return css;
        const dataUrls = await Promise.all(
          urls.map((u) =>
            fetch(u)
              .then((r) => r.blob())
              .then(
                (b) =>
                  new Promise<string>((resolve, reject) => {
                    const fr = new FileReader();
                    fr.onload = () => resolve(fr.result as string);
                    fr.onerror = () => reject(fr.error);
                    fr.readAsDataURL(b);
                  }),
              ),
          ),
        );
        let inlined = css;
        for (let i = 0; i < urls.length; i++) inlined = inlined.split(urls[i]).join(dataUrls[i]);
        return inlined;
      } catch {
        return null; // fall back to system fonts
      }
    })(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
  ]);
  return fontEmbedCss;
}

/**
 * Rasterize the sheet DOM and build the A4 PDF blob. Shared by the download
 * button and the share action. Rasterizes the live sheet at print resolution
 * and embeds it edge-to-edge on a real 210×297 mm page, so the PDF is exactly
 * what prints — same templates, logo, watermark and large-print scaling, no
 * re-layout. Rasterized text is not selectable, which is acceptable for a
 * printed prescription.
 */
async function buildSheetPdfBlob(host: HTMLElement | null): Promise<Blob> {
  if (!host) throw new Error("Nothing to render");
  // The sheet element itself (BASE_PAGE) carries the exact 210mm × min-height
  // layout; rasterize that rather than the scaling wrapper around it.
  const sheet = (host.firstElementChild as HTMLElement | null) ?? host;

  const { toCanvas } = await loadHtmlToImage();
  const fonts = await getFontEmbedCss();
  // pixelRatio ~2x of the mm-true CSS size ≈ 190 dpi on paper.
  // Guard EVERY rasterization attempt with a timeout: foreignObject image
  // decoding can hang in some engines; a retry (without embedded fonts) or a
  // clean error beats a stuck button.
  function toCanvasGuarded(opts: Parameters<typeof toCanvas>[1]): Promise<HTMLCanvasElement> {
    // `never` (not `null`) so the race's success type stays HTMLCanvasElement.
    return Promise.race([
      toCanvas(sheet, opts),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 30_000)),
    ]);
  }
  const canvas = await toCanvasGuarded({
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    fontEmbedCSS: fonts ?? undefined,
    skipFonts: !fonts,
  }).catch(async (err) => {
    if (fonts) {
      // Retry once with system fonts rather than failing the share.
      return toCanvasGuarded({ pixelRatio: 2, backgroundColor: "#ffffff", skipFonts: true });
    }
    throw err;
  });

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  // The canvas is 210mm × contentHeight; fit width and let height follow so
  // multi-page-tall sheets stay proportional (A4 height is the print target).
  const pageW = 210;
  const pageH = (canvas.height / canvas.width) * pageW;
  pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, pageH, undefined, "FAST");
  return pdf.output("blob");
}

/** Download the sheet's current markup as a true A4 PDF file. */
export async function downloadSheetPdf(host: HTMLElement | null, filename: string): Promise<void> {
  const blob = await buildSheetPdfBlob(host);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Generate the sheet PDF and return it as a base64 string (for API relay). */
export async function sheetPdfBase64(host: HTMLElement | null): Promise<string> {
  const blob = await buildSheetPdfBlob(host);
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Share the sheet as a PDF *file* — not a link. On devices with a native
 * share sheet (Android/iOS, some desktops) this hands the actual PDF to the
 * OS so the patient can be sent it via WhatsApp, SMS, email, etc. Browsers
 * without the Web Share API (or without file support) fall back to a plain
 * download, which can then be attached to any message.
 */
export async function shareSheetPdf(
  host: HTMLElement | null,
  filename: string,
  opts: { title?: string; text?: string } = {},
): Promise<"shared" | "downloaded"> {
  const blob = await buildSheetPdfBlob(host);
  const file = new File([blob], filename, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: opts.title, text: opts.text });
    return "shared";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
