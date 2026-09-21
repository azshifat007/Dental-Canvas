/**
 * Image object-storage plumbing (Settings → Storage).
 *
 * Two tiers:
 *  - Built-in database storage (provider "db", the default): uploads land in
 *    the D1 `patient_image_blobs` table and are served back through the API,
 *    so the imaging gallery works out of the box with zero configuration.
 *  - Any S3-compatible bucket (provider "s3"/"r2" — AWS S3, Cloudflare R2,
 *    MinIO, …): no platform binding needed because presigned URLs are
 *    platform-agnostic. Authentication uses Signature V4 (query-string
 *    flavour) computed with WebCrypto (HMAC-SHA256), which matches what the
 *    S3/R2 API endpoints expect.
 *
 * Credentials live in the settings table (masked on every read that leaves
 * the server), the browser never sees them, and bucket uploads go straight
 * from the browser to the bucket over short-lived HTTPS presigned URLs.
 *
 * Security properties we rely on:
 *  - every object key is namespaced under `patients/<id>/` and ends in a
 *    server-generated UUID, so keys are unguessable and scoped to one patient;
 *  - presigned URLs expire after `storage_expiry_minutes` (default 15);
 *  - the endpoint and any public base URL must be https (rejected otherwise);
 *  - AWS buckets are written with the `x-amz-server-side-encryption: AES256`
 *    header signed into the URL (R2 always encrypts at rest — AES-256 — and
 *    rejects the header, so it is only added for `s3` or MinIO-style buckets).
 */

import { query } from "./db";
import { DEFAULT_STORAGE_SETTINGS } from "./seed";

export const IMAGE_KINDS = ["xray", "intraoral", "panoramic", "photo"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

/**
 * Accepted upload MIME types. X-rays arrive as JPEG/PNG from most intraoral
 * sensors and DICOM from hospitals; DICOM files are stored but marked
 * "in-browser preview not available" by the viewer.
 */
export const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
  "image/avif",
  "application/dicom",
  "image/dicom",
]);

/** Per-file cap in MB for built-in DB storage; buckets accept up to max_file_mb. */
export const DB_STORAGE_MAX_MB = 5;
/** The proxy URL that serves a blob stored in the database. */
export function dbFileUrl(fileKey: string): string {
  return `/api/image-file?key=${encodeURIComponent(fileKey)}`;
}

export interface StorageSettings {
  provider: "none" | "db" | "s3" | "r2";
  /** Origin only (no path), must be https — e.g. https://<acct>.r2.cloudflarestorage.com */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional CDN/custom-domain base for stable display URLs, must be https. */
  publicBaseUrl: string;
  expiryMinutes: number;
  maxFileMb: number;
}

/** Read + merge the stored storage settings. Secrets never leave this module. */
export async function readStorageSettings(): Promise<StorageSettings> {
  const rows = await query<{ key: string; value: string }>("SELECT key, value FROM settings").catch(() => []);
  const store: Record<string, string> = {};
  for (const r of rows) store[r.key] = r.value;

  const provider = ["db", "s3", "r2"].includes(store.storage_provider ?? "")
    ? (store.storage_provider as "db" | "s3" | "r2")
    : "none";
  const d = DEFAULT_STORAGE_SETTINGS;
  const sseOverHttps = (v: string | undefined): string => (v ?? "").trim().replace(/\/+$/, "");
  const int = (raw: string | undefined, fallback: string): number => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number(fallback);
  };
  return {
    provider,
    endpoint: sseOverHttps(store.storage_endpoint),
    region: (store.storage_region ?? "").trim() || d.storage_region,
    bucket: (store.storage_bucket ?? "").trim(),
    accessKeyId: (store.storage_access_key_id ?? "").trim(),
    secretAccessKey: store.storage_secret_access_key ?? "",
    publicBaseUrl: sseOverHttps(store.storage_public_base_url),
    expiryMinutes: Math.max(1, Math.min(60, int(store.storage_expiry_minutes, d.storage_expiry_minutes))),
    maxFileMb: Math.max(1, Math.min(200, int(store.storage_max_file_mb, d.storage_max_file_mb))),
  };
}

