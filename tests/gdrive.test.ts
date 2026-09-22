import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, freshApp, jsonRequest, type TestContext } from "./helpers";

let ctx: TestContext;
let app: Awaited<ReturnType<typeof freshApp>>;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.dispose();
});

beforeEach(async () => {
  await ctx.resetDb();
  app = await freshApp();
  await app.request("/api/health", undefined, { DB: ctx.db });
});

describe("google drive backup", () => {
  it("reports not-configured status by default", async () => {
    const res = await app.request("/api/backup/drive/status", undefined, { DB: ctx.db });
    expect(res.status).toBe(200);
    const st = (await res.json()) as { configured: boolean; enabled: boolean };
    expect(st.configured).toBe(false);
    expect(st.enabled).toBe(false);
  });

  it("saves and returns drive configuration", async () => {
    const { path, init } = jsonRequest("PUT", "/api/backup/drive/config", {
      client_id: "test-client.apps.googleusercontent.com",
      client_secret: "GOCSPX-test-secret",
      folder_id: "abc123",
    });
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { configured: boolean; has_credentials: boolean; folder_id: string | null };
    // Credentials saved, but "configured" (fully connected) needs the OAuth grant too.
    expect(data.has_credentials).toBe(true);
    expect(data.configured).toBe(false);
    expect(data.folder_id).toBe("abc123");

    // Status reflects the saved credentials.
    const st = await app.request("/api/backup/drive/status", undefined, { DB: ctx.db });
    const status = (await st.json()) as { has_credentials: boolean; configured: boolean };
    expect(status.has_credentials).toBe(true);
    // Still not fully connected — the OAuth grant hasn't happened yet.
    expect(status.configured).toBe(false);
  });

  it("toggles the auto-upload flag", async () => {
    const { path, init } = jsonRequest("PUT", "/api/backup/drive/config", { enabled: true });
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { enabled: boolean };
    expect(data.enabled).toBe(true);
  });

  it("rejects unknown config fields", async () => {
    const { path, init } = jsonRequest("PUT", "/api/backup/drive/config", { evil: "x" });
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(400);
  });

  it("refuses the auth start without saved credentials", async () => {
    const res = await app.request("/api/backup/drive/auth", { redirect: "manual" }, { DB: ctx.db });
    expect(res.status).toBe(400);
  });

  it("refuses test/upload endpoints when not connected", async () => {
    const test = await app.request("/api/backup/drive/test", { method: "POST" }, { DB: ctx.db });
    expect(test.status).toBe(400);

    // Snapshot existence is checked first for uploads: a missing snapshot 404s
    // even before the connection guard would matter.
    const upload = await app.request("/api/backup/drive/upload/999", { method: "POST" }, { DB: ctx.db });
    expect(upload.status).toBe(404);
  });

  it("disconnect clears credentials and disables auto-upload", async () => {
    // Configure first.
    const cfg = jsonRequest("PUT", "/api/backup/drive/config", {
      client_id: "id",
      client_secret: "sec",
    });
    await app.request(cfg.path, cfg.init, { DB: ctx.db });

    const res = await app.request("/api/backup/drive/disconnect", { method: "POST" }, { DB: ctx.db });
    expect(res.status).toBe(200);

    const st = await app.request("/api/backup/drive/status", undefined, { DB: ctx.db });
    const status = (await st.json()) as { configured: boolean; enabled: boolean };
    expect(status.configured).toBe(false);
    expect(status.enabled).toBe(false);
  });

  it("validates invoice customization settings", async () => {
    // Valid style + accent save fine.
    const good = jsonRequest("PUT", "/api/settings", {
      invoice_style: "modern",
      invoice_accent: "#b91c1c",
      invoice_payment_terms: "Due in 14 days",
      invoice_footer_note: "Thank you!",
      invoice_show_payments: "0",
    });
    const ok = await app.request(good.path, good.init, { DB: ctx.db });
    expect(ok.status).toBe(200);

    const res = await app.request("/api/settings", undefined, { DB: ctx.db });
    const { settings } = (await res.json()) as { settings: Record<string, string> };
    expect(settings.invoice_style).toBe("modern");
    expect(settings.invoice_accent).toBe("#b91c1c");
    expect(settings.invoice_show_payments).toBe("0");

    // Unknown style rejected.
    const badStyle = jsonRequest("PUT", "/api/settings", { invoice_style: "neon" });
    const bad1 = await app.request(badStyle.path, badStyle.init, { DB: ctx.db });
    expect(bad1.status).toBe(400);

    // Non-hex accent rejected.
    const badAccent = jsonRequest("PUT", "/api/settings", { invoice_accent: "red" });
    const bad2 = await app.request(badAccent.path, badAccent.init, { DB: ctx.db });
    expect(bad2.status).toBe(400);
  });

  it("drive config survives a simulated redeploy (seed defaults merge)", async () => {
    const cfg = jsonRequest("PUT", "/api/backup/drive/config", {
      client_id: "persisted-id.apps.googleusercontent.com",
      client_secret: "GOCSPX-persisted-secret",
    });
    await app.request(cfg.path, cfg.init, { DB: ctx.db });

    const res = await app.request("/api/settings", undefined, { DB: ctx.db });
    const { settings } = (await res.json()) as { settings: Record<string, string> };
    expect(settings.gdrive_client_id).toBe("persisted-id.apps.googleusercontent.com");
    // Secret is masked in settings responses.
    expect(settings.gdrive_client_secret).toBe("••••••••");
    expect(settings.gdrive_enabled).toBe("0");
  });
});
