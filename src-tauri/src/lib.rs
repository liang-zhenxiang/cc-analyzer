use std::{
    collections::HashMap,
    ffi::OsString,
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

/// 主目录的解析规则：`USERPROFILE`（Windows）优先，回退 `HOME`（Unix），空值不算数。
/// 抽成纯函数是为了在不读改进程环境变量的前提下测试回退顺序——`set_var` 是进程级的，
/// 并行测试会互相干扰。
fn home_dir_from(userprofile: Option<OsString>, home: Option<OsString>) -> Result<String, String> {
    userprofile
        .or(home)
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .map(|path| path.to_string_lossy().into_owned())
        .ok_or_else(|| "无法获取用户主目录".to_string())
}

#[tauri::command]
fn home_dir() -> Result<String, String> {
    home_dir_from(std::env::var_os("USERPROFILE"), std::env::var_os("HOME"))
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

    /// `enter()` 依赖这条关系：浮动尺寸小于常规最小尺寸，所以必须先放松 `min_size`
    /// 再改尺寸，否则窗口会被常规最小尺寸卡住。两个常量之间的关系用编译期断言表达，
    /// 比多写一条运行期测试更早失败、也不占运行时间。
    const _: () = assert!(
        FLOAT_WIDTH < NORMAL_MIN_WIDTH && FLOAT_HEIGHT < NORMAL_MIN_HEIGHT,
        "浮动窗口尺寸必须小于常规最小尺寸"
    );

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

    #[cfg(test)]
    mod tests {
        use super::{
            DEFAULT_HEIGHT, DEFAULT_WIDTH, MAIN_WINDOW, NORMAL_MIN_HEIGHT, NORMAL_MIN_WIDTH,
        };

        /// 编译期把配置读进来：改 `tauri.conf.json` 会重新编译本文件，测试不会读到旧值。
        const TAURI_CONF: &str = include_str!("../tauri.conf.json");

        fn main_window_config() -> serde_json::Value {
            let config: serde_json::Value =
                serde_json::from_str(TAURI_CONF).expect("tauri.conf.json 不是合法 JSON");
            config["app"]["windows"]
                .get(0)
                .cloned()
                .expect("tauri.conf.json 里没有主窗口配置")
        }

        #[test]
        fn size_constants_mirror_tauri_conf() {
            let window = main_window_config();
            assert_eq!(window["width"].as_f64(), Some(DEFAULT_WIDTH));
            assert_eq!(window["height"].as_f64(), Some(DEFAULT_HEIGHT));
            assert_eq!(window["minWidth"].as_f64(), Some(NORMAL_MIN_WIDTH));
            assert_eq!(window["minHeight"].as_f64(), Some(NORMAL_MIN_HEIGHT));
        }

        #[test]
        fn main_window_label_matches_tauri_conf() {
            // get_webview_window("main") 找不到窗口时只会返回「找不到主窗口」，
            // label 一旦漂移，浮动模式会在运行时整体失效。
            assert_eq!(main_window_config()["label"].as_str(), Some(MAIN_WINDOW));
        }
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

/// 真机 GUI 测试取证：把应用自己的 webview 渲染成 PDF。
///
/// **为什么需要它**：macOS 上截取屏幕内容要「屏幕录制」权限，而那只有使用者能在
/// 系统设置里授予——脚本无法申请。实测过连「进程截自己的窗口」也会拿到一张
/// 尺寸正确但像素全透明的图（详见 `.trellis/spec/testing/gui-tests.md`）。
///
/// 这里走的是另一条路：`WKWebView.createPDF` 是 **WebKit 渲染自己的内容**，
/// 根本不经过截屏通道，因此不受 TCC 限制。拿到 PDF 后由测试脚本转成 PNG。
///
/// 只有启用 `gui-capture` feature 才会编译这段代码——**发布构建里没有它**。
#[cfg(all(target_os = "macos", feature = "gui-capture"))]
mod gui_capture {
    use block2::RcBlock;
    use objc2_foundation::{NSData, NSError};
    use objc2_web_kit::WKWebView;
    use std::path::PathBuf;
    use std::time::Duration;
    use tauri::Manager;

    /// 应用启动后等这么久再取图：要留出 webview 完成首次渲染的时间。
    /// 截早了会拿到半张白屏，而那种失败是**静默**的（能生成文件，内容却是空的）。
    const SETTLE_MS: u64 = 6_000;

    pub fn spawn(webview: tauri::Webview, out: PathBuf) {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(SETTLE_MS));
            let result = webview.with_webview(move |platform| {
                // `inner()` 在 macOS 上返回底层 WKWebView 的裸指针。
                let ptr = platform.inner().cast::<WKWebView>();
                if ptr.is_null() {
                    eprintln!("gui-capture: 拿不到 WKWebView 指针");
                    return;
                }
                let wk: &WKWebView = unsafe { &*ptr };

                let target = out.clone();
                let handler = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                    if !data.is_null() {
                        let bytes = unsafe { (*data).to_vec() };
                        match std::fs::write(&target, &bytes) {
                            Ok(()) => println!("gui-capture: 已写出 {} 字节", bytes.len()),
                            Err(err) => eprintln!("gui-capture: 写文件失败 {err}"),
                        }
                    } else {
                        let msg = if error.is_null() {
                            "未知错误".to_string()
                        } else {
                            unsafe { (*error).localizedDescription().to_string() }
                        };
                        eprintln!("gui-capture: 取图失败 {msg}");
                    }
                    // 刻意不退出：应用由测试脚本统一管理生命周期，
                    // 这样同一次启动里还能跑「存活 / 内存 / 缓存 / 正常退出」那些断言。
                });

                // 配置传 None：按文档，这会取「当前显示范围」的整页，
                // 而不是分页的打印版式。
                unsafe { wk.createPDFWithConfiguration_completionHandler(None, &handler) };
            });
            if let Err(err) = result {
                eprintln!("gui-capture: with_webview 失败 {err}");
            }
        });
    }

    /// 由 `setup` 调用：只有设了 `CCA_GUI_CAPTURE` 才生效，否则完全惰性。
    pub fn maybe_spawn(app: &tauri::App) {
        let Ok(target) = std::env::var("CCA_GUI_CAPTURE") else {
            return;
        };
        if target.trim().is_empty() {
            return;
        }
        if let Some(webview) = app.get_webview_window("main") {
            spawn(webview.as_ref().clone(), PathBuf::from(target));
        }
    }
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

            // 真机 GUI 测试取证；未设 CCA_GUI_CAPTURE 时什么都不做。
            #[cfg(all(target_os = "macos", feature = "gui-capture"))]
            gui_capture::maybe_spawn(app);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CC Analyzer");
}