/** True when storage is usable: the built-in database tier, or a configured bucket. */
export function isStorageConfigured(s: StorageSettings): boolean {
  if (s.provider === "db") return true;
  return (
    s.provider !== "none" &&
    /^https:\/\//i.test(s.endpoint) &&
    s.bucket !== "" &&
    s.accessKeyId !== "" &&
    s.secretAccessKey !== ""
  );
}

export function isDbStorage(s: StorageSettings): boolean {
  return s.provider === "db";
}

/**
 * Public display/GET URL for a stored object. DB-backed images are served
 * through the app proxy (same origin, so printing/Pdf works without the
 * cross-origin data-URL dance); bucket images use the public base URL if one
 * is set, otherwise a short-lived presigned GET. Returns null only when
 * storage is switched fully off ("none").
 */
export async function storageUrlForFile(fileKey: string): Promise<string | null> {
  const s = await readStorageSettings();
  if (!isStorageConfigured(s)) return null;
  if (isDbStorage(s)) return dbFileUrl(fileKey);
  if (s.publicBaseUrl) return `${s.publicBaseUrl}/${encodePath(fileKey)}`;
  const signed = await presignFile("GET", fileKey, s).catch(() => null);
  return signed?.url ?? null;
}

/**
 * Upload destination for a fresh object. In DB mode the browser PUTs the
 * bytes to the app proxy route; on a bucket it gets a presigned PUT URL.
 */
export async function presignUpload(fileKey: string): Promise<{ url: string; headers: Record<string, string> } | null> {
  const s = await readStorageSettings();
  if (!isStorageConfigured(s)) return null;
  if (isDbStorage(s)) return { url: dbFileUrl(fileKey), headers: {} };
  // MinIO/AWS-style buckets: AES-256 at rest via the request header. R2
  // encrypts automatically and rejects the header, so it is only added for s3.
  const extraHeaders = s.provider === "s3" ? { "x-amz-server-side-encryption": "AES256" } : undefined;
  return presignFile("PUT", fileKey, s, extraHeaders);
}

async function presignFile(
  method: "GET" | "PUT",
  fileKey: string,
  s: StorageSettings,
  extraHeaders?: Record<string, string>,
): Promise<{ url: string; headers: Record<string, string> } | null> {
  const signed = await signS3Url({
    method,
    endpoint: s.endpoint,
    bucket: s.bucket,
    key: fileKey,
    region: s.region,
    accessKeyId: s.accessKeyId,
    secretAccessKey: s.secretAccessKey,
    expiresSeconds: s.expiryMinutes * 60,
    extraHeaders,
  });
  return { url: signed.url, headers: signed.headers };
}

/** Server-side status object for the Settings → Storage tab (no secrets). */
export interface StorageStatus {
  provider: string;
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  public_base_url: string;
  expiry_minutes: number;
  max_file_mb: number;
  access_key_id: string;
  has_secret: boolean;
}

export async function storageStatus(): Promise<StorageStatus> {
  const s = await readStorageSettings();
  return {
    provider: s.provider,
    enabled: isStorageConfigured(s),
    endpoint: s.endpoint,
    region: s.region,
    bucket: s.bucket,
    public_base_url: s.publicBaseUrl,
    expiry_minutes: s.expiryMinutes,
    max_file_mb: s.maxFileMb,
    access_key_id: s.accessKeyId,
    has_secret: s.secretAccessKey !== "",
  };
}

