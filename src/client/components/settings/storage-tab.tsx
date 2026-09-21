import { useEffect, useState } from "react";
import { CheckCircle2, CloudUpload, HardDrive, Lock, Server, Trash2 } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StorageStatus } from "@/types";

/**
 * Settings → Storage: where patient images/X-rays live. Two tiers:
 *  - Built-in database storage ("db", the default) — bytes live in the app's
 *    own database, no credentials needed. Caps at 5 MB per file.
 *  - An S3-compatible bucket (Cloudflare R2, AWS S3, MinIO…) — uploads go
 *    straight from the browser to the bucket over short-lived presigned HTTPS
 *    URLs; credentials are stored server-side and masked on every response.
 */
export function StorageTab() {
  const app = useApp();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [provider, setProvider] = useState<"none" | "db" | "s3" | "r2">("db");
  const [endpoint, setEndpoint] = useState("");
  const [region, setRegion] = useState("auto");
  const [bucket, setBucket] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [expiryMinutes, setExpiryMinutes] = useState("15");
  const [maxFileMb, setMaxFileMb] = useState("25");
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api<StorageStatus>("GET", "/api/storage/config");
        if (cancelled) return;
        setStatus(s);
        setProvider(s.provider);
        setEndpoint(s.endpoint);
        setRegion(s.region || "auto");
        setBucket(s.bucket);
        setAccessKeyId(s.access_key_id);
        setPublicBaseUrl(s.public_base_url);
        setExpiryMinutes(String(s.expiry_minutes));
        setMaxFileMb(String(s.max_file_mb));
      } catch (err) {
        if (!cancelled) app.setError((err as Error).message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const s = await api<StorageStatus>("PUT", "/api/storage/config", {
        provider,
        endpoint: endpoint.trim(),
        region: region.trim() || "auto",
        bucket: bucket.trim(),
        access_key_id: accessKeyId.trim(),
        // Empty / masked = keep whatever is stored.
        keep_secret: secret.trim() === "" || secret === "••••••••",
        secret_access_key: secret.trim(),
        public_base_url: publicBaseUrl.trim() || null,
        expiry_minutes: Math.max(1, Math.min(60, Number(expiryMinutes) || 15)),
        max_file_mb: Math.max(1, Math.min(200, Number(maxFileMb) || 25)),
      });
      setStatus(s);
      setSecret("");
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const opened = provider !== "none";
  const isDb = provider === "db";

  return (
    <div className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            Image &amp; X-ray storage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Patient images live either in the app's own database (zero setup) or in your S3-compatible bucket. With a
            bucket, uploads go straight from the browser over short-lived presigned HTTPS URLs — images never transit
            this server, and only metadata stays in the database.
          </p>

          {loaded && (
            <div
              className={
                status?.enabled
                  ? "flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                  : "flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
              }
            >
              {status?.enabled ? (
                status.provider === "db" ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>
                      <strong className="font-semibold">Database storage is active</strong> — uploads are stored inside
                      the app's database (max 5 MB/image). Configure a bucket below to move to external storage.
                    </span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    Storage is <strong className="font-semibold">configured</strong> — uploads go to{" "}
                    <code className="rounded bg-emerald-100/70 px-1">{bucket || "the bucket"}</code>.
                  </>
                )
              ) : (
                <>
                  <CloudUpload className="h-4 w-4 shrink-0" />
                  Storage is turned off — image uploads are disabled until you pick a provider.
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            Bucket settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!loaded ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <form onSubmit={save} className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Provider</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as "none" | "db" | "s3" | "r2")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="db">Database (built-in)</SelectItem>
                    <SelectItem value="none">Off — no uploads</SelectItem>
                    <SelectItem value="r2">Cloudflare R2</SelectItem>
                    <SelectItem value="s3">AWS S3 (or MinIO / compatible)</SelectItem>
                  </SelectContent>
                </Select>
                {isDb && (
                  <p className="text-xs text-muted-foreground">
                    Bytes are stored in the app's database and served through the app — the gallery and printed sheets
                    work with no setup. Each file is capped at 5 MB; switch to a bucket for larger X-rays.
                  </p>
                )}
                {opened && !isDb && (
                  <p className="text-xs text-muted-foreground">
                    {provider === "r2"
                      ? "R2 encrypts every object at rest (AES-256) automatically. Create a bucket and an “S3 API Token” in the Cloudflare dashboard (R2 → Manage R2 API Tokens), then paste the endpoint and credentials."
                      : "S3 objects are written with the `x-amz-server-side-encryption: AES256` header. Use an IAM key with `s3:PutObject`/`s3:GetObject` for this bucket only."}
                  </p>
                )}
              </div>

              {opened && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="stg-endpoint">Endpoint (https://)</Label>
                    <Input
                      id="stg-endpoint"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      placeholder={
                        provider === "r2"
                          ? "https://<account-id>.r2.cloudflarestorage.com"
                          : "https://s3.<region>.amazonaws.com"
                      }
                      inputMode="url"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="stg-bucket">Bucket name</Label>
                      <Input id="stg-bucket" value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="dental-canvas-media" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="stg-region">Region</Label>
                      <Input id="stg-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder={provider === "r2" ? "auto" : "us-east-1"} />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="stg-akid">Access key id</Label>
                      <Input id="stg-akid" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} autoComplete="off" placeholder={provider === "r2" ? "…" : "AKIA…"} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="stg-secret">
                        {status?.has_secret ? "Secret access key — configured ✓ (enter a new key to replace)" : "Secret access key"}
                      </Label>
                      <div className="relative">
                        <Input
                          id="stg-secret"
                          type="password"
                          value={secret}
                          onChange={(e) => setSecret(e.target.value)}
                          autoComplete="new-password"
                          placeholder={status?.has_secret ? "••••••••••••" : "Enter the secret…"}
                        />
                        <Lock className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="stg-pub">
                      Public base URL <span className="font-normal text-muted-foreground">(optional, https://)</span>
                    </Label>
                    <Input
                      id="stg-pub"
                      value={publicBaseUrl}
                      onChange={(e) => setPublicBaseUrl(e.target.value)}
                      placeholder="https://media.example.com or blank to use presigned URLs"
                      inputMode="url"
                    />
                    <p className="text-xs text-muted-foreground">
                      Only needed for a CDN / custom domain in front of the bucket. Leave blank otherwise.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="stg-expiry">Presigned URL lifetime (minutes)</Label>
                      <Input
                        id="stg-expiry"
                        type="number"
                        min={1}
                        max={60}
                        value={expiryMinutes}
                        onChange={(e) => setExpiryMinutes(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="stg-max">Max file size (MB)</Label>
                      <Input id="stg-max" type="number" min={1} max={200} value={maxFileMb} onChange={(e) => setMaxFileMb(e.target.value)} />
                    </div>
                  </div>
                </>
              )}

              <Button type="submit" disabled={busy} className="w-fit">
                {busy ? "Saving…" : "Save storage settings"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {status?.enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Trash2 className="h-4 w-4 text-destructive" />
              Disable storage
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Existing images keep displaying, while the upload button disappears from the Imaging tab until storage is
            re-enabled.
            <Button
              variant="outline"
              size="sm"
              className="mt-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={async () => {
                setBusy(true);
                try {
                  const s = await api<StorageStatus>("PUT", "/api/storage/config", {
                    provider: "none",
                    keep_secret: true,
                  });
                  setStatus(s);
                  setProvider("none");
                } catch (err) {
                  app.setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Turn storage off
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}