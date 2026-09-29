use tauri::Manager;

/// App entry shared by the desktop binary (main.rs) and the mobile cdylib
/// (tauri::mobile_entry_point). Desktop-only plugins are registered behind
/// `#[cfg(desktop)]` so the Android/iOS builds link cleanly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Desktop only: must be the FIRST plugin. A second launch of the .exe
    // (double-click, taskbar pin) would otherwise open a second window
    // sharing the same IndexedDB database — two writers corrupt the
    // pending-write queue. Instead, focus the existing window.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
    }));

    builder
        // Opens https:// (WhatsApp links, booking previews) in the system's
        // default browser; the WebView itself cannot spawn windows.
        .plugin(tauri_plugin_opener::init())
        // Native OS notifications (appointment reminders, backup alerts).
        // Registered on all platforms; the WebView requests permission and
        // shows notifications through the JS guest bindings.
        .plugin(tauri_plugin_notification::init())
        // In-app updates (desktop only): the updater verifies signed update
        // bundles against the pubkey in tauri.conf.json; the process plugin
        // provides relaunch after an update installs.
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Dental Canvas");
}
