import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Windows install can fail without a trace: the updater hands the NSIS
 * installer to the shell, the installer is blocked (SmartScreen on an unsigned
 * build, antivirus, a declined elevation prompt, a locked exe) and the plugin's
 * hard `exit(0)` has already killed the app — so nothing reports the failure
 * and the clinic reopens on the old version. "It downloads, but nothing
 * changes."
 *
 * These tests pin the recovery for both silent outcomes on the next boot:
 *   - the exe is new but the window served the old shell → clear and reload
 *   - the exe is still old → say so and hand over the installer
 * and pin what must be on disk before the process is killed.
 */

const checkMock = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...args: unknown[]) => checkMock(...args) }));

const relaunchMock = vi.fn();
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: (...args: unknown[]) => relaunchMock(...args) }));

const flushNowMock = vi.fn();
vi.mock("@/offline/activate", () => ({
  isTauriDesktop: () => true,
  flushDatabase: vi.fn(),
  flushDatabaseAndWait: () => {
    flushNowMock();
    return Promise.resolve();
  },
}));

vi.mock("@/components/update-applied-banner", () => ({ saveUpdateNotesForNextBoot: vi.fn() }));
vi.mock("@/lib/open-external", () => ({ openExternalUrl: vi.fn() }));

const PENDING_KEY = "dental-canvas:pending-update";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
}

const reloadMock = vi.fn();
const cachesMock = {
  keys: vi.fn(async () => [] as string[]),
  delete: vi.fn(async () => true),
};

function fakeUpdate(version = "1.4.24", body = "Adds the new recall report") {
  return {
    version,
    body,
    download: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
  };
}

/** A release feed shaped like the GitHub API, with a Windows installer asset. */
function feedResponse(tag = "v1.4.24") {
  return () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          tag_name: tag,
          body: "notes for 1.4.24",
          html_url: "https://example.test/releases",
          assets: [
            {
              name: "Dental.Canvas_1.4.24_x64-setup.exe",
              browser_download_url: "https://example.test/Dental.Canvas_1.4.24_x64-setup.exe",
            },
          ],
        }),
        { status: 200 },
      ),
    );
}

async function loadUpdater() {
  const mod = await import("@/lib/updater");
  mod.__resetUpdateStateForTests();
  return mod;
}

beforeEach(() => {
  vi.stubGlobal("__APP_VERSION__", "1.4.23");
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("window", {
    localStorage,
    sessionStorage,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    location: { reload: reloadMock },
  });
  vi.stubGlobal("caches", cachesMock);
  checkMock.mockReset();
  relaunchMock.mockReset();
  flushNowMock.mockReset();
  reloadMock.mockReset();
  cachesMock.keys.mockClear();
  cachesMock.delete.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verifyUpdateOnBoot", () => {
  it("does nothing when no install was pending", async () => {
    const mod = await loadUpdater();
    await mod.verifyUpdateOnBoot();
    expect(checkMock).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("treats a matching build as success and clears the marker", async () => {
    vi.stubGlobal("__APP_VERSION__", "1.4.24");
    localStorage.setItem(PENDING_KEY, JSON.stringify({ from: "1.4.23", to: "1.4.24", at: Date.now() }));

    const mod = await loadUpdater();
    await mod.verifyUpdateOnBoot();

    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(checkMock).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("repairs a stale shell when the exe is current but the window is old", async () => {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ from: "1.4.22", to: "1.4.24", at: Date.now() }));
    // The plugin compares the *binary* with the feed: no newer release left to
    // offer means the exe really was replaced.
    checkMock.mockResolvedValue(null);

    const mod = await loadUpdater();
    await mod.verifyUpdateOnBoot();

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(mod.getUpdateDiagnostics().lastError).toContain("previous shell");

    // A purge that does not help must not reload forever: a second failed
    // attempt in the same session is left alone.
    localStorage.setItem(PENDING_KEY, JSON.stringify({ from: "1.4.22", to: "1.4.24", at: Date.now() }));
    await mod.verifyUpdateOnBoot();
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("offers the installer when the exe was never replaced", async () => {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ from: "1.4.23", to: "1.4.24", at: Date.now() }));
    checkMock.mockResolvedValue(fakeUpdate("1.4.24"));
    vi.stubGlobal("fetch", vi.fn(feedResponse()));

    const mod = await loadUpdater();
    await mod.verifyUpdateOnBoot();

    expect(mod.getUpdateState()).toMatchObject({
      version: "1.4.24",
      phase: "available",
      mode: "manual",
      downloadUrl: "https://example.test/Dental.Canvas_1.4.24_x64-setup.exe",
    });
    expect(mod.getUpdateDiagnostics().lastError).toContain("installer did not finish");
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("keeps the marker when the check cannot reach the feed", async () => {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ from: "1.4.23", to: "1.4.24", at: Date.now() }));
    checkMock.mockRejectedValue(new Error("network down"));

    const mod = await loadUpdater();
    await mod.verifyUpdateOnBoot();

    expect(localStorage.getItem(PENDING_KEY)).not.toBeNull();
    expect(reloadMock).not.toHaveBeenCalled();
  });
});

describe("Windows install hand-off", () => {
  it("flushes the database and records the attempt before installing", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const mod = await loadUpdater();

    await mod.checkForUpdates();
    await mod.installUpdate();

    expect(flushNowMock).toHaveBeenCalledTimes(1);
    // Remembered for the next boot's verification.
    expect(localStorage.getItem(PENDING_KEY)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toMatchObject({ from: "1.4.23", to: "1.4.24" });
    // Handed to the NSIS installer with the restart flag; no relaunch racing
    // the installer for the exe.
    expect(update.install).toHaveBeenCalledWith({ restartAfterInstall: true });
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("keeps the download and explains itself when the installer cannot start", async () => {
    const update = fakeUpdate();
    update.install.mockRejectedValue(new Error("Access is denied."));
    checkMock.mockResolvedValue(update);
    const mod = await loadUpdater();

    await mod.checkForUpdates();
    await expect(mod.installUpdate()).rejects.toThrow(/Access is denied/);

    // Still downloadable/staged, with the reason on record — not a silent no-op.
    expect(mod.getUpdateState()).toMatchObject({ version: "1.4.24", phase: "staged" });
    expect(mod.getUpdateDiagnostics().lastError).toContain("the installer could not start");
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("relaunches itself on macOS/Linux, where no installer restarts the app", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" });
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    const mod = await loadUpdater();

    await mod.checkForUpdates();
    await mod.installUpdate();

    expect(update.install).toHaveBeenCalledWith({ restartAfterInstall: true });
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });
});
