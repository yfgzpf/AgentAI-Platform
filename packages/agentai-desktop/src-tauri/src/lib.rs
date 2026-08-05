//! PulseFlow Desktop 入口 (Tauri 2.0) — 修复增强版
//!
//! 核心能力:
//!   1. spawn_gateway    — 自启 AgentAI Gateway (Node.js 子进程), 含智能 Node 查找
//!   2. get_node_status  — 前端查询 Node 安装状态
//!   3. switch_mode      — Full ⇄ Lite 模式切换
//!   4. tray             — 托盘快捷菜单
//!
//! 修复内容:
//!   - 增强 node_modules 完整性检查（启动前验证关键依赖）
//!   - 改进路径查找逻辑，兼容新旧打包结构
//!   - 增强日志输出，便于排查启动失败原因

use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{
    Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
// use tauri_plugin_notification::NotificationExt; // 暂时禁用，API 变更待修复
use tauri_plugin_updater::UpdaterExt;

static NODE_MIN_SIZE: u64 = 100_000;

struct GatewayProcess(Mutex<Option<Child>>);

/// 已下载完成、等待用户关闭应用时自动安装的更新元信息
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
struct PendingUpdate {
    version: String,
    bytes: u64,
    date: String,
    body: Option<String>,
    /// 下载是否已完成 (未完成 = 后台还在下, 不能安装)
    downloaded: bool,
    /// 下载百分比 (0..=100)
    progress: u8,
}

#[derive(Default)]
struct AppState {
    mode: Mutex<String>,
    tray: Mutex<Option<tauri::tray::TrayIcon>>,
    /// 全局挂起更新：Rust 后台静默下载完成后放在这里，前端关窗口时拿来安装
    pending: Mutex<Option<PendingUpdate>>,
}

#[derive(Clone, serde::Serialize)]
struct GatewayEventPayload {
    status: String,
    message: String,
}

/// Updater 事件发射：进度 / 准备就绪 / 失败
#[derive(Clone, serde::Serialize)]
struct UpdaterProgress<'a> {
    stage: &'a str,                 // checking / downloading / ready / error
    percent: u8,                    // 0..=100
    version: Option<&'a str>,       // 目标版本
    bytes: Option<u64>,             // 文件大小
    error: Option<&'a str>,         // 错误信息
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
async fn get_node_status() -> Result<String, String> {
    let candidate = find_real_node().map_err(|e| e)?;
    Ok(candidate.to_string_lossy().into_owned())
}

/// Tauri webview IPC bridge: forward postMessage from lite.html to parent window
#[tauri::command]
async fn tauri_post_message(app: tauri::AppHandle, message: String) -> Result<(), String> {
    // Emit to the main webview window so the VS Code extension or parent can receive it
    if let Some(window) = app.get_webview_window("main") {
        window.emit("__tauri_lite_message__", message).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn find_real_node() -> Result<PathBuf, String> {
    let names: &[&str] = if cfg!(windows) { &["node.exe", "node"] } else { &["node"] };
    let path_env = std::env::var_os("PATH").unwrap_or_default();
    let mut tried: Vec<String> = Vec::new();

    for name in names {
        for p in std::env::split_paths(&path_env) {
            let candidate = p.join(name);
            let lower = candidate.to_string_lossy().to_lowercase();
            if lower.contains("windowsapps") {
                tried.push(format!("{} (MS Store shim, skipped)", candidate.display()));
                continue;
            }
            match candidate.metadata() {
                Ok(meta) if meta.is_file() && meta.len() >= NODE_MIN_SIZE => { return Ok(candidate); }
                Ok(meta) => { tried.push(format!("{} ({} bytes)", candidate.display(), meta.len())); }
                Err(_) => {}
            }
        }
    }
    Err(format!(
        "未找到 Node.js (≥{}KB)。\n请从 nodejs.org 下载安装 Node.js 22+ 并重启 PulseFlow。\n已检查: {}",
        NODE_MIN_SIZE / 1000,
        if tried.is_empty() { "无".into() } else { tried.join("; ") }
    ))
}

/// 验证 gateway-dist 目录完整性（关键依赖检查）
fn validate_gateway_dir(gw_dir: &PathBuf) -> Result<(), String> {
    let index_js = gw_dir.join("index.js");
    let dist_index = gw_dir.join("dist").join("index.js");

    if !index_js.exists() && !dist_index.exists() {
        return Err(format!("Gateway 入口文件未找到。\n期望: {:?}\n或: {:?}", index_js, dist_index));
    }

    let nm = gw_dir.join("node_modules");
    if !nm.exists() || !nm.is_dir() {
        return Err(format!(
            "❌ node_modules 不存在！\n路径: {:?}\n\n请运行: pnpm build:desktop",
            nm
        ));
    }

    // 验证关键依赖
    // 启动必需的最小依赖集 (better-sqlite3 不包含: 原生模块可选)
    let critical_deps = ["express", "openai", "socket.io", "cors", "pino", "uuid", "dayjs"];
    let missing: Vec<&str> = critical_deps.iter().copied().filter(|d| !nm.join(d).exists()).collect();

    if !missing.is_empty() {
        log::warn!(
            "[desktop] 缺少 {} 个关键依赖: {}，尝试自动安装...",
            missing.len(),
            missing.join(", ")
        );
        
        // 自动运行 npm install
        let npm_result = Command::new("npm")
            .args(&["install", "--production", "--no-optional", "--ignore-scripts"])
            .current_dir(&gw_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
            
        match npm_result {
            Ok(mut child) => {
                match child.wait() {
                    Ok(status) if status.success() => {
                        log::info!("[desktop] npm install 成功");
                        // 重新验证
                        let still_missing: Vec<&str> = critical_deps.iter().copied()
                            .filter(|d| !nm.join(d).exists())
                            .collect();
                        if !still_missing.is_empty() {
                            return Err(format!(
                                "❌ 自动安装后仍缺少依赖: {}\n请手动运行: cd {:?} && npm install",
                                still_missing.join(", "),
                                gw_dir
                            ));
                        }
                    }
                    Ok(status) => {
                        return Err(format!(
                            "❌ npm install 失败 (exit code: {:?})\n请检查 Node.js 是否安装",
                            status.code()
                        ));
                    }
                    Err(e) => {
                        return Err(format!("❌ npm install 执行失败: {}", e));
                    }
                }
            }
            Err(e) => {
                return Err(format!(
                    "❌ 无法启动 npm install: {}\n请确保 Node.js 已安装并添加到 PATH",
                    e
                ));
            }
        }
    }

    // 统计包数量
    if let Ok(entries) = fs::read_dir(&nm) {
        let count = entries.count();
        log::info!("[desktop] node_modules 验证通过 ({} 个包)", count);
        // 最低阈值从 50 降至 15: npm --production 安装后约 30-60 个包
        if count < 15 {
            return Err(format!(
                "⚠️ node_modules 包数量异常少 ({})，可能不完整。\n正常应该有 30+ 个包。\n请重新运行: pnpm build:desktop",
                count
            ));
        }
    }

    Ok(())
}

#[tauri::command]
async fn spawn_gateway(app: tauri::AppHandle) -> Result<String, String> {
    let state: State<GatewayProcess> = app.state();
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let pid = child.id();
            let _ = child.kill();
            let _ = child.wait();
            log::info!("[desktop] killed previous gateway pid={}", pid);
        }
    }

    let node_path = find_real_node()?;
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;

    // 按优先级查找 gateway 目录
    let candidates = [
        ("gateway-dist-v2/dist", "index.js"),
        ("gateway-dist", "index.js"),
        ("gateway-dist-v2", "dist/index.js"),
    ];

    let mut gw_dir: Option<PathBuf> = None;
    let mut gw_js: Option<PathBuf> = None;

    for (dir_name, js_path) in &candidates {
        let dir = resource_dir.join(dir_name);
        let js = dir.join(js_path);
        if js.exists() {
            gw_dir = Some(dir.clone());
            gw_js = Some(js);
            break;
        }
    }

    // 开发期回退
    if gw_dir.is_none() {
        if let Ok(cwd) = std::env::current_dir() {
            for (dir_name, js_path) in &candidates {
                let dir = cwd.join("resources").join(dir_name);
                let js = dir.join(js_path);
                if js.exists() {
                    gw_dir = Some(dir.clone());
                    gw_js = Some(js);
                    break;
                }
            }
        }
    }

    let gw_dir = gw_dir.ok_or_else(|| {
        format!("Gateway index.js 未找到。\n已尝试: {}\n\n请先运行: pnpm build:desktop",
            candidates.iter().map(|(d, j)| format!("{}/{}", d, j)).collect::<Vec<_>>().join("\n  "))
    })?;
    let gw_js = gw_js.unwrap();

    // 验证完整性
    if let Err(e) = validate_gateway_dir(&gw_dir) {
        log::error!("[desktop] {}", e);
        let _ = app.emit("gateway:status", GatewayEventPayload { status: "failed".into(), message: e.clone() });
        return Err(e);
    }

    let data_dir = get_gateway_data_dir();
    fs::create_dir_all(&data_dir).map_err(|e| format!("创建数据目录失败 {:?}: {}", data_dir, e))?;

    let log_file = data_dir.join("gateway.log");
    let log_handle = fs::OpenOptions::new()
        .create(true).append(true)
        .open(&log_file).map_err(|e| format!("打开日志失败 {:?}: {}", log_file, e))?;

    log::info!("[desktop] ═══ 启动 Gateway ═══");
    log::info!("[desktop]   node:     {:?}", node_path);
    log::info!("[desktop]   入口:     {:?}", gw_js);
    log::info!("[desktop]   工作目录: {:?}", gw_dir);
    log::info!("[desktop]   数据目录: {:?}", data_dir);

    let mut cmd = Command::new(&node_path);
    cmd.arg(&gw_js).current_dir(&gw_dir)
        .env("AGENTAI_DESKTOP", "1")
        .env("AGENTAI_PORT", "18789")
        .env("AGENTAI_HOST", "127.0.0.1")
        .env("AGENTAI_HOME", &data_dir)
        .env("NODE_PATH", gw_dir.join("node_modules"))
        .stdout(log_handle.try_clone().map_err(|e| e.to_string())?)
        .stderr(log_handle);

    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().map_err(|e| {
        format!("❌ 启动 Gateway 失败: {}\n\n查看日志: {:?}", e, log_file)
    })?;
    let pid = child.id();

    if let Ok(mut guard) = state.0.lock() { *guard = Some(child); }

    let msg = format!("✅ Gateway 已启动 (pid: {})", pid);
    log::info!("[desktop] {}", msg);
    let _ = app.emit("gateway:status", GatewayEventPayload { status: "started".into(), message: msg.clone() });
    Ok(msg)
}

fn get_gateway_data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default()));
    base.join("PulseFlow").join("gateway")
}

