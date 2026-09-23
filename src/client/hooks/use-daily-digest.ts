import { useEffect } from "react";
import { api } from "../api";

/**
 * Daily worklist digest trigger.
 *
 * The digest email (appointment reminders + hygiene recalls + installments
 * due) is composed server-side, but like auto-backup this app is serverless —
 * there's no cron to fire it. The app shell therefore checks once when the
 * app loads (and hourly afterwards) whether today's digest has been sent,
 * comparing the server-side `digest_last_sent` stamp against the configured
 * `digest_time`. A device that happens to be open around the scheduled time
 * sends the email; the server-side stamp guarantees it's sent at most once
 * per day no matter how many devices are open.
 *
 * Mirrors use-auto-backup / use-daily-inventory-scan, so a real Cloudflare
 * Cron trigger can replace it later without touching the server logic.
 */

const POLL_MS = 60 * 60 * 1000; // hourly check

export function useDailyDigest(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function maybeSend() {
      if (cancelled) return;
      try {
        const { settings } = await api<{ settings: Record<string, string> }>("GET", "/api/settings");
        if (cancelled) return;
        if ((settings.digest_enabled ?? "") !== "1") return;
        if (!(settings.email_api_key ?? "").trim()) return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((settings.digest_recipient ?? "").trim())) return;

        // Sent today already? (Server keeps a UTC datetime stamp.)
        const last = (settings.digest_last_sent ?? "").slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        if (last === today) return;

        // Respect the scheduled time — don't send at 3am.
        const [hh, mm] = (settings.digest_time ?? "07:30").split(":").map((n) => parseInt(n, 10));
        const now = new Date();
        const scheduled = new Date(now);
        scheduled.setHours(Number.isFinite(hh) ? hh : 7, Number.isFinite(mm) ? mm : 30, 0, 0);
        if (now < scheduled) return;

        // Due — send it. The server stamps digest_last_sent on success.
        await api("POST", "/api/email/worklist-digest", {});
      } catch {
        /* transient — retried on the next poll */
      }
    }

    void maybeSend();
    const t = window.setInterval(() => void maybeSend(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [enabled]);
}
