// Hide the extra console window in Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // Must be the FIRST plugin: a second launch of the .exe (double-click,
        // taskbar pin) would otherwise open a second window sharing the same
        // IndexedDB database — two writers corrupt the pending-write queue.
        // Instead, focus the existing window like a well-behaved Windows app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        // Opens https:// (WhatsApp links, booking previews) in the system's
        // default browser; the WebView itself cannot spawn windows.
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Dental Canvas");
}