#[tauri::command]
async fn switch_mode(app: tauri::AppHandle, state: State<'_, AppState>, mode: String) -> Result<String, String> {
    if mode != "full" && mode != "lite" { return Err(format!("Invalid mode: {}", mode)); }
    for window in app.webview_windows().values() { window.close().map_err(|e| e.to_string())?; }

    let url = if mode == "lite" { WebviewUrl::App("lite.html".into()) } else { WebviewUrl::App("index.html".into()) };
    WebviewWindowBuilder::new(&app, "main", url)
        .title(if mode == "lite" { "PulseFlow Lite" } else { "PulseFlow" })
        .inner_size(1200.0, 800.0).min_inner_size(800.0, 600.0)
        .resizable(true).center()
        .build().map_err(|e| e.to_string())?;

    if let Ok(mut g) = state.mode.lock() { *g = mode.clone(); }
    Ok(format!("switched to {}", mode))
}

// ──────────────────────────────────────────────────
// 4 个 Updater IPC: 供前端 关闭时自动安装 & 设置页按钮 调用
// ──────────────────────────────────────────────────

/// 前端查询当前挂起更新状态（TitleBar 徽章渲染、关闭时判定）
#[tauri::command]
fn updater_get_pending(state: State<'_, AppState>) -> Option<PendingUpdate> {
    state.pending.lock().map(|g| g.clone()).unwrap_or(None)
}

