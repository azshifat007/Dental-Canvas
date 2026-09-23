import { createRoot } from "react-dom/client";
import { App } from "./app";
import { activateOfflineMode, isTauriDesktop } from "./offline/activate";
import "./styles.css";

/**
 * Mount order matters in desktop/offline mode: the service worker (which IS
 * the backend) must be answering /api before React fires its first fetch.
 * In the browser this is a no-op and mounts immediately.
 */
const mount = () => {
  createRoot(document.getElementById("app")!).render(<App />);
};

if (isTauriDesktop()) {
  activateOfflineMode()
    .then(mount)
    .catch((err: Error) => {
      // Show a readable failure instead of a blank window.
      document.getElementById("app")!.innerHTML =
        `<div style="font-family:system-ui;padding:2rem;max-width:32rem;margin:3rem auto;">` +
        `<h1 style="font-size:1.1rem;margin-bottom:.5rem;">Offline backend failed to start</h1>` +
        `<p style="color:#555;font-size:.9rem;">${err.message}</p>` +
        `<p style="color:#888;font-size:.8rem;">Try reinstalling the app. Your data is stored in this machine's browser storage and is not lost.</p></div>`;
    });
} else {
  mount();
}
