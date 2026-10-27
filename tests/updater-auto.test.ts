import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unattended updates: the default is that a new version downloads itself and
 * installs the next time nobody is using the app. That is a restart the user
 * did not ask for, so the rules matter and are pinned down here:
 *
 *   - "auto" downloads without a click and survives into "staged"
 *   - it installs only once the app has been left alone (idle / background)
 *   - an open modal is never a quiet moment
 *   - "ask" still downloads nothing until the user says so
 *   - a staged copy is installed as-is, never downloaded twice
 *   - manual / repair outcomes are never applied behind the user's back
 */

const checkMock = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...args: unknown[]) => checkMock(...args) }));

const relaunchMock = vi.fn();
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: (...args: unknown[]) => relaunchMock(...args) }));

const flushMock = vi.fn();
vi.mock("@/offline/activate", () => ({
  isTauriDesktop: () => true,
  flushDatabase: (...args: unknown[]) => flushMock(...args),
}));

const saveNotesMock = vi.fn();
vi.mock("@/components/update-applied-banner", () => ({
  saveUpdateNotesForNextBoot: (...args: unknown[]) => saveNotesMock(...args),
}));

vi.mock("@/lib/open-external", () => ({ openExternalUrl: vi.fn() }));

type DownloadEvent = { event: string; data?: { contentLength?: number; chunkLength?: number } };

/** A stand-in for the plugin's `Update` handle. */
function fakeUpdate(version = "1.4.24", body = "Adds the new recall report") {
  return {
    version,
    body,
    download: vi.fn(async (onEvent?: (e: DownloadEvent) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 200 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 100 } });
      onEvent?.({ event: "Finished" });
    }),
    install: vi.fn(async () => undefined),
    downloadAndInstall: vi.fn(async () => undefined),
  };
}

async function loadUpdater() {
  const mod = await import("@/lib/updater");
  mod.__resetUpdateStateForTests();
  return mod;
}

beforeEach(() => {
  vi.stubGlobal("__APP_VERSION__", "1.4.23");
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
  checkMock.mockReset();
  relaunchMock.mockReset();
  flushMock.mockReset();
  saveNotesMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shouldAutoApply", () => {
  it("accepts an idle app or a backgrounded window, and nothing else", async () => {
    const { shouldAutoApply, AUTO_INSTALL_IDLE_MS, AUTO_INSTALL_HIDDEN_MS } = await loadUpdater();
    const now = 10_000_000;

    // Ten minutes untouched.
    expect(
      shouldAutoApply({ now, lastInteractionAt: now - AUTO_INSTALL_IDLE_MS, hiddenSince: null, dialogOpen: false }),
    ).toBe(true);
    // Thirty seconds in the background.
    expect(
      shouldAutoApply({ now, lastInteractionAt: now, hiddenSince: now - AUTO_INSTALL_HIDDEN_MS, dialogOpen: false }),
    ).toBe(true);
    // Just hidden, still being used.
    expect(
      shouldAutoApply({ now, lastInteractionAt: now - 60_000, hiddenSince: now - 5_000, dialogOpen: false }),
    ).toBe(false);
    // Idle, but a form is on screen — that restart would lose the edit.
    expect(
      shouldAutoApply({ now, lastInteractionAt: now - AUTO_INSTALL_IDLE_MS, hiddenSince: null, dialogOpen: true }),
    ).toBe(false);
  });
});

