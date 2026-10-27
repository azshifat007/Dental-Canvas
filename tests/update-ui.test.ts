import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The App updates card is desktop-only, so it never renders in the browser
 * build and cannot be eyeballed in a web preview. These tests render it for
 * real (React server render) in both modes and all the phases the auto path
 * produces, so the copy a clinic reads matches what the app actually does:
 *
 *   - "auto" says it will install itself; "ask" says it waits for a click
 *   - a downloaded update is a distinct, actionable ("Install now") state
 *   - the switch writes `update_mode` in both directions
 */

const checkMock = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...args: unknown[]) => checkMock(...args) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@/offline/activate", () => ({ isTauriDesktop: () => true, flushDatabase: vi.fn() }));
vi.mock("@/components/update-applied-banner", () => ({ saveUpdateNotesForNextBoot: vi.fn() }));
vi.mock("@/lib/open-external", () => ({ openExternalUrl: vi.fn() }));

import { AppContext } from "@/context";
import { UpdateCard, saveUpdateMode } from "@/components/settings/app-update-card";
import { UpdateAvailableBanner } from "@/components/update-available-banner";
import type { AppStateValue } from "@/hooks/use-app-state";

function fakeApp(mode: "auto" | "ask", updateSettings = vi.fn(async () => undefined)) {
  return {
    settings: { update_mode: mode },
    updateSettings,
    setError: vi.fn(),
  } as unknown as AppStateValue;
}

function renderCard(mode: "auto" | "ask"): string {
  return renderToStaticMarkup(
    createElement(AppContext.Provider, { value: fakeApp(mode) }, createElement(UpdateCard)),
  );
}

async function loadUpdater() {
  const mod = await import("@/lib/updater");
  mod.__resetUpdateStateForTests();
  return mod;
}

function fakeUpdate(version = "1.4.24", body = "Adds the new recall report") {
  return {
    version,
    body,
    download: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    downloadAndInstall: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  vi.stubGlobal("__APP_VERSION__", "1.4.23");
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
  checkMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("App updates card", () => {
  it("promises unattended updates when the setting is on", async () => {
    await loadUpdater();
    const html = renderCard("auto");

    expect(html).toContain("Install updates automatically");
    // The checkbox reflects the stored preference, not a local copy.
    expect(html).toContain("checked=");
    expect(html).toContain("downloads in the background and installs itself the next time the app is left alone");
    expect(html).toContain("Ten minutes without anyone touching the app");
  });

  it("promises to ask first when the setting is off", async () => {
    await loadUpdater();
    const html = renderCard("ask");

    expect(html).not.toContain("checked=");
    expect(html).toContain("You are told when one is available, and install it with one click.");
  });

  it("stages a downloaded update as a state the user can act on", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const mod = await loadUpdater();
    mod.setUpdateMode("auto");
    await mod.checkForUpdates();
    await mod.__backgroundDownloadForTests();

    const html = renderCard("auto");
    expect(mod.getUpdateState()).toMatchObject({ phase: "staged" });
    expect(html).toContain("Version 1.4.24 is ready to install");
    expect(html).toContain("Install now");
    expect(html).toContain("installs itself and restarts the app the next time the app is left alone");
  });

  it("offers the download when the app is set to ask", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const mod = await loadUpdater();
    mod.setUpdateMode("ask");
    await mod.checkForUpdates();

    const html = renderCard("ask");
    expect(html).toContain("Version 1.4.24 is available");
    expect(html).toContain("Downloads and installs when you click");
    expect(html).toContain("Download &amp; install");
  });

  it("stores both directions of the switch", async () => {
    const updateSettings = vi.fn(async () => undefined);

    await saveUpdateMode(updateSettings, true);
    expect(updateSettings).toHaveBeenLastCalledWith({ update_mode: "auto" });

    await saveUpdateMode(updateSettings, false);
    expect(updateSettings).toHaveBeenLastCalledWith({ update_mode: "ask" });
  });
});

/**
 * The banner is where a clinic user meets an update, so the staged state has to
 * read as "this will happen on its own, or now if you prefer".
 */
describe("Update available banner", () => {
  const renderBanner = () => renderToStaticMarkup(createElement(UpdateAvailableBanner));

  it("stays quiet until something is on offer", async () => {
    await loadUpdater();
    expect(renderBanner()).toBe("");
  });

  it("announces a staged update with an Install now action", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    const mod = await loadUpdater();
    mod.setUpdateMode("auto");
    await mod.checkForUpdates();
    await mod.__backgroundDownloadForTests();

    const html = renderBanner();
    expect(html).toContain("Version 1.4.24 is ready to install");
    expect(html).toContain("Install now");
    expect(html).toContain("installs itself and restarts the app the next time it is left alone");
  });
});