/// 启动后后台检查完成时调用：或发现已下载但上次未安装时重塞
#[tauri::command]
fn updater_set_pending(state: State<'_, AppState>, pending: Option<PendingUpdate>) -> Result<(), String> {
    if let Ok(mut g) = state.pending.lock() { *g = pending; }
    Ok(())
}

/// 前端点"仅关闭不安装"或"× 取消" → 清空内存里的已下载标记
/// （注：Tauri 实际临时安装文件不会被删，下次启动重新 check 还能命中）
#[tauri::command]
fn updater_discard(state: State<'_, AppState>) -> Result<(), String> {
    if let Ok(mut g) = state.pending.lock() { *g = None; }
    Ok(())
}

/// 前端确认"关闭并自动安装重启" → 取走 Update 对象安装重启
/// 返回 Err 的场景里前端 fallback 到仅关闭
#[tauri::command]
async fn updater_take_and_install(_app: tauri::AppHandle, _state: State<'_, AppState>) -> Result<String, String> {
    // 自动更新功能已临时禁用
    Err("自动更新功能暂时不可用".to_string())
}

/// 零依赖本地日期：YYYY-MM-DD (UTC)
fn chrono_like_date() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86400;
    // 1970-01-01 起累计 → 分解 (简易实现, 2000-2099 无问题)
    let (mut y, mut m, mut d) = (1970, 1, 1);
    let mut remain = days;
    loop {
        let leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
        let year_days = if leap { 366 } else { 365 };
        if remain >= year_days { remain -= year_days; y += 1; } else { break; }
    }
    let mdays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
    for (mi, &days_in_month) in mdays.iter().enumerate() {
        let dim = if leap && mi == 1 { 29 } else { days_in_month };
        if remain >= dim as u64 { remain -= dim as u64; m += 1; } else { break; }
    }
    d += remain as u32;
    format!("{:04}-{:02}-{:02}", y, m, d)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        // .plugin(tauri_plugin_notification::init()) // 暂时禁用，API 变更待修复
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(GatewayProcess(Mutex::new(None)))
        .manage(AppState{
            mode: Mutex::new("full".to_string()),
            tray: Mutex::new(None),
            pending: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_version, get_mode, switch_mode, spawn_gateway, get_node_status, tauri_post_message,
            updater_get_pending, updater_set_pending, updater_discard, updater_take_and_install
        ])
        .setup(|app| {
            // =========================================================
            // 自动更新功能已临时禁用，等待后续修复
            // TODO: 修复 updater 和 notification 的 API 调用
            // =========================================================
            log::info!("[Setup] 自动更新功能已禁用");

            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

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
                .tooltip("PulseFlow").menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "switch_mode" => {
                            let ac = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let s: State<AppState> = ac.state();
                                let cur = s.mode.lock().map(|g| g.clone()).unwrap_or_else(|_| "full".to_string());
                                let new_mode = if cur == "full" { "lite" } else { "full" };
                                let _ = switch_mode(ac.clone(), s, new_mode.to_string()).await;
                            });
                        }
                        "quick_chat" => {
                            let ac = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let s: State<AppState> = ac.state();
                                let _ = switch_mode(ac.clone(), s, "lite".to_string()).await;
                            });
                        }
                        "settings" => {
                            log::info!("[desktop] settings clicked");
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                                // 发送事件到前端，切换到设置页面
                                let _ = w.emit("navigate", "settings");
                            }
                        }
                        "quit" => { log::info!("[desktop] quit from tray"); app.exit(0); }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                    }
                }).build(app)?;

            if let Ok(mut g) = app.state::<AppState>().tray.lock() { *g = Some(tray); }

            // Gateway 启动完全由前端 GatewayFallback 控制 (避免双重启动竞态)
            // Rust 端仅提供 spawn_gateway 命令供前端调用, 和 gateway:status 事件转发
            log::info!("[desktop] Gateway startup delegated to frontend GatewayFallback");

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let ah = window.app_handle().clone();
                std::thread::spawn(move || {
                    let st: State<GatewayProcess> = ah.state();
                    let guard = st.0.lock();
                    if let Ok(mut g) = guard {
                        if let Some(mut ch) = g.take() {
                            let pid = ch.id();
                            let _ = ch.kill();
                            let _ = ch.wait();
                            #[cfg(windows)] {
                                let _ = Command::new("taskkill")
                                    .args(["/F","/T","/PID",&pid.to_string()])
                                    .stdout(Stdio::null())
                                    .stderr(Stdio::null())
                                    .status();
                            }
                            log::info!("[desktop] gateway exited (pid={})", pid);
                        }
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running PulseFlow desktop");
}
