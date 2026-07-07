#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::{
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::Duration,
};
use tauri::{
    CustomMenuItem, LogicalPosition, LogicalSize, Manager, Position, Size, SystemTray,
    SystemTrayEvent, SystemTrayMenu,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn command_hidden(command: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn dashboard_ready() -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &"127.0.0.1:4000".parse().expect("valid dashboard address"),
        Duration::from_secs(2),
    ) else {
        return false;
    };

    let request = b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:4000\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }

    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

fn node_path() -> PathBuf {
    let hermes_node = PathBuf::from(r"C:\Users\Jungl\AppData\Local\hermes\node\node.exe");
    if hermes_node.exists() {
        return hermes_node;
    }
    PathBuf::from("node")
}

fn start_dashboard(tools_dir: &Path) {
    let next_bin = tools_dir.join("dashboard").join("node_modules").join("next").join("dist").join("bin").join("next");
    if !next_bin.exists() {
        return;
    }

    let dashboard_dir = tools_dir.join("dashboard");
    let next_mode = if dashboard_dir.join(".next").join("BUILD_ID").exists() {
        "start"
    } else {
        "dev"
    };
    let host = std::env::var("DOCMEE_DEVTOOLS_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let mut command = Command::new(node_path());
    command
        .arg(next_bin)
        .args([next_mode, "-p", "4000", "-H", host.as_str()])
        .current_dir(dashboard_dir);
    let _ = command_hidden(&mut command).spawn();
}

fn ensure_dashboard_running(tools_dir: &Path) {
    if dashboard_ready() {
        return;
    }

    start_dashboard(tools_dir);
    for _ in 0..60 {
        if dashboard_ready() {
            return;
        }
        thread::sleep(Duration::from_secs(1));
    }
}

fn fit_window_to_monitor(window: &tauri::Window) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    };

    let size = monitor.size();
    let scale = monitor.scale_factor();
    let available_width = (size.width as f64 / scale - 80.0).max(720.0);
    let available_height = (size.height as f64 / scale - 120.0).max(520.0);
    let width = available_width.min(960.0);
    let height = available_height.min(680.0);
    let monitor_position = monitor.position();
    let monitor_width = size.width as f64 / scale;
    let monitor_height = size.height as f64 / scale;
    let x = monitor_position.x as f64 / scale + ((monitor_width - width) / 2.0).max(0.0);
    let y = monitor_position.y as f64 / scale + ((monitor_height - height) / 2.0).max(0.0);

    let _ = window.set_size(Size::Logical(LogicalSize { width, height }));
    let _ = window.set_position(Position::Logical(LogicalPosition { x, y }));
    let _ = window.show();
    let _ = window.set_focus();
}

fn main() {
    let tools_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..");
    let logs_dir = tools_dir.join("logs");
    let setup_tools_dir = tools_dir.clone();
    let tray_tools_dir = tools_dir.clone();

    let open = CustomMenuItem::new("open".to_string(), "Open DevTools");
    let gates = CustomMenuItem::new("gates".to_string(), "Run Gates");
    let logs = CustomMenuItem::new("logs".to_string(), "Open Logs Folder");
    let quit = CustomMenuItem::new("quit".to_string(), "Quit");
    let tray = SystemTray::new().with_menu(
        SystemTrayMenu::new()
            .add_item(open)
            .add_item(gates)
            .add_item(logs)
            .add_item(quit),
    );

    tauri::Builder::default()
        .setup(move |app| {
            ensure_dashboard_running(&setup_tools_dir);
            if let Some(window) = app.get_window("main") {
                fit_window_to_monitor(&window);
            }
            Ok(())
        })
        .system_tray(tray)
        .on_system_tray_event(move |app, event| {
            if let SystemTrayEvent::MenuItemClick { id, .. } = event {
                match id.as_str() {
                    "open" => {
                        ensure_dashboard_running(&tray_tools_dir);
                        if let Some(window) = app.get_window("main") {
                            fit_window_to_monitor(&window);
                        }
                    }
                    "gates" => {
                        let _ = Command::new("pnpm")
                            .args(["tool", "gates", "check"])
                            .current_dir(&tray_tools_dir)
                            .spawn();
                    }
                    "logs" => {
                        let _ = tauri::api::shell::open(&app.shell_scope(), logs_dir.to_string_lossy(), None);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Docmee DevTools");
}
