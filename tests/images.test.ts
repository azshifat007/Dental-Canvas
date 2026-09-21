import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, freshApp, jsonRequest, type TestContext } from "./helpers";
import { signS3Url, buildCanonicalRequest } from "../src/server/storage";
import { SEED_MEDICINES, DEFAULT_STORAGE_SETTINGS } from "../src/server/seed";

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
  // First request triggers the seed lifecycle (settings + medicines + storage defaults).
  await app.request("/api/health", undefined, { DB: ctx.db });
});

async function seedPatient(overrides: Record<string, unknown> = {}) {
  const { path, init } = jsonRequest("POST", "/api/patients", {
    first_name: "Grace",
    last_name: "Hopper",
    date_of_birth: "1990-05-10",
    ...overrides,
  });
  const res = await app.request(path, init, { DB: ctx.db });
  expect(res.status).toBe(201);
  const data = (await res.json()) as { patient: { id: number } };
  return data.patient.id;
}

async function getSetting(db: TestContext["db"], key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

function configBody(overrides: Record<string, unknown> = {}) {
  return {
    provider: "r2",
    endpoint: "https://f00deadbeef.example.r2.cloudflarestorage.com",
    region: "auto",
    bucket: "dental-canvas-media",
    access_key_id: "AKIAIOSFODNN7EXAMPLE",
    secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    public_base_url: null,
    expiry_minutes: 15,
    max_file_mb: 25,
    ...overrides,
  };
}

function rxBody(patientId: number, overrides: Record<string, unknown> = {}) {
  return {
    patient_id: patientId,
    template: "classic",
    diagnosis: "Acute periapical abscess, tooth 36",
    items: [{ drug_name: "Amoxicillin", dosage: "500 mg", frequency: "3x daily", duration: "5 days", instructions: "after meals" }],
    ...overrides,
  };
}

// ── Signature V4 (AWS documented test vector) ─────────────────────

describe("Signature V4 presigning", () => {
  it("reproduces the AWS documented GetObject signature", async () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
    // Example: GET Object (path-style), host is the bucket, so `bucket` is "".
    const signed = await signS3Url({
      method: "GET",
      endpoint: "https://examplebucket.s3.amazonaws.com",
      bucket: "",
      key: "test.txt",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      expiresSeconds: 86400,
      now: new Date("2013-05-24T00:00:00.000Z"),
    });
    expect(signed.headers).toEqual({});
    expect(signed.url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(signed.url).toContain(`X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404`);
    expect(signed.url).toContain("/test.txt?");
  });

  it("signs extra headers (SSE) so uploads carry x-amz-server-side-encryption", async () => {
    const signed = await signS3Url({
      method: "PUT",
      endpoint: "https://s3.us-east-1.amazonaws.com",
      bucket: "demo-bucket",
      key: "patients/1/2026/09/x.png",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      expiresSeconds: 900,
      extraHeaders: { "x-amz-server-side-encryption": "AES256" },
      now: new Date("2026-09-20T00:00:00.000Z"),
    });
    expect(signed.headers["x-amz-server-side-encryption"]).toBe("AES256");
    expect(signed.url).toContain("X-Amz-SignedHeaders=host%3Bx-amz-server-side-encryption");
    expect(signed.url).toContain("/demo-bucket/patients/1/2026/09/x.png");
  });

  it("builds the canonical request per the AWS shape", () => {
    const canonical = buildCanonicalRequest(
      "GET",
      "/test.txt",
      "X-Amz-Algorithm=AWS4-HMAC-SHA256",
      "host:examplebucket.s3.amazonaws.com\n",
      "host",
      "UNSIGNED-PAYLOAD",
    );
    expect(canonical).toBe(
      "GET\n/test.txt\nX-Amz-Algorithm=AWS4-HMAC-SHA256\nhost:examplebucket.s3.amazonaws.com\n\nhost\nUNSIGNED-PAYLOAD",
    );
  });
});

// ── Storage configuration (Settings → Storage) ────────────────────

describe("storage configuration", () => {
  it("defaults to the built-in database storage tier and can be switched off", async () => {
    const before = (await (await app.request("/api/storage/config", undefined, { DB: ctx.db })).json()) as {
      enabled: boolean;
      provider: string;
      has_secret: boolean;
    };
    expect(before.enabled).toBe(true); // DB storage needs no credentials
    expect(before.provider).toBe("db");
    expect(before.has_secret).toBe(false);

    // A bucket (with credentials) is wired through the same endpoint.
    const { path, init } = jsonRequest("PUT", "/api/storage/config", configBody());
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(200);
    const after = (await res.json()) as {
      enabled: boolean;
      provider: string;
      bucket: string;
      has_secret: boolean;
      access_key_id: string;
    };
    expect(after.enabled).toBe(true);
    expect(after.provider).toBe("r2");
    expect(after.bucket).toBe("dental-canvas-media");
    expect(after.has_secret).toBe(true);
    // The secret itself must never come back over the wire.
    expect("secret_access_key" in after).toBe(false);
    expect(JSON.stringify(after)).not.toContain("wJalrXUtnFEMI");

    // And "none" turns uploads off completely.
    const off = jsonRequest("PUT", "/api/storage/config", { provider: "none", keep_secret: true });
    const offRes = await app.request(off.path, off.init, { DB: ctx.db });
    const offState = (await offRes.json()) as { enabled: boolean; provider: string };
    expect(offState.enabled).toBe(false);
    expect(offState.provider).toBe("none");
  });

  it("keeps the stored secret when the form sends an empty/masked value", async () => {
    await app.request("/api/storage/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) }, { DB: ctx.db });

    const keep = jsonRequest("PUT", "/api/storage/config", configBody({ secret_access_key: "••••••••", access_key_id: "NEWKEY" }));
    await app.request(keep.path, keep.init, { DB: ctx.db });
    expect(await getSetting(ctx.db, "storage_secret_access_key")).toBe("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(await getSetting(ctx.db, "storage_access_key_id")).toBe("NEWKEY");
  });

  it("redacts secrets from GET and PUT /api/settings", async () => {
    await app.request("/api/storage/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) }, { DB: ctx.db });
    const email = jsonRequest("PUT", "/api/settings", { email_api_key: "re_abc123", email_from: "dr@clinic.test" });
    await app.request(email.path, email.init, { DB: ctx.db });

    const res = await app.request("/api/settings", undefined, { DB: ctx.db });
    expect(res.status).toBe(200);
    const { settings } = (await res.json()) as { settings: Record<string, unknown> };
    expect(settings.storage_secret_access_key).toBe("••••••••");
    expect(settings.email_api_key).toBe("••••••••");
    expect(JSON.stringify(settings)).not.toContain("wJalrXUtnFEMI");
    expect(JSON.stringify(settings)).not.toContain("re_abc123");
  });

  it("rejects a non-HTTPS endpoint and a bucket without any credentials", async () => {
    const bad = jsonRequest("PUT", "/api/storage/config", configBody({ endpoint: "http://insecure.example.com" }));
    const res = await app.request(bad.path, bad.init, { DB: ctx.db });
    expect(res.status).toBe(400);

    const partial = jsonRequest("PUT", "/api/storage/config", configBody({ access_key_id: "", secret_access_key: "" }));
    const res2 = await app.request(partial.path, partial.init, { DB: ctx.db });
    expect(res2.status).toBe(400);
  });

  it("seeds storage settings defaults so storage reads as db", async () => {
    for (const [key, value] of Object.entries(DEFAULT_STORAGE_SETTINGS)) {
      expect(await getSetting(ctx.db, key)).toBe(value);
    }
    expect(await getSetting(ctx.db, "storage_provider")).toBe("db");
  });
});

// ── Image uploads / metadata CRUD ─────────────────────────────────

describe("patient images", () => {
  it("refuses uploads only when storage is switched fully off", async () => {
    const pid = await seedPatient();
    await app.request("/api/storage/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "none", keep_secret: true }) }, { DB: ctx.db });

    const { path, init } = jsonRequest("POST", `/api/patients/${pid}/images/uploads`, {
      files: [{ name: "x.png", type: "image/png", size: 1024 }],
    });
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: expect.stringContaining("Settings → Storage") });
  });

  it("issues presigned upload URLs for a configured bucket", async () => {
    const pid = await seedPatient();
    await app.request("/api/storage/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) }, { DB: ctx.db });

    const { path, init } = jsonRequest("POST", `/api/patients/${pid}/images/uploads`, {
      files: [{ name: "periapical-36.jpg", type: "image/jpeg", size: 245_760 }],
    });
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(200);
    const { uploads } = (await res.json()) as {
      uploads: { key: string; upload_url: string; headers: Record<string, string>; expires_at: string }[];
    };
    expect(uploads).toHaveLength(1);
    expect(uploads[0].key).toMatch(new RegExp(`^patients/${pid}/\\d{4}/\\d{2}/[0-9a-f-]+\\.jpg$`));
    expect(uploads[0].upload_url).toMatch(new RegExp(`^https://\\S+${uploads[0].key}\\?`));
    expect(uploads[0].headers).toEqual({}); // r2 signs no extra headers
    expect(new Date(uploads[0].expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("adds the signed SSE header for s3 provider uploads only", async () => {
    const pid = await seedPatient();
    await app.request("/api/storage/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody({ provider: "s3", endpoint: "https://s3.us-east-1.amazonaws.com", region: "us-east-1" })) }, { DB: ctx.db });

    const { path, init } = jsonRequest("POST", `/api/patients/${pid}/images/uploads`, {
      files: [{ name: "xray.dcm", type: "application/dicom", size: 42_000 }],
    });
    const { uploads } = (await (await app.request(path, init, { DB: ctx.db })).json()) as {
      uploads: { headers: Record<string, string> }[];
    };
    expect(uploads[0].headers).toEqual({ "x-amz-server-side-encryption": "AES256" });
  });

  it("rejects unsupported file types and files over the limit", async () => {
    const pid = await seedPatient();
    await app.request("/api/storage/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody({ max_file_mb: 1 })) }, { DB: ctx.db });

    const badType = jsonRequest("POST", `/api/patients/${pid}/images/uploads`, {
      files: [{ name: "notes.docx", type: "application/vnd.openxmlformats", size: 500 }],
    });
    expect((await app.request(badType.path, badType.init, { DB: ctx.db })).status).toBe(400);

    const oversized = jsonRequest("POST", `/api/patients/${pid}/images/uploads`, {
      files: [{ name: "big.png", type: "image/png", size: 2 * 1024 * 1024 + 1 }],
    });
    const res = await app.request(oversized.path, oversized.init, { DB: ctx.db });
    expect(res.status).toBe(413);
  });

  it("finalizes metadata, lists, patches and softly deletes", async () => {
    const pid = await seedPatient();
    await app.request("/api/storage/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) }, { DB: ctx.db });

    const create = jsonRequest("POST", `/api/patients/${pid}/images`, {
      files: [
        { key: `patients/${pid}/2026/09/a.jpg`, file_name: "periapical-36.jpg", mime_type: "image/jpeg", kind: "xray", label: "Tooth 36 periapical", size_bytes: 2048 },
        { key: `patients/${pid}/2026/09/b.jpg`, file_name: "portrait.jpg", mime_type: "image/jpeg", kind: "photo", size_bytes: 4096 },
      ],
    });
    const created = await app.request(create.path, create.init, { DB: ctx.db });
    expect(created.status).toBe(201);
    const { images } = (await created.json()) as { images: { id: number; kind: string; url: string }[] };
    expect(images).toHaveLength(2);
    const [xray, photo] = images;
    expect(xray.url).toContain("http"); // presigned GET while no public base URL

    // List all + filter by kind.
    const list = (await (await app.request(`/api/patients/${pid}/images`, undefined, { DB: ctx.db })).json()) as {
      images: { id: number }[];
      storage: { enabled: boolean; provider: string; max_file_mb: number };
    };
    expect(list.images).toHaveLength(2);
    expect(list.storage.enabled).toBe(true);
    expect(list.storage.provider).toBe("r2");

    const photos = (await (await app.request(`/api/patients/${pid}/images?kind=photo`, undefined, { DB: ctx.db })).json()) as {
      images: { id: number; kind: string }[];
    };
    expect(photos.images.map((i) => i.id)).toEqual([photo.id]);

    // Patch label + kind.
    const patch = jsonRequest("PATCH", `/api/images/${xray.id}`, { label: "Updated", kind: "panoramic" });
    const patched = await app.request(patch.path, patch.init, { DB: ctx.db });
    expect(patched.status).toBe(200);
    const { image } = (await patched.json()) as { image: { label: string; kind: string } };
    expect(image.label).toBe("Updated");
    expect(image.kind).toBe("panoramic");

    // Soft delete removes it from the list but keeps the row.
    const del = await app.request(`/api/images/${xray.id}`, { method: "DELETE" }, { DB: ctx.db });
    expect(del.status).toBe(200);
    const after = (await (await app.request(`/api/patients/${pid}/images`, undefined, { DB: ctx.db })).json()) as {
      images: { id: number }[];
    };
    expect(after.images.map((i) => i.id)).toEqual([photo.id]);
    const stillThere = await ctx.db
      .prepare("SELECT deleted FROM patient_images WHERE id = ?")
      .bind(xray.id)
      .first<{ deleted: number }>();
    expect(stillThere?.deleted).toBe(1);
  });

  it("refuses a file key scoped to another patient", async () => {
    const pid = await seedPatient();
    const { path, init } = jsonRequest("POST", `/api/patients/${pid}/images`, {
      files: [{ key: `patients/999/2026/09/evil.jpg`, mime_type: "image/jpeg", kind: "xray", size_bytes: 100 }],
    });
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(400);
  });

  it("requires the patient to exist for every image route", async () => {
    const up = jsonRequest("POST", "/api/patients/999/images/uploads", { files: [{ name: "x.jpg", type: "image/jpeg", size: 10 }] });
    expect((await app.request(up.path, up.init, { DB: ctx.db })).status).toBe(404);
    const fin = jsonRequest("POST", "/api/patients/999/images", { files: [] });
    expect((await app.request(fin.path, fin.init, { DB: ctx.db })).status).toBe(404);
    expect((await app.request("/api/patients/999/images", undefined, { DB: ctx.db })).status).toBe(404);
    expect((await app.request("/api/patients/999/prescription-context", undefined, { DB: ctx.db })).status).toBe(404);
  });
});

// ── Built-in database storage (the no-credentials default) ────────

describe("database storage tier", () => {
  it("round-trips bytes: upload URL → PUT → metadata → GET back", async () => {
    const pid = await seedPatient();
    // provider defaults to "db" — no bucket configuration needed.

    const { path, init } = jsonRequest("POST", `/api/patients/${pid}/images/uploads`, {
      files: [{ name: "periapical.png", type: "image/png", size: 512 }],
    });
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(200);
    const { uploads } = (await res.json()) as {
      uploads: { key: string; upload_url: string; headers: Record<string, string> }[];
    };
    expect(uploads).toHaveLength(1);
    // In DB mode the browser PUTs the bytes to the app proxy route (same origin).
    expect(uploads[0].upload_url).toBe(`/api/image-file?key=${encodeURIComponent(uploads[0].key)}`);
    expect(uploads[0].headers).toEqual({});

    const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const put = await app.request(
      uploads[0].upload_url,
      { method: "PUT", headers: { "Content-Type": "image/png" }, body: payload },
      { DB: ctx.db },
    );
    expect(put.status).toBe(201);

    const fin = jsonRequest("POST", `/api/patients/${pid}/images`, {
      files: [{ key: uploads[0].key, file_name: "periapical.png", mime_type: "image/png", kind: "xray", size_bytes: 512 }],
    });
    const created = await app.request(fin.path, fin.init, { DB: ctx.db });
    expect(created.status).toBe(201);
    const { images } = (await created.json()) as { images: { id: number; url: string }[] };
    expect(images[0].url).toBe(`/api/image-file?key=${encodeURIComponent(uploads[0].key)}`);

    // The file is served back with its stored content type.
    const got = await app.request(images[0].url, undefined, { DB: ctx.db });
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toContain("image/png");
    const bytes = new Uint8Array(await got.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(payload));

    // The list reports the DB tier with its 5 MB cap surfaced to the client.
    const list = (await (await app.request(`/api/patients/${pid}/images`, undefined, { DB: ctx.db })).json()) as {
      storage: { enabled: boolean; provider: string; max_file_mb: number };
    };
    expect(list.storage).toEqual({ enabled: true, provider: "db", max_file_mb: 5 });
  });

  it("caps database-storage files at 5 MB and urges a bucket for bigger files", async () => {
    const pid = await seedPatient();
    const over = jsonRequest("POST", `/api/patients/${pid}/images/uploads`, {
      files: [{ name: "huge.png", type: "image/png", size: 6 * 1024 * 1024 }],
    });
    const res = await app.request(over.path, over.init, { DB: ctx.db });
    expect(res.status).toBe(413);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("5 MB"),
    });
  });

  it("rejects PUT-and-GET blob routes when the key is unknown or the body is empty", async () => {
    expect((await app.request("/api/image-file?key=patients/1/bogus", undefined, { DB: ctx.db })).status).toBe(404);
    const put = await app.request("/api/image-file?key=patients%2F1%2Fbogus", { method: "PUT", headers: { "Content-Type": "image/png" }, body: new Uint8Array() }, { DB: ctx.db });
    expect(put.status).toBe(400);
  });

  it("keeps serving db blobs after a bucket is configured (migration-safe)", async () => {
    const pid = await seedPatient();
    const { uploads } = (await (
      await app.request(
        `/api/patients/${pid}/images/uploads`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ name: "x.jpg", type: "image/jpeg", size: 10 }] }) },
        { DB: ctx.db },
      )
    ).json()) as { uploads: { key: string; upload_url: string }[] };

    await app.request(uploads[0].upload_url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array([1, 2, 3]) }, { DB: ctx.db });
    await app.request(
      `/api/patients/${pid}/images`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ key: uploads[0].key, file_name: "x.jpg", mime_type: "image/jpeg", kind: "xray", size_bytes: 10 }] }) },
      { DB: ctx.db },
    );

    // Moving to a bucket stops the upload route from accepting new DB blobs…
    await app.request("/api/storage/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) }, { DB: ctx.db });
    const latePut = await app.request("/api/image-file?key=" + encodeURIComponent(uploads[0].key), { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array([9]) }, { DB: ctx.db });
    expect(latePut.status).toBe(405);

    // …but already-stored ones still stream out.
    const got = await app.request(`/api/image-file?key=${encodeURIComponent(uploads[0].key)}`, undefined, { DB: ctx.db });
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer()).byteLength).toBe(3);
  });
});

