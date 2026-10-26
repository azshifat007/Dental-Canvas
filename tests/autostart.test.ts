import { afterEach, describe, expect, it } from "vitest";
import { autostartSupported, isAutostartEnabled, setAutostart } from "@/lib/autostart";

/**
 * The autostart wrapper is the only thing between the Settings toggle and the
 * OS. These tests drive it through the real plugin package with a stand-in for
 * Tauri's `invoke`, so the command names it sends and the browser-mode
 * behaviour are checked without a desktop build.
 */

type Invoke = (cmd: string, args?: unknown) => unknown;

/** Node has no `window`; the desktop detection reads `__TAURI_INTERNALS__` off
 *  it, so installing one is enough. `navigator` already exists in Node and its
 *  user agent never says "Android", so it needs no stub. */
function installWindow(invoke?: Invoke) {
  (globalThis as unknown as { window: unknown }).window = invoke
    ? { __TAURI_INTERNALS__: { invoke } }
    : {};
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("autostart in a plain browser", () => {
  it("reports the feature as unsupported instead of pretending it is off", async () => {
    installWindow();
    expect(autostartSupported()).toBe(false);
    // null, not false: "cannot tell" is not the same as "known to be off".
    expect(await isAutostartEnabled()).toBeNull();
  });

  it("refuses to toggle, with a message the Settings card can show", async () => {
    installWindow();
    await expect(setAutostart(true)).rejects.toThrow(/only available in the desktop app/i);
  });
});

describe("autostart in the desktop app", () => {
  it("sends the plugin's enable/disable/is_enabled commands", async () => {
    const calls: string[] = [];
    let registered = false;
    installWindow(async (cmd) => {
      calls.push(cmd);
      if (cmd === "plugin:autostart|enable") registered = true;
      else if (cmd === "plugin:autostart|disable") registered = false;
      else if (cmd === "plugin:autostart|is_enabled") return registered;
      else throw new Error(`unexpected command ${cmd}`);
      return null;
    });

    expect(autostartSupported()).toBe(true);
    expect(await isAutostartEnabled()).toBe(false);

    await setAutostart(true);
    expect(calls).toContain("plugin:autostart|enable");
    expect(await isAutostartEnabled()).toBe(true);

    await setAutostart(false);
    expect(calls).toContain("plugin:autostart|disable");
    expect(await isAutostartEnabled()).toBe(false);
  });

  it("reports an unknown state when the OS query fails", async () => {
    installWindow(async () => {
      throw new Error("permission denied");
    });
    expect(await isAutostartEnabled()).toBeNull();
  });

  it("surfaces a failed toggle instead of silently leaving the switch wrong", async () => {
    installWindow(async (cmd) => {
      if (cmd === "plugin:autostart|is_enabled") return false;
      throw new Error("registry write blocked");
    });
    await expect(setAutostart(true)).rejects.toThrow(/registry write blocked/);
  });
});
