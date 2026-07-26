// Per-device settings persistence: one JSON file in the OS app-data
// directory, keyed by "vendorId:productId" on the frontend side. This file
// just stores/loads an opaque JSON blob — the frontend owns the shape
// (which definition was imported, current keymap, layer count, lighting
// cache, last-connected device) so this stays a dumb key-value store rather
// than needing to track the app's data model.

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_settings(app: AppHandle, data: serde_json::Value) -> Result<(), String> {
    let path = settings_path(&app)?;
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}