// ── Prescription context + image_ids round-trip ───────────────────

describe("prescription context", () => {
  it("returns the latest open plan tooth and only non-photo images", async () => {
    const pid = await seedPatient();
    await app.request("/api/storage/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) }, { DB: ctx.db });

    const empty = (await (await app.request(`/api/patients/${pid}/prescription-context`, undefined, { DB: ctx.db })).json()) as {
      tooth: string | null;
      images: unknown[];
    };
    expect(empty.tooth).toBeNull();
    expect(empty.images).toEqual([]);

    // A completed plan item's tooth should not win over an open one's.
    const tx = await app.request(
      "/api/treatment-types",
      undefined,
      { DB: ctx.db },
    );
    const { treatment_types: tt } = (await tx.json()) as { treatment_types: { id: number }[] };
    await app.request(
      "/api/treatment-plan-items",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patient_id: pid, treatment_type_id: tt[0].id, tooth: "46", status: "completed" }) },
      { DB: ctx.db },
    );
    await app.request(
      "/api/treatment-plan-items",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patient_id: pid, treatment_type_id: tt[0].id, tooth: "36", status: "planned" }) },
      { DB: ctx.db },
    );

    const imgRes = await app.request(
      `/api/patients/${pid}/images`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: [
        { key: `patients/${pid}/2026/09/older.jpg`, mime_type: "image/jpeg", kind: "xray", label: "Older", size_bytes: 10 },
        { key: `patients/${pid}/2026/09/r.jpg`, mime_type: "image/jpeg", kind: "xray", label: "Latest", size_bytes: 10 },
        { key: `patients/${pid}/2026/09/p.jpg`, mime_type: "image/jpeg", kind: "photo", size_bytes: 10 },
      ] }) },
      { DB: ctx.db },
    );
    expect(imgRes.status).toBe(201);

    const ctxRes = (await (await app.request(`/api/patients/${pid}/prescription-context`, undefined, { DB: ctx.db })).json()) as {
      tooth: string | null;
      images: { id: number; label: string }[];
      storage: { enabled: boolean };
    };
    expect(ctxRes.tooth).toBe("36"); // open "planned" wins over "completed"
    expect(ctxRes.images).toHaveLength(2); // photos excluded
    expect(ctxRes.images[0].label).toBe("Latest"); // newest first
    expect(ctxRes.storage.enabled).toBe(true);
  });

  it("persists image_ids and returns renderable images on the prescription", async () => {
    const pid = await seedPatient();
    await app.request("/api/storage/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) }, { DB: ctx.db });

    const create = jsonRequest("POST", `/api/patients/${pid}/images`, {
      files: [{ key: `patients/${pid}/2026/09/a.jpg`, file_name: "x.jpg", mime_type: "image/jpeg", kind: "xray", size_bytes: 10 }],
    });
    const { images } = (await (await app.request(create.path, create.init, { DB: ctx.db })).json()) as { images: { id: number }[] };

    const post = jsonRequest("POST", "/api/prescriptions", rxBody(pid, { image_ids: [images[0].id] }));
    const created = await app.request(post.path, post.init, { DB: ctx.db });
    expect(created.status).toBe(201);
    const { prescription } = (await created.json()) as {
      prescription: { id: number; image_ids: number[]; images: { id: number; url: string }[] };
    };
    expect(prescription.image_ids).toEqual([images[0].id]);
    expect(prescription.images.map((i) => i.id)).toEqual([images[0].id]);
    expect(prescription.images[0].url).toContain("http");

    // And it survives a fetch by id (what the print view uses).
    const single = (await (await app.request(`/api/prescriptions/${prescription.id}`, undefined, { DB: ctx.db })).json()) as {
      prescription: { image_ids: number[]; images: { id: number }[] };
    };
    expect(single.prescription.image_ids).toEqual([images[0].id]);
  });

  it("never attaches another patient's image to a prescription", async () => {
    const steve = await seedPatient({ first_name: "Steve", last_name: "Wozniak" });
    const grace = await seedPatient();
    await app.request("/api/storage/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configBody()) }, { DB: ctx.db });

    const res = await app.request(
      `/api/patients/${steve}/images`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ key: `patients/${steve}/2026/09/a.jpg`, mime_type: "image/jpeg", kind: "xray", size_bytes: 10 }] }) },
      { DB: ctx.db },
    );
    const { images } = (await res.json()) as { images: { id: number }[] };

    const post = jsonRequest("POST", "/api/prescriptions", rxBody(grace, { image_ids: [images[0].id] }));
    const created = (await (await app.request(post.path, post.init, { DB: ctx.db })).json()) as {
      prescription: { image_ids: number[] | null; images: unknown[] };
    };
    expect(created.prescription.image_ids).toBeNull(); // filtered out
    expect(created.prescription.images).toEqual([]);
  });
});

