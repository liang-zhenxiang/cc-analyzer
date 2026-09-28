use std::{
    collections::HashMap,
    net::{Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    sync::Mutex as StdMutex,
    time::Duration,
};

use serde::Serialize;
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;

/// Tracks in-flight `run_lines` calls so the UI can cancel them.
#[derive(Default)]
struct ProcState {
    cancels: StdMutex<HashMap<String, oneshot::Sender<()>>>,
}

#[derive(Serialize)]
struct DirEntry {
    name: String,
    is_dir: bool,
    is_file: bool,
}

#[derive(Serialize)]
struct StatInfo {
    is_file: bool,
    size: u64,
    mtime_ms: u64,
}

#[derive(Serialize)]
struct RunLinesResult {
    ok: bool,
    error: Option<String>,
    stderr: String,
}

#[derive(Serialize)]
struct ExecTextResult {
    ok: bool,
    out: String,
    error: Option<String>,
}

fn io_error(context: &str, error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        format!("{context}: 文件或目录不存在")
    } else {
        format!("{context}: {error}")
    }
}

fn modified_ms(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|time| time.as_millis() as u64)
        .unwrap_or(0)
}

fn string_from_head(mut bytes: Vec<u8>) -> String {
    while !bytes.is_empty() && std::str::from_utf8(&bytes).is_err() {
        bytes.pop();
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn child_command(program: &str, args: &[String]) -> tokio::process::Command {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        // npm-installed CLIs commonly expose a .cmd shim that cannot be spawned
        // directly by CreateProcess. Route bare commands through cmd.exe.
        let mut command = if Path::new(program).extension().is_none() {
            let mut command = tokio::process::Command::new("cmd.exe");
            command.arg("/d").arg("/c").arg(program).args(args);
            command
        } else {
            let mut command = tokio::process::Command::new(program);
            command.args(args);
            command
        };
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }

    #[cfg(not(windows))]
    {
        let _ = program;
        let mut command = tokio::process::Command::new(program);
        command.args(args);
        command
    }
}

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| io_error("读取目录失败", e))?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| io_error("读取目录项失败", e))?;
        let file_type = entry
            .file_type()
            .map_err(|e| io_error("读取文件类型失败", e))?;
        result.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: file_type.is_dir(),
            is_file: file_type.is_file(),
        });
    }
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

#[tauri::command]
fn stat(path: String) -> Result<StatInfo, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| io_error("获取文件信息失败", e))?;
    Ok(StatInfo {
        is_file: metadata.is_file(),
        size: metadata.len(),
        mtime_ms: modified_ms(&metadata),
    })
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| io_error("读取文件失败", e))
}

#[tauri::command]
fn read_head(path: String, max_bytes: u64) -> Result<String, String> {
    use std::io::Read;
    let file = std::fs::File::open(&path).map_err(|e| io_error("读取文件失败", e))?;
    let mut bytes = Vec::new();
    file.take(max_bytes)
        .read_to_end(&mut bytes)
        .map_err(|e| io_error("读取文件失败", e))?;
    Ok(string_from_head(bytes))
}

#[tauri::command]
fn write_text(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| io_error("创建目录失败", e))?;
    }
    std::fs::write(&path, contents).map_err(|e| io_error("写入文件失败", e))
}

