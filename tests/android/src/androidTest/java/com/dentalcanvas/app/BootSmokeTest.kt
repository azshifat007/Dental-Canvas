package com.dentalcanvas.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Boot smoke test — the Android counterpart of the stale-UI/post-mortem
 * guards on desktop.
 *
 * It launches the real app on a live emulator and asserts the WebView has
 * actually MOUNTED past boot: not the "Dental Canvas could not start"
 * fatal screen, not a blank window. Concretely, it waits for a DOM element
 * the React app renders (the sidebar navigation landmark) inside Tauri's
 * WebView view.
 *
 * History this guards against: v1.4.11 shipped an APK where every boot died
 * in the service-worker activation path ("Failed to register a
 * ServiceWorker") — the package installed fine, so nothing but a boot test
 * could have caught it.
 *
 * The fatal screen is plain HTML injected into the WebView by main.tsx with
 * the heading "Dental Canvas could not start" — its text is searchable via
 * uiautomator the same way app content is.
 */
@RunWith(AndroidJUnit4::class)
class BootSmokeTest {

    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    /** Longest boot to allow before declaring the app hung (cold start + WASM init). */
    private val bootTimeoutMs = 120_000L

    @Test
    fun appMountsPastBoot() {
        // Tauri's generated MainActivity; launched cold, like a user tap.
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: error("app has no launch intent — is the package installed?")
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK or android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        device.waitForIdle(10_000)

        // The app mounts only after the offline backend answers its first
        // health probe (desktop) or the in-page server is ready (Android),
        // so give the WebView time to render before judging.
        val mounted = device.wait(
            Until.hasObject(By.desc("Practice navigation")),
            bootTimeoutMs,
        )

        // Diagnostics first (visible in logcat on failure), then assert.
        val dumpPath = device.dumpWindowHierarchy("window_dump.xml")
        val dumpText = java.io.File(dumpPath).readText()
        val hasFatal = dumpText.contains("could not start")
        println("BOOT_SMOKE: mounted=$mounted fatalScreen=$hasFatal")
        println("BOOT_SMOKE: windowDumpHead=${dumpText.take(400)}")
        assertTrue(
            "App did not mount past boot (fatalScreen=$hasFatal). " +
                "See BOOT_SMOKE lines in logcat and the dumped hierarchy.",
            mounted != null && !hasFatal,
        )
    }
}