// ── Medicine preset version-gated merge ───────────────────────────

describe("medicine preset upgrade merge", () => {
  it("adds only the missing presets on a version bump and preserves edits", async () => {
    // Simulate a practice that used an older preset list and edited a shared drug.
    const meds = await ctx.db
      .prepare("SELECT COUNT(*) AS n FROM medicines")
      .first<{ n: number }>();
    expect(meds?.n).toBeGreaterThan(0);

    await ctx.db
      .prepare("UPDATE medicines SET dosage = '600 mg' WHERE name = 'Metronidazole'")
      .run();
    await ctx.db
      .prepare("INSERT INTO medicines (name, drug_group, dosage, frequency, duration, instructions) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("Omeprazole", "Other", "20 mg", "once daily", "1 month", "before breakfast")
      .run();
    // Stale version marker = the app shipped new presets since the last run.
    await ctx.db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('medicines_presets_version', '2026-09-01')")
      .run();

    const app2 = await freshApp();
    await app2.request("/api/health", undefined, { DB: ctx.db });

    // All built-in presets plus the custom one now exist.
    const count = await ctx.db
      .prepare("SELECT COUNT(*) AS n FROM medicines")
      .first<{ n: number }>();
    expect(count?.n).toBe(SEED_MEDICINES.length + 1);

    // A brand-new entry from this batch is present…
    const newDrug = await ctx.db
      .prepare("SELECT dosage FROM medicines WHERE name = 'Ketorolac'")
      .first<{ dosage: string }>();
    expect(newDrug).not.toBeNull();

    // …the user's edit was not clobbered (INSERT OR IGNORE kept the row)…
    const edited = await ctx.db
      .prepare("SELECT dosage FROM medicines WHERE name = 'Metronidazole'")
      .first<{ dosage: string }>();
    expect(edited?.dosage).toBe("600 mg");

    // …and the version marker advanced so this won't re-run.
    expect(await getSetting(ctx.db, "medicines_presets_version")).toBe("2026-09-20");
  });
});