// Tauri command 的参数即前端 invoke 的调用签名；收拢成参数对象需要同步改动
// 前端 API，不属于内部可自由重构的范围，故豁免参数数量检查。
#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn run_lines(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProcState>,
    stream_id: String,
    cmd: String,
    args: Vec<String>,
    stdin_text: Option<String>,
    timeout_ms: Option<u64>,
    label: Option<String>,
) -> Result<RunLinesResult, String> {
    let _ = label;
    let mut command = child_command(&cmd, &args);
    command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return Ok(RunLinesResult {
                ok: false,
                error: Some(format!("启动命令失败: {error}")),
                stderr: String::new(),
            })
        }
    };

    if let Some(text) = stdin_text.filter(|text| !text.is_empty()) {
        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            stdin
                .write_all(text.as_bytes())
                .await
                .map_err(|e| io_error("写入命令输入失败", e))?;
        }
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取命令输出".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取命令错误输出".to_string())?;
    let event_app = app.clone();
    let event_name = format!("proc:line:{stream_id}");

    let stdout_task = tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = event_app.emit(&event_name, line);
        }
    });

    let stderr_task = tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut text = String::new();
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            text.push_str(&line);
            text.push('\n');
        }
        text
    });

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    state
        .cancels
        .lock()
        .map_err(|_| "无法登记取消句柄".to_string())?
        .insert(stream_id.clone(), cancel_tx);

    enum WaitOutcome {
        Exited(std::io::Result<std::process::ExitStatus>),
        TimedOut,
        Cancelled,
    }

    let wait_outcome = {
        let wait = async {
            match timeout_ms {
                Some(ms) => tokio::time::timeout(Duration::from_millis(ms), child.wait()).await,
                None => Ok(child.wait().await),
            }
        };
        tokio::pin!(wait);
        tokio::select! {
            result = &mut wait => match result {
                Ok(result) => WaitOutcome::Exited(result),
                Err(_) => WaitOutcome::TimedOut,
            },
            _ = cancel_rx => WaitOutcome::Cancelled,
        }
    };

    let _ = state
        .cancels
        .lock()
        .map(|mut cancels| cancels.remove(&stream_id));

    let cancelled = matches!(wait_outcome, WaitOutcome::Cancelled);
    let status = match wait_outcome {
        WaitOutcome::Exited(Ok(status)) => Some(status),
        WaitOutcome::Exited(Err(error)) => return Err(io_error("等待命令失败", error)),
        WaitOutcome::TimedOut => {
            let _ = child.kill().await;
            None
        }
        WaitOutcome::Cancelled => {
            let _ = child.kill().await;
            // Reap the killed child so it does not linger as a zombie.
            let _ = child.wait().await;
            None
        }
    };

    let stderr_text = stderr_task
        .await
        .unwrap_or_else(|_| "无法收集命令错误输出".to_string());
    let _ = stdout_task.await;

    if cancelled {
        return Ok(RunLinesResult {
            ok: false,
            error: Some("分析已取消".to_string()),
            stderr: stderr_text,
        });
    }

    if status.is_none() {
        return Ok(RunLinesResult {
            ok: false,
            error: Some("命令执行超时".to_string()),
            stderr: stderr_text,
        });
    }

    let status = status.expect("status checked");
    Ok(RunLinesResult {
        ok: status.success(),
        error: (!status.success()).then(|| format!("命令退出码: {status}")),
        stderr: stderr_text,
    })
}

#[tauri::command]
async fn exec_text(cmd: String, args: Vec<String>) -> Result<ExecTextResult, String> {
    let mut command = child_command(&cmd, &args);
    let output = command.output().await;

    let output = match output {
        Ok(output) => output,
        Err(error) => {
            return Ok(ExecTextResult {
                ok: false,
                out: String::new(),
                error: Some(format!("启动命令失败: {error}")),
            })
        }
    };

    Ok(ExecTextResult {
        ok: output.status.success(),
        out: String::from_utf8_lossy(&output.stdout).into_owned(),
        error: (!output.status.success())
            .then(|| String::from_utf8_lossy(&output.stderr).into_owned()),
    })
}

#[tauri::command]
async fn cancel_lines(
    state: tauri::State<'_, ProcState>,
    stream_id: String,
) -> Result<bool, String> {
    let sender = state
        .cancels
        .lock()
        .map_err(|_| "无法读取取消句柄".to_string())?
        .remove(&stream_id);
    match sender {
        Some(sender) => {
            let _ = sender.send(());
            Ok(true)
        }
        None => Ok(false),
    }
}

#[tauri::command]
async fn spawn_detached(exe: String, args: Vec<String>, cwd: Option<String>) -> Result<(), String> {
    let mut command = tokio::process::Command::new(&exe);
    command
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }

    #[cfg(unix)]
    command.process_group(0);

    let child = command.spawn().map_err(|e| io_error("启动进程失败", e))?;
    tokio::spawn(async move {
        let mut child = child;
        let _ = child.wait().await;
    });
    Ok(())
}

#[tauri::command]
fn home_dir() -> Result<String, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .map(|path| path.to_string_lossy().into_owned())
        .ok_or_else(|| "无法获取用户主目录".to_string())
}

