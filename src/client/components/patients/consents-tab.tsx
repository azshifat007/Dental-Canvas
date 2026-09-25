import { useEffect, useRef, useState } from "react";
import { FileSignature, PenLine, Printer, Trash2 } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDate } from "@/lib/utils";
import { printHtmlDocument } from "@/lib/print";
import { toast } from "@/components/ui/toast";
import type { ConsentSignature, ConsentTemplate } from "@/types";

/**
 * Digital consent forms: the practice keeps reusable templates, and each
 * signing captures a drawn signature (canvas → PNG data URL) with the signer's
 * name and role. Signed forms are printable for the paper chart.
 */

const ROLE_LABEL: Record<string, string> = { patient: "Patient", guardian: "Parent/Guardian" };

/** Minimal canvas drawing pad producing a transparent PNG data URL. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawing.current = true;
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!dirty.current) {
      dirty.current = true;
      onChange(canvasRef.current!.toDataURL("image/png"));
    }
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current && canvasRef.current) onChange(canvasRef.current.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onChange(null);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    canvas.width = 600;
    canvas.height = 180;
  }, []);

  return (
    <div className="space-y-1.5">
      <div className="rounded-lg border-2 border-dashed border-muted-foreground/30 bg-white p-1 dark:bg-slate-50">
        <canvas
          ref={canvasRef}
          className="h-[140px] w-full touch-none rounded"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          <Trash2 className="mr-1 h-3 w-3" /> Clear
        </Button>
      </div>
    </div>
  );
}

export function ConsentsTab({ patientId }: { patientId: number }) {
  const app = useApp();
  const [consents, setConsents] = useState<ConsentSignature[]>([]);
  const [templates, setTemplates] = useState<ConsentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState<ConsentTemplate | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState<"patient" | "guardian">("patient");
  const [signature, setSignature] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<ConsentSignature | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const [c, t] = await Promise.all([
        api<{ consents: ConsentSignature[] }>("GET", `/api/patients/${patientId}/consents`),
        api<{ templates: ConsentTemplate[] }>("GET", "/api/consent-templates"),
      ]);
      setConsents(c.consents);
      setTemplates(t.templates.filter((x) => x.active));
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const openSign = async (t: ConsentTemplate) => {
    setSigning(t);
    setSignature(null);
    setSignerRole(t.requires_guardian ? "guardian" : "patient");
    // Pre-fill with the patient's own name for convenience.
    try {
      const { patient } = await api<{ patient: { first_name: string | null; last_name: string | null } }>(
        "GET", `/api/patients/${patientId}`,
      );
      setSignerRole(t.requires_guardian ? "guardian" : "patient");
      if (!t.requires_guardian) setSignerName([patient.first_name, patient.last_name].filter(Boolean).join(" "));
      else setSignerName("");
    } catch {
      /* name prefill is best-effort */
    }
  };

  const save = async () => {
    if (!signing || !signature || !signerName.trim()) return;
    try {
      setSaving(true);
      await api("POST", "/api/consent-signatures", {
        template_id: signing.id,
        patient_id: patientId,
        signer_name: signerName.trim(),
        signer_role: signerRole,
        signature_data: signature,
      });
      toast.success("Consent form signed");
      setSigning(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /** Print the signed consent as a standalone document. */
  const print = async (c: ConsentSignature) => {
    // The signature row doesn't store the (possibly since-edited) template body;
    // fetch the current template text for the printout.
    let body = "";
    try {
      const { templates } = await api<{ templates: ConsentTemplate[] }>("GET", "/api/consent-templates");
      body = templates.find((t) => t.id === c.template_id)?.body ?? "";
    } catch {
      /* print without the body rather than failing */
    }
    const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]!));
    printHtmlDocument(
      `<!doctype html><html><head><title>Consent — ${esc(c.template_title ?? "")}</title>
      <style>
        body { font-family: Georgia, serif; max-width: 700px; margin: 40px auto; color: #1e293b; line-height: 1.6; }
        h1 { font-size: 20px; border-bottom: 2px solid #1e293b; padding-bottom: 8px; }
        .meta { font-size: 13px; color: #475569; margin: 16px 0; }
        .body { white-space: pre-wrap; font-size: 14px; }
        .sig { margin-top: 40px; }
        .sig img { max-height: 80px; border-bottom: 1px solid #1e293b; }
        @media print { @page { margin: 20mm; } }
      </style></head><body>
      <h1>${esc(c.template_title ?? "Consent Form")}</h1>
      <div class="meta">Signed by ${esc(c.signer_name)} (${ROLE_LABEL[c.signer_role] ?? c.signer_role}) · ${formatDate(c.signed_at)}</div>
      <div class="body">${esc(body)}</div>
      <div class="sig"><img src="${c.signature_data}" alt="signature" /></div>
      </body></html>`,
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            Consent forms
          </CardTitle>
          {!templates.length && (
            <span className="text-xs text-muted-foreground">Create templates in Settings → Consent forms</span>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {templates.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <Button key={t.id} variant="outline" size="sm" onClick={() => openSign(t)}>
                  <PenLine className="mr-1.5 h-3.5 w-3.5" />
                  Sign: {t.title}
                  {t.requires_guardian ? " 👤" : ""}
                </Button>
              ))}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !consents.length ? (
            <p className="text-sm text-muted-foreground">No signed consent forms on record.</p>
          ) : (
            <div className="space-y-2">
              {consents.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.template_title}</span>
                      {c.signer_role === "guardian" && (
                        <Badge variant="secondary" className="text-[10px]">Guardian</Badge>
                      )}
                      {!c.signature_data && (
                        <Badge variant="outline" className="text-[10px] text-destructive">Withdrawn</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {c.signer_name} · {formatDate(c.signed_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {c.signature_data && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewing(c)}>
                        <FileSignature className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {c.signature_data && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void print(c)}>
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        if (!confirm("Withdraw this signature? The audit record (who, when) is kept.")) return;
                        try {
                          await api("DELETE", `/api/consent-signatures/${c.id}`);
                          toast.info("Signature withdrawn");
                          await load();
                        } catch (err) {
                          toast.error((err as Error).message);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sign dialog */}
      <Dialog open={!!signing} onOpenChange={(o) => !o && setSigning(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {signing && (
            <>
              <DialogHeader>
                <DialogTitle>Sign: {signing.title}</DialogTitle>
              </DialogHeader>
              <div className="max-h-[40vh] overflow-y-auto rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                {signing.body}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Signed by (name)</Label>
                  <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Full name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={signerRole} onValueChange={(v) => setSignerRole(v as "patient" | "guardian")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="patient" disabled={!!signing.requires_guardian}>Patient</SelectItem>
                      <SelectItem value="guardian">Parent/Guardian</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Signature</Label>
                <SignaturePad onChange={setSignature} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSigning(null)}>Cancel</Button>
                <Button onClick={save} disabled={!signature || !signerName.trim() || saving}>
                  {saving ? "Saving…" : "Save signature"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle>{viewing.template_title}</DialogTitle>
              </DialogHeader>
              <p className={cn("text-xs text-muted-foreground")}>
                Signed by {viewing.signer_name} ({ROLE_LABEL[viewing.signer_role] ?? viewing.signer_role}) · {formatDate(viewing.signed_at)}
              </p>
              <img src={viewing.signature_data} alt="signature" className="max-h-20 border-b border-foreground/30 pb-1" />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
