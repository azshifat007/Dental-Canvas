/**
 * Global "register patient" trigger.
 *
 * The dialog itself lives once in the app shell (app.tsx); anything — the
 * dashboard top bar, the sidebar, the consultation switcher, a hotkey — can
 * open it by dispatching this event. This avoids threading an open-callback
 * through every level of the tree.
 */
export const OPEN_REGISTER_PATIENT = "dental-canvas:open-register-patient";

export function openQuickRegister(): void {
  window.dispatchEvent(new CustomEvent(OPEN_REGISTER_PATIENT));
}