describe("automatic installation", () => {
  it("downloads on its own and waits for a quiet moment", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const mod = await loadUpdater();
    mod.setUpdateMode("auto");

    await mod.checkForUpdates();
    await mod.__backgroundDownloadForTests();

    // No click anywhere: the download started from the check alone.
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(mod.getUpdateState()).toMatchObject({ version: "1.4.24", phase: "staged", progress: 1 });
    // The user is at the keyboard right now, so nothing is installed yet.
    expect(update.install).not.toHaveBeenCalled();
  });

  it("installs the staged copy once the app has been left alone", async () => {
    vi.useFakeTimers();
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const mod = await loadUpdater();
    mod.setUpdateMode("auto");

    await mod.checkForUpdates();
    await mod.__backgroundDownloadForTests();
    expect(update.install).not.toHaveBeenCalled();

    vi.advanceTimersByTime(mod.AUTO_INSTALL_IDLE_MS + 1_000);
    await expect(mod.applyStagedUpdateIfSafe()).resolves.toBe(true);

    expect(update.install).toHaveBeenCalledTimes(1);
    // Pending IndexedDB writes must reach the database before the installer
    // terminates this process, and the changelog must survive for the banner.
    expect(flushMock).toHaveBeenCalled();
    expect(saveNotesMock).toHaveBeenCalledWith("1.4.24", "Adds the new recall report");
    expect(relaunchMock).toHaveBeenCalled();
    expect(update.download).toHaveBeenCalledTimes(1); // installed, not re-fetched
  });

  it("keeps a staged update through the next hourly check", async () => {
    vi.useFakeTimers();
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const mod = await loadUpdater();
    mod.setUpdateMode("auto");

    await mod.checkForUpdates();
    await mod.__backgroundDownloadForTests();

    // The hourly check runs again before the app is ever left alone. It must
    // not re-advertise the update as merely "available": that would strand the
    // package that is already downloaded and the install would never happen.
    await mod.checkForUpdates();
    expect(mod.getUpdateState()).toMatchObject({ phase: "staged" });
    expect(update.download).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(mod.AUTO_INSTALL_IDLE_MS + 1_000);
    await expect(mod.applyStagedUpdateIfSafe()).resolves.toBe(true);
    expect(update.install).toHaveBeenCalledTimes(1);
  });

  it("never restarts the app while a modal is open", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {
      visibilityState: "visible",
      querySelector: (selector: string) => (selector.includes("dialog") ? {} : null),
    });
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const mod = await loadUpdater();
    mod.setUpdateMode("auto");

    await mod.checkForUpdates();
    await mod.__backgroundDownloadForTests();
    vi.advanceTimersByTime(mod.AUTO_INSTALL_IDLE_MS + 1_000);

    await expect(mod.applyStagedUpdateIfSafe()).resolves.toBe(false);
    expect(update.install).not.toHaveBeenCalled();
    // Still offered, just not applied.
    expect(mod.getUpdateState()).toMatchObject({ phase: "staged" });
  });

  it("falls back to the manual installer when the automatic install fails", async () => {
    vi.useFakeTimers();
    const update = fakeUpdate();
    update.install.mockRejectedValue(new Error("access denied"));
    checkMock.mockResolvedValue(update);
    const mod = await loadUpdater();
    mod.setUpdateMode("auto");

    await mod.checkForUpdates();
    await mod.__backgroundDownloadForTests();
    vi.advanceTimersByTime(mod.AUTO_INSTALL_IDLE_MS + 1_000);

    await expect(mod.applyStagedUpdateIfSafe()).resolves.toBe(false);
    expect(mod.getUpdateState()).toMatchObject({ phase: "available", mode: "manual" });
    expect(mod.getUpdateDiagnostics().lastError).toContain("automatic install failed");
  });
});

describe("update_mode = ask", () => {
  it("downloads nothing until the user asks", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const mod = await loadUpdater();
    mod.setUpdateMode("ask");

    await mod.checkForUpdates();
    expect(update.download).not.toHaveBeenCalled();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(mod.getUpdateState()).toMatchObject({ phase: "available", mode: "installer" });

    await mod.installUpdate();
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it("starts the download when the switch is turned on after a check", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const mod = await loadUpdater();
    mod.setUpdateMode("ask");

    await mod.checkForUpdates();
    expect(update.download).not.toHaveBeenCalled();

    mod.setUpdateMode("auto");
    await mod.__backgroundDownloadForTests();
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(mod.getUpdateState()).toMatchObject({ phase: "staged" });
  });
});

describe("outcomes that cannot self-install", () => {
  it("never applies a manual installer download on its own", async () => {
    checkMock.mockRejectedValue(new Error("no registry entry for this install"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            tag_name: "v1.4.24",
            body: "notes",
            html_url: "https://example.test/releases/v1.4.24",
            assets: [
              {
                name: "Dental.Canvas_1.4.24_x64-setup.exe",
                browser_download_url: "https://example.test/Dental.Canvas_1.4.24_x64-setup.exe",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const mod = await loadUpdater();
    mod.setUpdateMode("auto");

    await mod.checkForUpdates();
    await mod.__backgroundDownloadForTests();

    // "Open the releases page for me" is never something to do silently.
    expect(mod.getUpdateState()).toMatchObject({ phase: "available", mode: "manual" });
    expect(mod.getUpdateDiagnostics().lastError).toBe("no registry entry for this install");
  });
});