/** Server-side validation for the Settings → Storage form. Returns an error message or null. */
export function validateStorageInput(input: Record<string, unknown>): string | null {
  const provider = typeof input.provider === "string" ? input.provider : "none";
  if (!["none", "db", "s3", "r2"].includes(provider)) return "Choose database, R2, S3, or disable storage.";
  // DB storage needs nothing; "none" turns uploads off entirely.
  if (provider === "none" || provider === "db") return null;
  const endpoint = String(input.endpoint ?? "").trim();
  const bucket = String(input.bucket ?? "").trim();
  const akid = String(input.access_key_id ?? "").trim();
  const secret = String(input.secret_access_key ?? "");
  if (!endpoint) return "Enter the bucket endpoint (https://…).";
  if (!/^https:\/\//i.test(endpoint)) return "The endpoint must be HTTPS.";
  if (!bucket) return "Enter the bucket name.";
  if (!akid) return "Enter the access key id.";
  if (!secret && !input.keep_secret) return "Enter the secret access key.";
  if (
    input.public_base_url !== undefined &&
    input.public_base_url !== null &&
    String(input.public_base_url).trim() !== "" &&
    !/^https:\/\//i.test(String(input.public_base_url).trim())
  ) {
    return "The public base URL must be HTTPS.";
  }
  const expiry = Number(input.expiry_minutes ?? 15);
  if (!Number.isFinite(expiry) || expiry < 1 || expiry > 60) return "Presigned URL expiry must be 1–60 minutes.";
  const maxMb = Number(input.max_file_mb ?? 25);
  if (!Number.isFinite(maxMb) || maxMb < 1 || maxMb > 200) return "Maximum file size must be 1–200 MB.";
  return null;
}

// ── Signature V4 (query-string flavour) ──────────────────────────
// Implemented to the AWS "signing requests" spec so generated URLs work
// against both AWS S3 and the S3-compatible R2/MinIO endpoints.

const enc = new TextEncoder();

function bytes(text: string): Uint8Array {
  return enc.encode(text);
}

export function hex(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const d = typeof data === "string" ? bytes(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", d as BufferSource));
}

/** Copy a string/typed-array into a fresh ArrayBuffer for the WebCrypto calls. */
function toBufferSource(v: string | Uint8Array): BufferSource {
  if (typeof v === "string") return enc.encode(v);
  return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
}

async function hmac(key: string | Uint8Array, data: string | Uint8Array): Promise<Uint8Array> {
  const imp = await crypto.subtle.importKey("raw", toBufferSource(key), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", imp, toBufferSource(data));
  return new Uint8Array(sig);
}

/** Encode a key's path segments (S3 expects unreserved chars + '/' only, single-encoding). */
export function encodePath(key: string): string {
  return key
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

const uriEncode = encodeURIComponent;

export function buildCanonicalRequest(
  method: string,
  canonicalUri: string,
  canonicalQuery: string,
  canonicalHeaders: string,
  signedHeaders: string,
  payloadHash: string,
): string {
  return [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
}

export interface SignParams {
  method: "GET" | "PUT" | "DELETE";
  /** Origin, e.g. https://s3.us-east-1.amazonaws.com or an R2 endpoint. */
  endpoint: string;
  bucket: string;
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Lifetime in seconds. */
  expiresSeconds: number;
  /** Extra headers to sign (sent by the uploader), e.g. { "x-amz-server-side-encryption": "AES256" }. */
  extraHeaders?: Record<string, string>;
  /** For deterministic tests. */
  now?: Date;
}

export interface SignedUrl {
  url: string;
  /** Headers the caller must send with the request (already signed). */
  headers: Record<string, string>;
}

/** Sign an S3-compatible presigned URL (V4, query-string). */
export async function signS3Url(p: SignParams): Promise<SignedUrl> {
  const now = p.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${p.region}/s3/aws4_request`;

  const host = new URL(p.endpoint).host;
  const extraHeaders = Object.entries(p.extraHeaders ?? {}).filter(([, v]) => v !== undefined && v !== "");
  const headerNames = ["host", ...extraHeaders.map(([k]) => k.toLowerCase())];
  const signedHeaders = headerNames.join(";");

  const canonicalUri = "/" + (p.bucket ? p.bucket + "/" : "") + encodePath(p.key);

  const query = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${p.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(p.expiresSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  query.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const canonicalQuery = query.map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join("&");

  const headerLines = [`host:${host}`, ...extraHeaders.map(([k, v]) => `${k.toLowerCase()}:${v}`)];
  const canonicalHeaders = headerLines.join("\n") + "\n";

  const payloadHash = "UNSIGNED-PAYLOAD";
  const canonicalRequest = buildCanonicalRequest(
    p.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  );
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmac(bytes("AWS4" + p.secretAccessKey), dateStamp);
  const kRegion = await hmac(kDate, p.region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  const url = `${p.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  const headers: Record<string, string> = {};
  for (const [k, v] of extraHeaders) headers[k] = v;
  return { url, headers };
}

// ── Object keys ───────────────────────────────────────────────────

/** Namespace a new object under one patient with a server-generated UUID. */
export function newObjectKey(patientId: number, originalName: string): string {
  const ext = /\.([a-zA-Z0-9]{1,12})$/.exec(originalName)?.[1]?.toLowerCase() ?? "bin";
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `patients/${patientId}/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;
}