#[cfg(test)]
mod tests {
    use super::{home_dir_from, io_error, string_from_head};
    use std::ffi::OsString;

    // --- io_error：错误文案会原样展示给用户，不能带出原始信息里的路径 ---

    #[test]
    fn a_missing_path_becomes_friendly_copy_without_the_raw_message() {
        let error = std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "No such file or directory: /Users/alice/.claude/projects/x.jsonl",
        );

        let message = io_error("读取文件失败", error);

        assert_eq!(message, "读取文件失败: 文件或目录不存在");
        assert!(
            !message.contains("/Users/"),
            "错误文案不应泄漏绝对路径，实际为: {message}"
        );
    }

    #[test]
    fn other_io_errors_keep_the_context_and_the_cause() {
        let error = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "拒绝访问");

        assert_eq!(io_error("写入文件失败", error), "写入文件失败: 拒绝访问");
    }

    // --- string_from_head：read_head 按字节截断，截口落在字符中间时不能产出半个字符 ---

    #[test]
    fn a_head_ending_inside_a_character_drops_the_partial_character() {
        // 「中文会话」的前 4 个字节停在「文」的首字节上，只应留下「中」。
        let bytes = "中文会话".as_bytes()[..4].to_vec();

        assert_eq!(string_from_head(bytes), "中");
    }

    #[test]
    fn a_head_ending_on_a_character_boundary_is_returned_verbatim() {
        assert_eq!(
            string_from_head("hello\nworld".as_bytes().to_vec()),
            "hello\nworld"
        );
        assert_eq!(string_from_head("中文".as_bytes().to_vec()), "中文");
    }

    #[test]
    fn an_empty_head_is_an_empty_string() {
        assert_eq!(string_from_head(Vec::new()), "");
    }

    #[test]
    fn an_invalid_byte_inside_the_head_drops_everything_after_it() {
        // 逐字节从尾部回退到第一个合法前缀——非法字节之后的内容不会保留，
        // 也不会出现替换字符。这个「静默截断」是当前实现的实际行为。
        assert_eq!(string_from_head(vec![b'a', 0xFF, b'b', b'c']), "a");
    }

    // --- home_dir_from：USERPROFILE 优先、HOME 兜底、空值不算数 ---

    #[test]
    fn userprofile_takes_precedence_over_home() {
        let resolved = home_dir_from(
            Some(OsString::from(r"C:\Users\alice")),
            Some(OsString::from("/home/alice")),
        );

        assert_eq!(resolved, Ok(r"C:\Users\alice".to_string()));
    }

    #[test]
    fn home_is_the_fallback_when_userprofile_is_absent() {
        let resolved = home_dir_from(None, Some(OsString::from("/home/alice")));

        assert_eq!(resolved, Ok("/home/alice".to_string()));
    }

    #[test]
    fn an_empty_value_is_not_a_home_directory() {
        let resolved = home_dir_from(Some(OsString::from("")), None);

        assert_eq!(resolved, Err("无法获取用户主目录".to_string()));
    }

    #[test]
    fn neither_variable_set_is_an_error() {
        assert_eq!(
            home_dir_from(None, None),
            Err("无法获取用户主目录".to_string())
        );
    }
}