#[tauri::command]
fn app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn monitor_port() -> u16 {
    8090
}

#[tauri::command]
fn monitor_ping() -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, 8090));
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

mod float_plugin {
    use std::sync::Mutex;

    use tauri::{LogicalSize, Manager};

    const MAIN_WINDOW: &str = "main";
    const FLOAT_WIDTH: f64 = 420.0;
    const FLOAT_HEIGHT: f64 = 620.0;
    /// Mirrors `minWidth`/`minHeight` in `tauri.conf.json`.
    const NORMAL_MIN_WIDTH: f64 = 960.0;
    const NORMAL_MIN_HEIGHT: f64 = 640.0;
    const DEFAULT_WIDTH: f64 = 1400.0;
    const DEFAULT_HEIGHT: f64 = 900.0;

    /// Remembers the window geometry from before float mode so `exit` can restore it.
    #[derive(Default)]
    struct RestoreState(Mutex<Option<LogicalSize<f64>>>);

    fn main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
        app.get_webview_window(MAIN_WINDOW)
            .ok_or_else(|| "找不到主窗口".to_string())
    }

    #[tauri::command]
    fn enter(app: tauri::AppHandle, state: tauri::State<'_, RestoreState>) -> Result<(), String> {
        let window = main_window(&app)?;

        // Record the pre-float size once, so repeated enters keep the original geometry.
        if let Ok(size) = window.inner_size() {
            let scale = window.scale_factor().unwrap_or(1.0);
            let mut restore = state.0.lock().map_err(|e| e.to_string())?;
            if restore.is_none() {
                *restore = Some(size.to_logical(scale));
            }
        }

        // Float mode is smaller than the normal minimum size, so relax the constraint first.
        window
            .set_min_size(Some(LogicalSize::new(FLOAT_WIDTH, FLOAT_HEIGHT)))
            .map_err(|e| e.to_string())?;
        window
            .set_size(LogicalSize::new(FLOAT_WIDTH, FLOAT_HEIGHT))
            .map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        window.set_decorations(false).map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        Ok(())
    }

    #[tauri::command]
    fn exit(app: tauri::AppHandle, state: tauri::State<'_, RestoreState>) -> Result<(), String> {
        let window = main_window(&app)?;
        let restore = state
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .take()
            .unwrap_or(LogicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT));

        window.set_always_on_top(false).map_err(|e| e.to_string())?;
        window.set_decorations(true).map_err(|e| e.to_string())?;
        window
            .set_min_size(Some(LogicalSize::new(NORMAL_MIN_WIDTH, NORMAL_MIN_HEIGHT)))
            .map_err(|e| e.to_string())?;
        window.set_size(restore).map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
        tauri::plugin::Builder::new("float")
            .invoke_handler(tauri::generate_handler![enter, exit])
            .setup(|app, _api| {
                app.manage(RestoreState::default());
                Ok(())
            })
            .build()
    }
}

fn import_session_menu(app: &tauri::AppHandle) {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .add_filter("Claude Session", &["jsonl"])
        .pick_file({
            let app = app.clone();
            move |file| {
                let Some(file) = file else { return };
                let Ok(path) = file.simplified().into_path() else {
                    return;
                };
                let path: PathBuf = path;
                let _ = app.emit("session:import", path.to_string_lossy().into_owned());
            }
        });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(float_plugin::init())
        .manage(ProcState::default())
        .invoke_handler(tauri::generate_handler![
            read_dir,
            stat,
            read_text,
            read_head,
            write_text,
            run_lines,
            cancel_lines,
            exec_text,
            spawn_detached,
            home_dir,
            app_data_dir,
            monitor_port,
            monitor_ping,
        ])
        .setup(|app| {
            use tauri::menu::{MenuBuilder, SubmenuBuilder};
            let handle = app.handle();
            let file_menu = SubmenuBuilder::new(handle, "文件")
                .text("import-session", "导入会话…")
                .separator()
                .text("quit", "退出")
                .build()?;
            let menu = MenuBuilder::new(handle).item(&file_menu).build()?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| match event.id().as_ref() {
                "import-session" => import_session_menu(app),
                "quit" => app.exit(0),
                _ => {}
            });

            if let Ok(parent) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(parent);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CC Analyzer");
}
