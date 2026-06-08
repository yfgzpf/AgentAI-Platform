//! AgentAI Desktop 入口 (Tauri 2.0)

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub version: String,
}

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn ping_gateway(url: String) -> Result<String, String> {
    // 阶段 1 占位: 调用 Gateway 健康检查
    // 阶段 2: 实现 HTTP client
    Ok(format!("Would ping: {}", url))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![get_version, ping_gateway])
        .run(tauri::generate_context!())
        .expect("error while running AgentAI desktop");
}
