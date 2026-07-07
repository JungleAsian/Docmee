#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::Value;
use tauri::{AppHandle, Manager};

/// Locate the bundled Node orchestrator scripts. In a packaged build these live
/// in the app's resource directory; in development they live in `../dist`.
fn dist_dir(app: &AppHandle) -> PathBuf {
    if let Ok(resource) = app.path_resolver().resolve_resource("dist") {
        if resource.exists() {
            return resource;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("dist")
}

/// Run a compiled Node entry point and return its stdout.
fn run_node_script(script: PathBuf, config: Option<String>) -> Result<String, String> {
    let mut command = Command::new("node");
    command.arg(script).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(json) = config {
        command.env("DEPLOYKIT_CONFIG", json);
    }
    let output = command.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
fn system_check(app: AppHandle) -> Result<Value, String> {
    let stdout = run_node_script(dist_dir(&app).join("system-check.js"), None)?;
    serde_json::from_str(&stdout).map_err(|e| e.to_string())
}

#[tauri::command]
fn run_installer(app: AppHandle, config: Value) -> Result<(), String> {
    let script = dist_dir(&app).join("installer-runner.js");
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;

    let mut child = Command::new("node")
        .arg(script)
        .env("DEPLOYKIT_CONFIG", config_json)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().ok_or_else(|| "no stdout from installer".to_string())?;
    let handle = app.clone();

    // Stream NDJSON progress lines back to the webview as they arrive.
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(state) = serde_json::from_str::<Value>(&line) {
                let _ = handle.emit_all("installer://progress", state);
            }
        }
        let _ = child.wait();
    });

    Ok(())
}

#[tauri::command]
fn open_dashboard(app: AppHandle, url: String) -> Result<(), String> {
    tauri::api::shell::open(&app.shell_scope(), url, None).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![system_check, run_installer, open_dashboard])
        .run(tauri::generate_context!())
        .expect("failed to run Docmee DeployKit");
}
