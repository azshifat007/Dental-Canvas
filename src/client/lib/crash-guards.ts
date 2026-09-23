/**
 * Global crash guards for the desktop shell.
 *
 * WebView2 (like any Chromium) blanks the window when a renderer error escapes
 * — the user sees nothing and reports "the app is broken". These handlers turn
 * any uncaught error or unhandled promise rejection into a callback the shell
 * can render (main.tsx shows a diagnostic screen), so there is always a
 * visible, copyable message instead of silence.
 *
 * Browser deployments skip this: a live Cloudflare app has no offline DB to
 * lose and users can simply refresh.
 */

export function installGlobalCrashGuards(onCrash: (title: string, detail: string) => void): void {
  window.addEventListener("error", (e) => {
    // Resource-load errors (asset 404s etc.) shouldn't take over the screen.
    if (e.message) {
      onCrash("Something went wrong", `${e.message}\n\n${e.filename ?? ""}:${e.lineno ?? 0}`);
    }
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "unknown");
    onCrash("Something went wrong", reason);
  });
}
