mod commands;
mod models;
mod utils;

use commands::analytics::capture_analytics_event;
use commands::detect_obs::{
    choose_obs_directory, detect_obs, save_obs_path, validate_obs_path_command,
};
use commands::install_plugin::{
    cancel_plugin_install, get_github_release_info, install_plugin, open_external, open_local_path,
    reveal_path, InstallCancellationRegistry,
};
use commands::settings::{
    clear_app_cache, export_logs, reset_app_state, save_app_settings, sync_autostart_setting,
    uninstall_plugin,
};
use commands::state::{adopt_installation, bootstrap};
use commands::store::load_state;
use commands::support::submit_support_request;
use commands::update::{
    check_app_update, clear_cached_app_update, download_app_update, get_cached_app_update_snapshot,
    install_app_update, AppUpdateRegistry,
};
use tauri::{
    menu::MenuBuilder,
    menu::MenuEvent,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

const TRAY_OPEN_ID: &str = "tray-open";
const TRAY_QUIT_ID: &str = "tray-quit";
const DEFAULT_UPDATER_PUBLIC_KEY: &str = include_str!("../updater.pub.key");

fn updater_public_key() -> &'static str {
    DEFAULT_UPDATER_PUBLIC_KEY.trim()
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(InstallCancellationRegistry::default())
        .manage(AppUpdateRegistry::default())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(updater_public_key())
                .build(),
        )
        .on_tray_icon_event(|app, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(app);
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            if let Ok(state) = load_state(&app.handle()) {
                if let Err(error) =
                    sync_autostart_setting(&app.handle(), state.settings.launch_on_startup)
                {
                    eprintln!("Could not sync launch-on-startup state: {}", error);
                }
            }

            let menu = MenuBuilder::new(app)
                .text(TRAY_OPEN_ID, "Open OBS Plugin Installer")
                .separator()
                .text(TRAY_QUIT_ID, "Quit")
                .build()?;

            let mut tray_builder = TrayIconBuilder::with_id("obs-plugin-installer-tray")
                .menu(&menu)
                .tooltip("OBS Plugin Installer")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event: MenuEvent| match event.id().as_ref() {
                    TRAY_OPEN_ID => show_main_window(app),
                    TRAY_QUIT_ID => app.exit(0),
                    _ => {}
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }

            let _ = tray_builder.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let should_minimize_to_tray = load_state(&window.app_handle())
                    .map(|state| state.settings.minimize_to_tray)
                    .unwrap_or(false);

                if should_minimize_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            capture_analytics_event,
            submit_support_request,
            bootstrap,
            detect_obs,
            choose_obs_directory,
            save_obs_path,
            validate_obs_path_command,
            install_plugin,
            cancel_plugin_install,
            get_github_release_info,
            open_external,
            open_local_path,
            reveal_path,
            save_app_settings,
            clear_app_cache,
            export_logs,
            reset_app_state,
            uninstall_plugin,
            adopt_installation,
            check_app_update,
            download_app_update,
            install_app_update,
            get_cached_app_update_snapshot,
            clear_cached_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
