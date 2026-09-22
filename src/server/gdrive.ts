import { query, run } from "./db";

/**
 * Google Drive backup destination.
 *
 * Uses the Drive REST API v3 with the least-privilege `drive.file` scope: the
 * app can only see and manage files it created itself, never the rest of the
 * practice's Drive. Tokens are exchanged server-side; the browser only ever
 * sees connection status.
 *
 * Settings keys (stored in the shared `settings` table so they survive
 * redeploys):
 *   gdrive_client_id / gdrive_client_secret — OAuth client ("Web application"
 *     type) from Google Cloud Console
 *   gdrive_refresh_token — long-lived grant from the connect flow
 *   gdrive_folder_id — target folder (auto-created "Dental Canvas Backups"
 *     folder when empty)
 *   gdrive_enabled — "1" uploads automatic backups to Drive
 *   gdrive_last_upload_at / gdrive_last_upload_ok / gdrive_last_upload_error
 *     — result of the most recent upload attempt, for the UI
 */

export interface DriveSettings {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  folder_id: string;
  enabled: boolean;
  last_upload_at: string;
  last_upload_ok: boolean;
  last_upload_error: string;
}

const SETTING_KEYS = [
  "gdrive_client_id",
  "gdrive_client_secret",
  "gdrive_refresh_token",
  "gdrive_folder_id",
  "gdrive_enabled",
  "gdrive_last_upload_at",
  "gdrive_last_upload_ok",
  "gdrive_last_upload_error",
] as const;

const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_DEFAULT_FOLDER_NAME = "Dental Canvas Backups";

export async function getDriveSettings(): Promise<DriveSettings> {
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key IN (${SETTING_KEYS.map(() => "?").join(", ")})`,
    [...SETTING_KEYS],
  ).catch(() => [] as { key: string; value: string }[]);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    client_id: (map.gdrive_client_id ?? "").trim(),
    client_secret: (map.gdrive_client_secret ?? "").trim(),
    refresh_token: (map.gdrive_refresh_token ?? "").trim(),
    folder_id: (map.gdrive_folder_id ?? "").trim(),
    enabled: (map.gdrive_enabled ?? "0") === "1",
    last_upload_at: (map.gdrive_last_upload_at ?? "").trim(),
    last_upload_ok: (map.gdrive_last_upload_ok ?? "") === "1",
    last_upload_error: (map.gdrive_last_upload_error ?? "").trim(),
  };
}

export function hasCredentials(d: DriveSettings): boolean {
  return Boolean(d.client_id && d.client_secret);
}

/** Fully connected = credentials + a refresh token from the OAuth flow. */
export function isDriveConfigured(d: DriveSettings): boolean {
  return hasCredentials(d) && Boolean(d.refresh_token);
}

async function setSetting(key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, value],
  );
}

/** Record the outcome of an upload attempt for the settings UI. */
export async function recordUploadResult(ok: boolean, error?: string): Promise<void> {
  await setSetting("gdrive_last_upload_at", new Date().toISOString());
  await setSetting("gdrive_last_upload_ok", ok ? "1" : "0");
  await setSetting("gdrive_last_upload_error", ok ? "" : (error ?? "Unknown error"));
}

// ── OAuth ───────────────────────────────────────────────────────────

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export function authUrl(clientId: string, redirectUri: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    // Force a refresh token even if the user granted before.
    prompt: "consent",
    include_granted_scopes: "false",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  return (await res.json().catch(() => ({}))) as TokenResponse;
}

/** Exchange the consent-screen code for tokens; returns the refresh token. */
export async function exchangeCodeForTokens(
  d: DriveSettings,
  code: string,
  redirectUri: string,
): Promise<{ ok: true; refresh_token: string } | { ok: false; error: string }> {
  const r = await tokenRequest({
    code,
    client_id: d.client_id,
    client_secret: d.client_secret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (r.error || !r.refresh_token) {
    return {
      ok: false,
      error: r.error_description || r.error || "Google did not return a refresh token",
    };
  }
  return { ok: true, refresh_token: r.refresh_token };
}

/** Refresh-token → short-lived access token for API calls. */
async function getAccessToken(d: DriveSettings): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const r = await tokenRequest({
    refresh_token: d.refresh_token,
    client_id: d.client_id,
    client_secret: d.client_secret,
    grant_type: "refresh_token",
  });
  if (r.error || !r.access_token) {
    return {
      ok: false,
      // invalid_grant = the user revoked access or the token was invalidated:
      // the fix is always "connect again", so say that plainly.
      error:
        r.error === "invalid_grant"
          ? "Google authorization expired or revoked — reconnect your account."
          : r.error_description || r.error || "Could not refresh the Google access token",
    };
  }
  return { ok: true, token: r.access_token };
}

// ── Drive files ─────────────────────────────────────────────────────

/** Find the target folder id, creating the default folder on first use. */
async function resolveFolderId(d: DriveSettings, token: string): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  if (d.folder_id) return { ok: true, id: d.folder_id };
  const q = encodeURIComponent(
    `name = '${DRIVE_DEFAULT_FOLDER_NAME.replace(/'/g, "\\'")}' and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false`,
  );
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    const data = (await res.json().catch(() => ({ files: [] }))) as { files?: { id: string }[] };
    const existing = data.files?.[0]?.id;
    if (existing) return { ok: true, id: existing };
  }
  // Not found (or the listing failed) — try to create it. If creation fails
  // too, fall back to uploading at the Drive root rather than failing the
  // whole backup.
  const create = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: DRIVE_DEFAULT_FOLDER_NAME, mimeType: DRIVE_FOLDER_MIME }),
  });
  if (create.ok) {
    const data = (await create.json().catch(() => ({}))) as { id?: string };
    if (data.id) return { ok: true, id: data.id };
  }
  return { ok: true, id: null };
}

export interface DriveUploadResult {
  ok: boolean;
  file_id?: string;
  error?: string;
}

/**
 * Upload a JSON backup payload as a file. Uses the multipart endpoint so the
 * name and parent folder travel with the content in one request.
 */
export async function uploadJsonToDrive(
  filename: string,
  json: string,
  d: DriveSettings,
): Promise<DriveUploadResult> {
  if (!isDriveConfigured(d)) {
    return { ok: false, error: "Google Drive is not connected yet." };
  }
  const auth = await getAccessToken(d);
  if (!auth.ok) return { ok: false, error: auth.error };

  const folder = await resolveFolderId(d, auth.token);

  const boundary = "dentalcanvasbackup" + Math.random().toString(36).slice(2);
  const metadata: Record<string, unknown> = { name: filename };
  if (folder.ok && folder.id) metadata.parents = [folder.id];

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${json}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `Google Drive rejected the upload (${res.status}). ${text.slice(0, 200)}` };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, file_id: data.id };
}

/** Tiny connectivity probe used by the settings "Test connection" button. */
export async function testDriveConnection(d: DriveSettings): Promise<DriveUploadResult> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const r = await uploadJsonToDrive(
    `dental-canvas-connection-test-${stamp}.json`,
    JSON.stringify({ probe: "dental-canvas", at: new Date().toISOString() }),
    d,
  );
  if (r.ok) await recordUploadResult(true);
  return r;
}
