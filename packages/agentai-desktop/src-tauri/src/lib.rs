//! PulseFlow Desktop 入口 (Tauri 2.0)
//!
//! 核心能力:
//!   1. spawn_gateway — 自启 AgentAI Gateway (Node.js 子进程)
//!   2. switch_mode   — Full ⇄ Lite 模式切换
//!   3. open_tray_menu — 托盘快捷菜单

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State, WebviewUrl, WebviewWindowBuilder,
};

struct GatewayProcess(Mutex<Option<Child>>);

#[derive(Default)]
struct AppState {
    mode: Mutex<String>,
    tray: Mutex<Option<tauri::tray::TrayIcon>>,
}

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn get_mode(state: State<'_, AppState>) -> String {
    state.mode.lock().map(|g| g.clone()).unwrap_or_else(|_| "full".to_string())
}

#[tauri::command]
async fn switch_mode(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mode: String,
) -> Result<String, String> {
    if mode != "full" && mode != "lite" {
        return Err(format!("Invalid mode: {}", mode));
    }

    for window in app.webview_windows().values() {
        window.close().map_err(|e| e.to_string())?;
    }

    let url = if mode == "lite" {
        WebviewUrl::App("lite.html".into())
    } else {
        WebviewUrl::App("index.html".into())
    };

    WebviewWindowBuilder::new(&app, "main", url)
        .title(if mode == "lite" { "PulseFlow Lite" } else { "PulseFlow" })
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    if let Ok(mut g) = state.mode.lock() {
        *g = mode.clone();
    }

    log::info!("[desktop] switched to {} mode", mode);
    Ok(format!("switched to {}", mode))
}

fn spawn_gateway_process(app_handle: &tauri::AppHandle) -> Result<Child, String> {
    let resource_dir = app_handle.path().resource_dir().map_err(|e| e.to_string())?;
    let gateway_js = resource_dir.join("agentai-gateway/dist/index.js");
    
    if !gateway_js.exists() {
        return Err(format!("Gateway not found: {:?}", gateway_js));
    }

    let child = Command::new("node")
        .arg(&gateway_js)
        .env("AGENTAI_DESKTOP", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn gateway: {}", e))?;

    log::info!("[desktop] spawned gateway process (pid: {:?})", child.id());
    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .manage(GatewayProcess(Mutex::new(None)))
        .manage(AppState {
            mode: Mutex::new("full".to_string()),
            tray: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![get_version, get_mode, switch_mode])
        .setup(|app| {
            let url = WebviewUrl::App("index.html".into());
            WebviewWindowBuilder::new(app, "main", url)
                .title("PulseFlow")
                .inner_size(1200.0, 800.0)
                .min_inner_size(800.0, 600.0)
                .resizable(true)
                .center()
                .build()?;

            let menu = Menu::with_items(app, &[
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "switch_mode", "切换模式", true, None::<&str>)?,
                &MenuItem::with_id(app, "quick_chat", "快速对话", true, None::<&str>)?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?,
            ])?;

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("PulseFlow")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "switch_mode" => {
                            let app_clone = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let state: State<AppState> = app_clone.state();
                                let current = state.mode.lock().map(|g| g.clone()).unwrap_or_else(|_| "full".to_string());
                                let new_mode = if current == "full" { "lite" } else { "full" };
                                let _ = switch_mode(app_clone, state, new_mode.to_string()).await;
                            });
                        }
                        "quick_chat" => {
                            let app_clone = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let state: State<AppState> = app_clone.state();
                                let _ = switch_mode(app_clone, state, "lite".to_string()).await;
                            });
                        }
                        "settings" => {
                            log::info!("[desktop] settings clicked");
                        }
                        "quit" => {
                            log::info!("[desktop] quit from tray");
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            let state: State<AppState> = app.state();
            if let Ok(mut g) = state.tray.lock() {
                *g = Some(tray);
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let state: State<GatewayProcess> = app_handle.state();
                match spawn_gateway_process(&app_handle) {
                    Ok(child) => {
                        if let Ok(mut guard) = state.0.lock() {
                            *guard = Some(child);
                        }
                        log::info!("[desktop] auto-started gateway");
                    }
                    Err(e) => {
                        log::warn!("[desktop] auto-start gateway failed: {}", e);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app_handle = window.app_handle().clone();
                std::thread::spawn(move || {
                    let state: State<GatewayProcess> = app_handle.state();
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                            log::info!("[desktop] gateway process exited");
                        }
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running PulseFlow desktop");
}
