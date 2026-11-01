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

/// Writes `contents_base64` decoded to bytes. The poster export is the only
/// caller: a PNG cannot travel as a `String`, so the frontend hands over the
/// base64 half of a data URL and Rust owns the decode + the write.
#[tauri::command]
fn write_binary(path: String, contents_base64: String) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
    let bytes = BASE64_STANDARD
        .decode(contents_base64.as_bytes())
        .map_err(|error| format!("解码 base64 失败: {error}"))?;
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| io_error("创建目录失败", e))?;
    }
    std::fs::write(&path, bytes).map_err(|e| io_error("写入文件失败", e))
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
    // 空值必须在 `or` 之前剔除：Windows 上 `USERPROFILE=""` 很常见，若先 `or` 再过滤，
    // `Some("")` 会顶掉 `HOME` 的位置，然后整个候选被丢掉——结果是既不报「没设」、
    // 也不回退到真正可用的 `HOME`。
    let pick = |value: Option<OsString>| value.filter(|raw| !raw.is_empty());
    pick(userprofile)
        .or_else(|| pick(home))
        .map(PathBuf::from)
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

/// monitor 服务监听的端口。`monitor_port`（前端用来拼地址）与 `monitor_ping`
/// （用来探测服务是否在跑）必须指同一个端口，所以收敛到一个常量。
const MONITOR_PORT: u16 = 8090;

#[tauri::command]
fn monitor_port() -> u16 {
    MONITOR_PORT
}

#[tauri::command]
fn monitor_ping() -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, MONITOR_PORT));
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
    #[cfg(test)]
    const DEFAULT_WIDTH: f64 = 1400.0;
    #[cfg(test)]
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

    fn gui_capture_enabled() -> bool {
        std::env::var_os("CCA_GUI_CAPTURE").is_some()
    }

    fn log_window_geometry(label: &str, window: &tauri::WebviewWindow) {
        if !gui_capture_enabled() {
            return;
        }
        let scale = window.scale_factor();
        let scale_value = scale.as_ref().copied().unwrap_or(1.0);
        let scale_error = scale.err().map(|err| err.to_string());
        let inner = window.inner_size();
        let inner_error = inner.as_ref().err().map(ToString::to_string);
        let inner_physical = inner.as_ref().ok().copied();
        let inner_logical = inner_physical.map(|size| size.to_logical::<f64>(scale_value));
        let webview = window.as_ref().size();
        let webview_error = webview.as_ref().err().map(ToString::to_string);
        let webview_physical = webview.as_ref().ok().copied();
        let webview_logical = webview_physical.map(|size| size.to_logical::<f64>(scale_value));
        let outer = window.outer_size();
        let outer_error = outer.as_ref().err().map(ToString::to_string);
        let outer_physical = outer.as_ref().ok().copied();
        let outer_logical = outer_physical.map(|size| size.to_logical::<f64>(scale_value));
        eprintln!(
            "float-debug: {label}: scale_factor={scale_value:.4} \
             inner_physical={inner_physical:?} inner_logical={inner_logical:?} \
             webview_physical={webview_physical:?} webview_logical={webview_logical:?} \
             outer_physical={outer_physical:?} outer_logical={outer_logical:?} \
             scale_error={scale_error:?} inner_error={inner_error:?} \
             webview_error={webview_error:?} outer_error={outer_error:?}"
        );
    }

    fn remember_restore_size(
        state: &Mutex<Option<LogicalSize<f64>>>,
        size: LogicalSize<f64>,
    ) -> Result<bool, String> {
        let mut restore = state
            .lock()
            .map_err(|e| format!("RestoreState 加锁失败: {e}"))?;
        let recorded = restore.is_none();
        if recorded {
            *restore = Some(size);
        }
        Ok(recorded)
    }

    fn restore_size(state: &Mutex<Option<LogicalSize<f64>>>) -> Result<LogicalSize<f64>, String> {
        state
            .lock()
            .map_err(|e| format!("RestoreState 加锁失败: {e}"))?
            .as_ref()
            .copied()
            .ok_or_else(|| "没有可恢复的浮窗前窗口尺寸".to_string())
    }

    fn clear_restore_size(state: &Mutex<Option<LogicalSize<f64>>>) -> Result<(), String> {
        *state
            .lock()
            .map_err(|e| format!("RestoreState 加锁失败: {e}"))? = None;
        Ok(())
    }

    fn viewport_size(width: f64, height: f64) -> Result<LogicalSize<f64>, String> {
        if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
            return Err(format!(
                "浮窗前 viewport 尺寸无效（width={width}, height={height}）"
            ));
        }
        Ok(LogicalSize::new(width, height))
    }

    /// `enter` 中途失败后的尽力回滚：每项都尝试，单项失败不阻止其余状态修复。
    fn restore_after_failed_enter(
        window: &tauri::WebviewWindow,
        restore: LogicalSize<f64>,
    ) -> Result<(), String> {
        let mut errors = Vec::new();
        if let Err(err) = window.set_always_on_top(false) {
            errors.push(format!("取消置顶失败: {err}"));
        }
        if let Err(err) = window.set_decorations(true) {
            errors.push(format!("恢复窗口装饰失败: {err}"));
        }
        if let Err(err) =
            window.set_min_size(Some(LogicalSize::new(NORMAL_MIN_WIDTH, NORMAL_MIN_HEIGHT)))
        {
            errors.push(format!("恢复最小尺寸失败: {err}"));
        }
        if let Err(err) = window.set_size(restore) {
            errors.push(format!("恢复窗口尺寸失败: {err}"));
        }
        if let Err(err) = window.show() {
            errors.push(format!("恢复窗口显示失败: {err}"));
        }
        if let Err(err) = window.set_focus() {
            errors.push(format!("恢复窗口焦点失败: {err}"));
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    fn main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
        app.get_webview_window(MAIN_WINDOW)
            .ok_or_else(|| "找不到主窗口".to_string())
    }

    #[tauri::command]
    fn enter(
        app: tauri::AppHandle,
        state: tauri::State<'_, RestoreState>,
        width: f64,
        height: f64,
    ) -> Result<(), String> {
        let window = main_window(&app)?;
        log_window_geometry("enter:before", &window);

        // 当前 macOS/Tauri 组合里 inner_size() 与 Webview::size() 都返回外框，
        // 与页面 window.innerHeight 相差一个标题栏。恢复基线只能取前端同一口径。
        let content = viewport_size(width, height)?;
        let recorded = remember_restore_size(&state.0, content)?;
        if gui_capture_enabled() {
            eprintln!("float-debug: enter:restore recorded={recorded} content_logical={content:?}");
        }

        let apply = (|| -> Result<(), String> {
            // Float mode is smaller than the normal minimum size, so relax the constraint first.
            window
                .set_min_size(Some(LogicalSize::new(FLOAT_WIDTH, FLOAT_HEIGHT)))
                .map_err(|e| e.to_string())?;
            log_window_geometry("enter:after_min_size", &window);
            window
                .set_size(LogicalSize::new(FLOAT_WIDTH, FLOAT_HEIGHT))
                .map_err(|e| e.to_string())?;
            log_window_geometry("enter:after_set_size", &window);
            window.set_always_on_top(true).map_err(|e| e.to_string())?;
            window.set_decorations(false).map_err(|e| e.to_string())?;
            log_window_geometry("enter:after_decorations", &window);
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            Ok(())
        })();
        if let Err(enter_error) = apply {
            return match restore_after_failed_enter(&window, content) {
                Ok(()) => Err(enter_error),
                Err(rollback_error) => Err(format!(
                    "{enter_error}; 进入失败后的窗口回滚也未完成: {rollback_error}"
                )),
            };
        }
        Ok(())
    }

    #[tauri::command]
    fn exit(app: tauri::AppHandle, state: tauri::State<'_, RestoreState>) -> Result<(), String> {
        let window = main_window(&app)?;
        let restore = restore_size(&state.0)?;
        if gui_capture_enabled() {
            eprintln!("float-debug: exit:restore target_logical={restore:?}");
        }
        log_window_geometry("exit:before", &window);

        window.set_always_on_top(false).map_err(|e| e.to_string())?;
        window.set_decorations(true).map_err(|e| e.to_string())?;
        log_window_geometry("exit:after_decorations", &window);
        window
            .set_min_size(Some(LogicalSize::new(NORMAL_MIN_WIDTH, NORMAL_MIN_HEIGHT)))
            .map_err(|e| e.to_string())?;
        log_window_geometry("exit:after_min_size", &window);
        window.set_size(restore).map_err(|e| e.to_string())?;
        log_window_geometry("exit:after_set_size", &window);
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        // 窗口命令全部成功后才消费基线；中途失败时保留它，用户重试仍有正确目标。
        clear_restore_size(&state.0)?;
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
        use std::sync::Mutex;

        use tauri::LogicalSize;

        use super::{
            clear_restore_size, remember_restore_size, restore_size, viewport_size, DEFAULT_HEIGHT,
            DEFAULT_WIDTH, MAIN_WINDOW, NORMAL_MIN_HEIGHT, NORMAL_MIN_WIDTH,
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

        #[test]
        fn repeated_enter_keeps_the_first_restore_size() {
            let state = Mutex::new(None);
            let first = LogicalSize::new(1400.0, 872.0);
            let second = LogicalSize::new(1200.0, 700.0);

            assert_eq!(remember_restore_size(&state, first), Ok(true));
            assert_eq!(remember_restore_size(&state, second), Ok(false));
            assert_eq!(restore_size(&state), Ok(first));
        }

        #[test]
        fn exit_without_enter_does_not_use_a_hard_coded_fallback() {
            let state = Mutex::new(None);

            assert_eq!(
                restore_size(&state),
                Err("没有可恢复的浮窗前窗口尺寸".to_string())
            );
        }

        #[test]
        fn restore_size_survives_a_failed_exit_until_it_is_cleared() {
            let state = Mutex::new(None);
            let size = LogicalSize::new(1400.0, 872.0);
            remember_restore_size(&state, size).expect("记录首次基线");

            // 模拟 exit 中途失败：读基线不能消费它，第二次仍拿到同一目标。
            assert_eq!(restore_size(&state), Ok(size));
            assert_eq!(restore_size(&state), Ok(size));

            clear_restore_size(&state).expect("完整退出后清理基线");
            assert!(restore_size(&state).is_err());
        }

        #[test]
        fn viewport_size_requires_finite_positive_dimensions() {
            assert_eq!(
                viewport_size(1400.0, 872.0),
                Ok(LogicalSize::new(1400.0, 872.0))
            );
            assert!(viewport_size(0.0, 872.0).is_err());
            assert!(viewport_size(1400.0, 0.0).is_err());
            assert!(viewport_size(1400.0, f64::NAN).is_err());
            assert!(viewport_size(f64::INFINITY, 872.0).is_err());
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

mod updater;
// 顶层重导出：generate_handler 以裸名注册，build.rs 的权限清单才能用
// 裸名——带 `::` 的名字会生成 Windows 文件系统非法的权限文件名
// （v0.9.0-beta.1 的 Windows 构建当场拦下）。
use updater::{app_version, check_updates, install_update, relaunch_app};

mod archive_bundle;
// 同上：归档包的三个命令也以裸名注册，好让 build.rs 的权限清单对上。
use archive_bundle::{export_archive_bundle, import_archive_bundle, remove_import_staging};

mod tray;
// 同上：托盘读数的两个命令也以裸名注册，好让 build.rs 的权限清单对上。
use tray::{set_tray_visible, update_tray_readout};

/// 真机门禁里**与平台无关**的那一半：几何探针脚本、目标解析、注入脚本构造与产出文件名派生。
///
/// 这些是纯字符串 / 路径逻辑，没有一行 macOS 依赖。把 `#[cfg(test)] mod tests` 与它们
/// 留在同一个 `target_os = "macos"` 门后面，代价是**这些单测在 CI 上永远跑不到**——
/// `ci.yml` 的四个 Rust 作业全在 ubuntu，`target_os` 为假时整个模块连编译都不发生，
/// 加 `--features gui-capture` 也一样（#160）。
///
/// 所以单独成模块，门也单独写：
/// - **测试时任何平台都编译**——Linux 的现有作业裸跑 `cargo test` 就覆盖到；
/// - **正式构建里仍然只在 macOS + `gui-capture` 下存在**——发布产物不含任何门禁代码。
#[cfg(any(test, all(target_os = "macos", feature = "gui-capture")))]
mod gui_probe {
    use std::path::{Path, PathBuf};

    /// 几何探针脚本：**只收集事实，不含任何断言或阈值**——判定属于测试脚本，
    /// 应用不该携带测试策略。返回一个 JSON 字符串。
    ///
    /// 锚点：`data-probe="gauge"`（仅用于探测的稳定属性；Gauge 的 `aria-label`
    /// 是随读数变化的文案，靠它匹配会在文案改动后**静默失配**），卡片复用既有的
    /// `aria-label="计费窗口"`，记录表复用 `table` / `[data-scroll-hint]` 结构。
    pub(super) const PROBE_JS: &str = r##"(function () {
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  function boxOf(el) {
    if (!el) return null;
    return {
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      /* 滚动几何：内容区自己的滚动容器（main）滚一次能带走多少内容，
         「滚一次可达」的判定靠它们——事实在这里，判定在脚本。 */
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      overflowX: getComputedStyle(el).overflowX,
      right: el.getBoundingClientRect().right
    };
  }
  var mainEl = document.querySelector('main');
  var mainScrollTop = mainEl ? mainEl.scrollTop : 0;
  var facts = {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    },
    /* 终端转义序列（ESC）不该出现在**任何**渲染出来的文字里：它是控制字节，
       不是文本。计数是事实，阈值与判定留给脚本。 */
    escaped_text: (document.body.innerText.match(/\u001b/g) || []).length,
    /* 界面字号当前档位（"1" / "1.3"）。缩放是否真的落到根元素上，这是唯一的事实
       来源；阈值与判定留给脚本。 */
    font_scale: getComputedStyle(document.documentElement).getPropertyValue('--font-scale').trim(),
    /* 界面当前是不是高对比度档（Round U / #73）。`""` = 普通档（属性被清掉，
       不是留着 "normal"）；阈值与判定留给脚本。 */
    contrast: document.documentElement.getAttribute('data-contrast') || '',
    main: boxOf(mainEl),
    /* main 自身的视口矩形：限额卡「含于内容区」的横向判定要用它。 */
    mainRect: mainEl ? rectOf(mainEl) : null,
    elements: [],
    tables: [],
    /* 会话列表的可见行。字号放大最先把这里撑破——行高是 `overflow: hidden` 的
       固定盒（`height: calc(54px * var(--font-scale))`）。锚点是列表自己的
       `aria-label` 与会话按钮的 `title`（cwd），不碰 CSS Module 的哈希类名。 */
    session_rows: [],
    /* 内容区的面板标题（Panel / ReportPanel 的 <h2>）。top 是视口坐标，
       docTop 是它在滚动内容里的位置（top + 当时的 scrollTop）——「滚一次
       能不能到达」拿 docTop 与 main 的滚动几何比较，判定在脚本。 */
    panels: []
  };
  var gauge = document.querySelector("[data-probe='gauge']");
  if (gauge) {
    var card = gauge.closest("[aria-label='计费窗口']");
    facts.elements.push({ name: 'gauge', rect: rectOf(gauge), card: card ? rectOf(card) : null });
  }
  // 模态浮层：导出与全局搜索都是 [role=dialog][aria-modal]，靠 label 分流
  // （导出浮层用 aria-labelledby 指向标题 id，搜索浮层用 aria-label）。
  // 它们是 `position: fixed`，createPDF 不画进图——几何才是它们的证据。
  // 只收集几何与 label，判定留在脚本里。
  var dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
  for (var d = 0; d < dialogs.length; d++) {
    var dialogText = (dialogs[d].textContent || '').replace(/\s+/g, ' ').trim();
    facts.elements.push({
      name: 'dialog',
      label: dialogs[d].getAttribute('aria-label') || dialogs[d].getAttribute('aria-labelledby') || '',
      rect: rectOf(dialogs[d]),
      /* 口令字段数与可见文案（截断）：口令无法找回这类警告句是否真的渲染出来，
         靠它判定——浮层是 fixed，createPDF 不画它，截图上看不到。 */
      passwordFields: dialogs[d].querySelectorAll('input[type="password"]').length,
      text: dialogText.slice(0, 300)
    });
  }
  // 限额区：两层限额（5 小时卡 + 周用量层）都要「读数在卡内、卡在内容区」。
  // 读数锚点是卡内的 <b>——数值全是 <b>（CSS Module 类名带哈希，语义标签稳定）。
  var billing = document.querySelector("section[aria-label='计费窗口']");
  if (billing) {
    var weekly = billing.querySelector("section[aria-label='周用量（滚动 7 天）']");
    var valueEls = billing.querySelectorAll('b');
    var valueRects = [];
    for (var v = 0; v < valueEls.length; v++) valueRects.push(rectOf(valueEls[v]));
    facts.elements.push({
      name: 'billing',
      card: rectOf(billing),
      weekly: weekly ? rectOf(weekly) : null,
      values: valueRects
    });
  }
  /* 锚点是 data-probe="record-table"：裸 'table' 依赖「同屏唯一 table」的旧假设，
     消耗日历（Round V）给用量页带来第二个 table 后它会被误捕（日历无 thead，
     lastColumnRight 为 null → 门禁误报「末列被裁切」）。 */
  var table = document.querySelector('table[data-probe="record-table"]');
  if (table) {
    var container = table.parentElement;
    var headers = table.querySelectorAll('thead th');
    var lastHeader = headers.length ? headers[headers.length - 1] : null;
    var wrap = container ? container.parentElement : null;
    var hint = wrap ? wrap.querySelector('[data-scroll-hint]') : null;
    facts.tables.push({
      name: 'records',
      container: boxOf(container),
      hasLastColumn: !!lastHeader,
      lastColumnRight: lastHeader ? lastHeader.getBoundingClientRect().right : null,
      hasScrollHint: !!hint
    });
  }
  if (mainEl) {
    var heads = mainEl.querySelectorAll('h2');
    for (var h = 0; h < heads.length; h++) {
      var hr = heads[h].getBoundingClientRect();
      facts.panels.push({
        title: (heads[h].textContent || '').trim(),
        top: hr.top,
        docTop: hr.top + mainScrollTop
      });
    }
  }
  /* 行盒是 `.sessionRow` 包装层（`height: calc(54px * --font-scale)` +
     `overflow: hidden`），行本体是它内部 `role="button"` 的 <div>——#209 之后
     行不再是 <button>（出血点徽章得是真按钮，按钮不能嵌按钮），所以锚点从标签名
     换成 role + title，与 web/e2e/selectors.ts 的 SESSION_ITEM_SELECTOR 同一
     形态（那边用 `:has(strong)` 挡噪声，这里用 JS 过滤——避免老 WebKit 上
     `:has()` 抛 SyntaxError 把整份探针带走）。 */
  var sessionRowNodes = document.querySelectorAll('[aria-label="会话列表"] [role="button"][title]');
  for (var i = 0; i < sessionRowNodes.length && facts.session_rows.length < 3; i++) {
    if (!sessionRowNodes[i].querySelector('strong')) continue;
    var row = sessionRowNodes[i].parentElement;
    if (!row) continue;
    facts.session_rows.push({
      clientHeight: row.clientHeight,
      scrollHeight: row.scrollHeight,
      height: Math.round(row.getBoundingClientRect().height)
    });
  }
  /* 上下文标签页（Round J）：曲线 SVG、压缩命中区、取证卡、被丢清单与解析
     覆盖率 chip 的原始事实。锚点刻意绕开 CSS Module 哈希类名——图表宿主靠
     role/aria-label（曲线图是全站唯一的 role=img 区域），清单与取证卡靠组件
     上的 data-probe 稳定属性（同 gauge 先例），覆盖率 chip 靠全站唯一的
     aria-haspopup="dialog" 按钮。不在上下文视图时各子项为 null，判定在脚本。 */
  var contextFacts = { chart: null, forensicCard: null, dropped: null, coverageChip: null };
  var chartHost = document.querySelector('div[role="img"][aria-label^="上下文压力"]');
  var chartSvg = chartHost ? chartHost.querySelector('svg') : null;
  if (chartSvg) {
    var vb = chartSvg.getAttribute('viewBox');
    var chartRect = chartSvg.getBoundingClientRect();
    contextFacts.chart = {
      viewBox: vb,
      width: Math.round(chartRect.width),
      height: Math.round(chartRect.height),
      /* 压缩事件的 24px 命中区数量：数量与夹具的压缩次数对得上才有意义。 */
      eventHits: chartSvg.querySelectorAll('rect[data-event-id]').length
    };
  }
  var forensicCard = document.querySelector('[data-probe="forensic-card"]');
  if (forensicCard) {
    contextFacts.forensicCard = { rect: rectOf(forensicCard) };
  }
  /* 事件 chip 的在场与选中态——「点击没落地」与「选中了但卡片没渲染」靠它分辨。 */
  var chipNodes = document.querySelectorAll('[data-probe^="compact-event-"]');
  contextFacts.eventChips = Array.prototype.map.call(chipNodes, function (chip) {
    return {
      probe: chip.getAttribute('data-probe'),
      pressed: chip.getAttribute('aria-pressed'),
      disabled: chip.disabled === true
    };
  });
  var droppedEl = document.querySelector('[data-probe="dropped-list"]');
  if (droppedEl) {
    var droppedItems = droppedEl.querySelectorAll('ul > li');
    var droppedVisible = 0;
    var firstRowHeight = null;
    var padHeights = [];
    var declaredCount = null;
    /* 标题在滚动容器**外面**的 header 里（data-probe 挂在滚动容器上）——
       先回到 section 再找 h3，别在容器内部空找。 */
    var headingSection = droppedEl.closest('section');
    var heading = headingSection ? headingSection.querySelector('h3') : null;
    var countMatch = heading
      ? (heading.textContent || '').match(/(\d+)\s*条/)
      : null;
    if (countMatch) declaredCount = parseInt(countMatch[1], 10);
    for (var k = 0; k < droppedItems.length; k++) {
      var item = droppedItems[k];
      if (item.getAttribute('aria-hidden') === 'true') {
        padHeights.push(item.offsetHeight);
      } else {
        droppedVisible += 1;
        if (firstRowHeight === null) {
          /* 不取整：130% 字号下行高是 35.39px 这种值，round 成 35 再乘 82 行
             会凭空差出 32px——亚像素累计属于事实，不该被断言口径吃掉。 */
          firstRowHeight = item.getBoundingClientRect().height;
        }
      }
    }
    contextFacts.dropped = {
      clientHeight: droppedEl.clientHeight,
      /* 行数 × 行高的账要跟 <ul> 自己对——滚动容器自带上下内边距（130% 字号下
         实测 32px），拿容器的 scrollHeight 对账会把内边距算成「假列表」。 */
      listScrollHeight: (droppedEl.querySelector('ul') || droppedEl).scrollHeight,
      scrollHeight: droppedEl.scrollHeight,
      scrollTop: droppedEl.scrollTop,
      declaredCount: declaredCount,
      visibleRows: droppedVisible,
      firstRowHeight: firstRowHeight,
      padHeights: padHeights
    };
  }
  var coverageBtn = document.querySelector('button[aria-haspopup="dialog"]');
  if (coverageBtn) {
    contextFacts.coverageChip = {
      text: (coverageBtn.textContent || '').replace(/\s+/g, ' ').trim(),
      rect: rectOf(coverageBtn)
    };
  }
  facts.context = contextFacts;
  /* 错误档（Round N / N1）：趋势 SVG、事件列表滚动几何与过滤态的原始事实。
     锚点全是组件自带的 data-error-* 稳定属性（同 data-probe 先例，不碰
     CSS Module 哈希类名）；不在错误档时 view 为 null，判定在脚本。 */
  var errorFacts = { view: null, trend: null, events: null, filter: null };
  var errorView = document.querySelector('[data-error-view]');
  if (errorView) {
    errorFacts.view = true;
    var trendSvg = errorView.querySelector('[data-error-trend] svg');
    if (trendSvg) {
      var trendRect = trendSvg.getBoundingClientRect();
      errorFacts.trend = {
        viewBox: trendSvg.getAttribute('viewBox'),
        width: Math.round(trendRect.width),
        height: Math.round(trendRect.height),
        /* 工具柱数量：与区间天数对得上才有意义（零填充天也有短桩）。 */
        bars: trendSvg.querySelectorAll('rect[data-bar]').length
      };
    }
    var eventsEl = errorView.querySelector('[data-error-events]');
    if (eventsEl) {
      var eventItems = eventsEl.querySelectorAll('ul > li');
      var eventsVisible = 0;
      var eventsFirstRowHeight = null;
      var eventsPads = [];
      var eventsDeclared = null;
      /* 描述行（面板体首行，在滚动容器**外面**）里「N 条」就是声明行数——回到
         section 再读文本（同 dropped-list 的标题教训）；行内文本没有「N 条」，
         首个匹配即描述行。账目与 <ul> 自己的总高对（容器内边距不掺和）。 */
      var eventsSection = eventsEl.closest('section');
      var descMatch = (eventsSection ? eventsSection.textContent : '').match(/(\d+)\s*条/);
      if (descMatch) eventsDeclared = parseInt(descMatch[1], 10);
      for (var e = 0; e < eventItems.length; e++) {
        var item = eventItems[e];
        if (item.getAttribute('aria-hidden') === 'true') {
          eventsPads.push(item.offsetHeight);
        } else {
          eventsVisible += 1;
          if (eventsFirstRowHeight === null) {
            eventsFirstRowHeight = item.getBoundingClientRect().height;
          }
        }
      }
      errorFacts.events = {
        clientHeight: eventsEl.clientHeight,
        listScrollHeight: (eventsEl.querySelector('ul') || eventsEl).scrollHeight,
        scrollHeight: eventsEl.scrollHeight,
        scrollTop: eventsEl.scrollTop,
        declaredCount: eventsDeclared,
        visibleRows: eventsVisible,
        firstRowHeight: eventsFirstRowHeight,
        padHeights: eventsPads
      };
    }
    var filterEl = document.querySelector('[data-error-filter]');
    if (filterEl) {
      errorFacts.filter = (filterEl.textContent || '').replace(/\s+/g, ' ').trim();
    }
  }
  facts.error = errorFacts;
  /* 改动标签页（Round N / N2）：文件列表滚动几何与展开区可达性的原始事实。
     锚点全是组件自带的 data-changes-* 稳定属性（同 data-probe 先例，不碰
     CSS Module 哈希类名）；不在改动视图时 view 为 null，判定在脚本。
     文件行的行高账由 li[data-changes-file] 承载（N1 教训：button 拉伸填满、
     li 对账），展开区是紧跟其后的变高 li，高度单列一项。 */
  var changesFacts = { view: null, files: null, records: null, empty: null };
  var changesView = document.querySelector('[data-changes-view]');
  if (changesView) {
    changesFacts.view = true;
    var filesEl = changesView.querySelector('[data-changes-files]');
    if (filesEl) {
      var fileItems = filesEl.querySelectorAll('ul > li[data-changes-file]');
      var filesVisible = 0;
      var filesFirstRowHeight = null;
      var filesPads = [];
      /* 声明行数读面板头部的聚合读数（“N 个文件”）。锚点是聚合 span 自己的
         data-changes-aggregate——**不要**用 closest('section') 借面板结构找：
         closest 走的是祖先链，而本视图的 Panel section 是 data-changes-view 的
         子元素，方向相反（真机抓到过一次 declaredCount 恒 null）。 */
      var aggregateEl = changesView.querySelector('[data-changes-aggregate]');
      var filesDeclared = null;
      var filesMatch = aggregateEl
        ? (aggregateEl.textContent || '').match(/(\d+)\s*个文件/)
        : null;
      if (filesMatch) filesDeclared = parseInt(filesMatch[1], 10);
      for (var f = 0; f < fileItems.length; f++) {
        var fileItem = fileItems[f];
        if (fileItem.getAttribute('aria-hidden') === 'true') {
          filesPads.push(fileItem.offsetHeight);
        } else {
          filesVisible += 1;
          if (filesFirstRowHeight === null) {
            filesFirstRowHeight = fileItem.getBoundingClientRect().height;
          }
        }
      }
      changesFacts.files = {
        clientHeight: filesEl.clientHeight,
        listScrollHeight: (filesEl.querySelector('ul') || filesEl).scrollHeight,
        scrollHeight: filesEl.scrollHeight,
        scrollTop: filesEl.scrollTop,
        declaredCount: filesDeclared,
        visibleRows: filesVisible,
        firstRowHeight: filesFirstRowHeight,
        padHeights: filesPads
      };
      var recordsEl = filesEl.querySelector('[data-changes-records]');
      if (recordsEl) {
        changesFacts.records = {
          height: Math.round(recordsEl.getBoundingClientRect().height),
          rows: recordsEl.querySelectorAll('[data-changes-record]').length
        };
      }
    }
    if (changesView.querySelector('[data-changes-empty]')) {
      changesFacts.empty = true;
    }
  }
  facts.changes = changesFacts;
  /* 工具与 skill 面板（Round N / N3）：四栏清单与下钻区的原始事实。锚点是
     组件自带的 data-tool-census-* 稳定属性（同 data-error-* 先例，不碰
     CSS Module 哈希类名）；不在用量档时 view 为 null，判定在脚本。
     各栏清单的行高账由 li 承载（N1/N2 教训：button 拉伸填满、li 对账）。 */
  var censusFacts = { view: null, total: null, lists: [], sessions: null, filter: null };
  var censusView = document.querySelector('[data-tool-census]');
  if (censusView) {
    censusFacts.view = true;
    var censusTotalEl = censusView.querySelector('[data-tool-census-total]');
    if (censusTotalEl) {
      censusFacts.total = (censusTotalEl.textContent || '').replace(/\s+/g, ' ').trim();
    }
    /* 四栏各自的清单：行数（非 aria-hidden 的 li）、首行高、<ul> 自己的
       scrollHeight（对账不掺容器内边距——dropped-list 的教训）。 */
    var censusLists = censusView.querySelectorAll('[data-tool-census-list]');
    for (var cl = 0; cl < censusLists.length; cl++) {
      var listEl = censusLists[cl];
      var listItems = listEl.children;
      var listVisible = 0;
      var listFirstRowHeight = null;
      for (var li = 0; li < listItems.length; li++) {
        if (listItems[li].getAttribute('aria-hidden') === 'true') continue;
        listVisible += 1;
        if (listFirstRowHeight === null) {
          listFirstRowHeight = listItems[li].getBoundingClientRect().height;
        }
      }
      censusFacts.lists.push({
        label: listEl.getAttribute('aria-label') || '',
        rows: listVisible,
        firstRowHeight: listFirstRowHeight,
        listScrollHeight: listEl.scrollHeight
      });
    }
    /* 下钻区（点选行之后才在场）：会话行数与首行高、过滤态（属性值 = 选中行
       的 label——「点击没落地」与「落地了但列表没渲染」靠它分辨）。 */
    var censusSessionsEl = censusView.querySelector('[data-tool-census-sessions]');
    if (censusSessionsEl) {
      var sessionItems = censusSessionsEl.children;
      var sessionFirstRowHeight = null;
      if (sessionItems.length > 0) {
        sessionFirstRowHeight = sessionItems[0].getBoundingClientRect().height;
      }
      censusFacts.sessions = {
        rows: sessionItems.length,
        firstRowHeight: sessionFirstRowHeight,
        listScrollHeight: censusSessionsEl.scrollHeight
      };
    }
    var censusFilterEl = censusView.querySelector('[data-tool-census-filter]');
    if (censusFilterEl) {
      censusFacts.filter = censusFilterEl.getAttribute('data-tool-census-filter');
    }
  }
  facts.toolCensus = censusFacts;

  /* 按会话的配额归因（Round R / #151）：5 小时窗口卡里的「本窗口消耗 Top
     会话」。锚点全是组件自带的 `data-probe`（理由同 Gauge：可见文案会随数据
     变，靠它匹配等于把断言绑在夹具上）。只收集事实，阈值与判定在脚本里：
     - 真列表对账要 listScrollHeight ≈ Σ行高（+ 余项行高），防「看起来 5 行、
       实际容器对不上」的假列表；
     - 点行开会话要拿点击**之前**那一行的标题（脚本记住，点击后拿 analyzer 的
       当前会话标题比对）。
     余项行（`其余 N 个会话`）不是会话：单独一项 restText，且它不在
     attribution-row 里，所以 rowCount 永远只数真实会话。 */
  var attributionFacts = null;
  var attributionPanel = document.querySelector('[data-probe="attribution-panel"]');
  if (attributionPanel) {
    var attributionRows = attributionPanel.querySelectorAll('[data-probe="attribution-row"]');
    var rowHeights = [];
    var rowTitles = [];
    var rowTokens = [];
    var rowPcts = [];
    var barFillWidths = [];
    var barTrackWidths = [];
    for (var a = 0; a < attributionRows.length; a++) {
      var rowEl = attributionRows[a];
      rowHeights.push(rowEl.getBoundingClientRect().height);
      var titleEl = rowEl.querySelector('[data-probe="attribution-row-title"]');
      var tokenEl = rowEl.querySelector('[data-probe="attribution-row-token"]');
      var pctEl = rowEl.querySelector('[data-probe="attribution-row-pct"]');
      var barEl = rowEl.querySelector('[data-probe="attribution-row-bar"]');
      rowTitles.push(titleEl ? (titleEl.textContent || '').trim() : '');
      rowTokens.push(tokenEl ? (tokenEl.textContent || '').trim() : '');
      rowPcts.push(pctEl ? (pctEl.textContent || '').trim() : '');
      /* 条宽的事实分两半：填充宽度与轨道宽度。占比条是固定像素轨道，
         填充按占比算——脚本判「填充 ≤ 轨道」与「非零占比至少有最小宽度」，
         不去反推百分比（那是另一套数字）。 */
      barFillWidths.push(barEl ? barEl.getBoundingClientRect().width : null);
      var barTrack = barEl && barEl.parentElement ? barEl.parentElement : null;
      barTrackWidths.push(barTrack ? barTrack.getBoundingClientRect().width : null);
    }
    var attributionList = attributionPanel.querySelector('[data-probe="attribution-list"]');
    var restEl = attributionPanel.querySelector('[data-probe="attribution-rest"]');
    var footnoteEl = attributionPanel.querySelector('[data-probe="attribution-footnote"]');
    attributionFacts = {
      panelRect: rectOf(attributionPanel),
      listScrollHeight: attributionList ? attributionList.scrollHeight : null,
      listClientHeight: attributionList ? attributionList.clientHeight : null,
      rowCount: attributionRows.length,
      rowHeights: rowHeights,
      titles: rowTitles,
      tokens: rowTokens,
      pcts: rowPcts,
      barFillWidths: barFillWidths,
      barTrackWidths: barTrackWidths,
      hasRest: !!restEl,
      restRect: restEl ? rectOf(restEl) : null,
      restText: restEl ? (restEl.textContent || '').replace(/\s+/g, ' ').trim() : '',
      footnoteText: footnoteEl ? (footnoteEl.textContent || '').replace(/\s+/g, ' ').trim() : '',
      footnoteTitle: footnoteEl ? footnoteEl.getAttribute('title') || '' : ''
    };
  }
  facts.attribution = attributionFacts;

  /* 消耗日历（Round V / #187）：网格几何与展开区的原始事实。锚点是组件自带
     的 data-usage-calendar / data-probe / data-calendar-sessions 稳定属性
     （同 data-tool-census 先例，不碰 CSS Module 哈希类名）；不在用量档时
     view 为 null，判定在脚本。容器滚动几何（overflowX / scrollWidth vs
     clientWidth）走 boxOf——「滚动收在日历容器内部、文档与 main 不溢出」
     的事实来源。 */
  var calendarFacts = { view: null, dayCount: null, todayCount: null, container: null, sessions: null, dayReview: null, insights: null };
  var calendarEl = document.querySelector('[data-usage-calendar]');
  if (calendarEl) {
    calendarFacts.view = true;
    /* 365 是全链条的几何锚（53 列恒等式）：pad 不挂 probe，今天标记挂 td
       不挤占这个计数。 */
    calendarFacts.dayCount = calendarEl.querySelectorAll('[data-probe="calendar-day"]').length;
    calendarFacts.todayCount = document.querySelectorAll('[data-probe="calendar-today"]').length;
    calendarFacts.container = boxOf(calendarEl);
    var calendarSessionsEl = document.querySelector('[data-calendar-sessions]');
    if (calendarSessionsEl) {
      /* 「展开区行数」= 时间线里的会话行。V2 起展开区还含项目色键，色键也是
         `<li>` 列表——直接数 section 下的 `li` 会把色键项算成会话。收窄到时间线
         列表（`day-timeline-list`），门禁才拿得到真正的「会话行数」；时间线不在
         （防御态）时退回整段，取的是 0。 */
      var calendarDayRowsEl = calendarSessionsEl.querySelector('[data-probe="day-timeline-list"]');
      var calendarRowsEl = calendarDayRowsEl || calendarSessionsEl;
      calendarFacts.sessions = {
        rect: rectOf(calendarSessionsEl),
        rows: calendarRowsEl.querySelectorAll('li').length
      };
    }
    /* 「一日回望」（Round V2 / #192）：展开区里的日摘要行与 24h 时间线。只收集
       事实，判定在脚本：
       - 摘要行在不在、有没有读数（textContent）；
       - 时间线 rect 与每条横条的 rect + 会话键（点击 / 归属判定要用）；
       - 组件声明的会话数（容器上的 `data-session-count`）——门禁把它与**实测
         条数**对账，声明与实车不一致就红（谁在「声明」上撒谎都过不去）。 */
    var daySummaryEl = document.querySelector('[data-probe="day-summary"]');
    var timelineEl = document.querySelector('[data-probe="day-timeline"]');
    if (daySummaryEl || timelineEl) {
      var barNodes = document.querySelectorAll('[data-probe="day-timeline-bar"]');
      var barFacts = [];
      for (var b = 0; b < barNodes.length; b++) {
        barFacts.push({
          rect: rectOf(barNodes[b]),
          sessionPath: barNodes[b].getAttribute('data-session-path') || '',
          label: barNodes[b].getAttribute('aria-label') || ''
        });
      }
      var declared = timelineEl ? Number(timelineEl.getAttribute('data-session-count')) : NaN;
      calendarFacts.dayReview = {
        summary: daySummaryEl
          ? {
              rect: rectOf(daySummaryEl),
              text: (daySummaryEl.textContent || '').replace(/\s+/g, ' ').trim()
            }
          : null,
        timeline: timelineEl
          ? {
              rect: rectOf(timelineEl),
              bars: barFacts.length,
              declaredSessions: isNaN(declared) ? null : declared
            }
          : null,
        bars: barFacts
      };
    }
    /* 「一年洞察」（Round V3 / #199）：图例之下的六句实事。只收集事实，判定在
       脚本：容器在否、键序列（data-insight-key，Issue 契约顺序）与压平文本。
       空 0 年的空态句不带键 → keys 为空数组、count 为 0，脚本按布景判定。 */
    var insightsEl = document.querySelector('[data-probe="calendar-insights"]');
    if (insightsEl) {
      var insightKeyNodes = insightsEl.querySelectorAll('[data-insight-key]');
      var insightKeys = [];
      for (var ik = 0; ik < insightKeyNodes.length; ik++) {
        insightKeys.push(insightKeyNodes[ik].getAttribute('data-insight-key') || '');
      }
      calendarFacts.insights = {
        present: true,
        count: insightKeyNodes.length,
        keys: insightKeys,
        text: (insightsEl.textContent || '').replace(/\s+/g, ' ').trim()
      };
    }
  }
  facts.calendar = calendarFacts;

  /* 会话分析页当前会话的标题：点归因行之后要拿它跟点击前那一行的标题比对，
     证「点行真的打开了那个会话」，而不是「页面没崩」。锚点是会话头的
     `header[aria-label="会话信息"]` 里那枚 title 元素。 */
  var analyzerHeader = document.querySelector('header[aria-label="会话信息"]');
  var analyzerTitleEl = analyzerHeader ? analyzerHeader.querySelector('strong[title]') : null;
  facts.analyzer = {
    sessionTitle: analyzerTitleEl ? (analyzerTitleEl.textContent || '').trim() : null
  };

  /* 用量快照导出入口（Round S / #149）。只收集「按钮在不在、可不可点、在哪」
     这三件事，**不去点它**：点了会弹系统保存对话框，探针驱动不了那一步
     （同归档导入的限制）。内容层的证据在单测与 e2e（共用同一个生成器）。
     锚点是按钮自己的 data-probe——可访问名会随文案改，靠它匹配会静默失配。 */
  var snapshotEl = document.querySelector('[data-probe="usage-snapshot-export"]');
  var usageProgressEl = document.querySelector('[data-probe="usage-progress"]');
  facts.snapshot_export = snapshotEl
    ? {
        rect: rectOf(snapshotEl),
        /* 同一行的扫描进度文本：门禁要判「按钮与它不重叠」（窄视口允许换行，
           但不能压字）。两条事实一起给，判定留给脚本。 */
        progressRect: usageProgressEl ? rectOf(usageProgressEl) : null,
        label: snapshotEl.getAttribute('aria-label') || '',
        text: (snapshotEl.textContent || '').replace(/\s+/g, ' ').trim(),
        disabled: snapshotEl.disabled === true
      }
    : null;

  /* 「实时脉搏」（Issue #203 / Round W）：根节点、四态、浮窗细头、5 小时读数、
     60 分钟速率柱、活跃会话行与字形高度、上下文曲线。锚点一律是组件自带的
     `data-probe` 稳定属性（同 attribution / calendar 先例，不碰 CSS Module
     哈希类名），并且**禁裸标签选择器**——「同屏唯一 table」那一课（消耗日历的
     表被 `querySelector('table')` 误捕，门禁红了 9 步）就是这么欠下的。
     不在脉搏视图时 page 为 false，判定在脚本里。 */
  var pulseFacts = {
    page: false,
    state: null,
    head_present: false,
    container: null,
    float_head: { present: false, drag_region: null },
    window_readouts: { count: 0, keys: [] },
    rate_bars: { count: 0, partial: 0 },
    session_rows: { count: 0, recencies: [] },
    session_ticks: [],
    context_curve: { present: false, sample_count: null, band: false, cliffs: 0 }
  };
  var pulsePage = document.querySelector("[data-probe='pulse-page']");
  if (pulsePage) {
    pulseFacts.page = true;
    /* 四态写在根节点的一个属性上（loading / empty / error / fresh / stale）：
       四种状态各自找元素会把判定绑到结构上。 */
    pulseFacts.state = pulsePage.getAttribute('data-state');
    /* 非浮窗页头在不在——浮窗态收起整条顶栏换细头，这两条事实互为对照。 */
    pulseFacts.head_present = !!document.querySelector("[data-probe='pulse-head']");
    /* 横向不溢出量的是**根节点自己**的滚动几何：外壳的 `overflow: hidden` 会把
       内容溢出藏起来，量文档量不到它（同「量 main 而不量 document」的教训）。 */
    pulseFacts.container = boxOf(pulsePage);
    /* 浮窗细头：无边框窗口里唯一的拖动通道。属性在不在、值是不是 `"deep"`
       都是**声明层事实**——Tauri 2.12 的裸属性是 self-only 语义，只有 `"deep"`
       才让子元素上的点击冒泡成拖动。拖动本身探针驱动不了（只能人工拖一次），
       但「声明写对了」这一层必须由门禁守住。 */
    var floatHead = document.querySelector("[data-probe='pulse-float-head']");
    if (floatHead) {
      pulseFacts.float_head = {
        present: true,
        drag_region: floatHead.getAttribute('data-tauri-drag-region')
      };
    }
    /* 5 小时窗口的五个读数：个数与 `data-readout` 键序。个数恒为 5、键序是
       Issue 契约顺序——比断言某一格的数值稳得多（数值随夹具与运行时刻漂）。 */
    var readoutNodes = document.querySelectorAll("[data-probe='pulse-window-readout']");
    var readoutKeys = [];
    for (var pr = 0; pr < readoutNodes.length; pr++) {
      readoutKeys.push(readoutNodes[pr].getAttribute('data-readout') || '');
    }
    pulseFacts.window_readouts = { count: readoutNodes.length, keys: readoutKeys };
    /* 速率柱：计数恒 60（60 分钟每分钟一根），其中 `data-partial="true"` 恰好
       1 根（进行中的这一分钟）。空桶也画短痕，所以计数不随夹具数据变。 */
    pulseFacts.rate_bars = {
      count: document.querySelectorAll("[data-probe='pulse-rate-bar']").length,
      partial: document.querySelectorAll("[data-probe='pulse-rate-bar'][data-partial='true']").length
    };
    /* 活跃会话行：每行的 `data-recency`（live / recent / idle）与行首字形高度。
       高度分两条给，判定留给脚本：
       - `rectHeight` 是 `getBoundingClientRect().height`，live 档的心跳跑
         `transform: scale()`（1 → 1.22 → 1.16），量到的是**取数那一刻**的
         缩放后高度（12 → 约 14.6），会随动画相位变；
       - `offsetHeight` 是布局高度，不含 transform，三档恒为 12 / 8 / 4。
       三档几何阶梯的账用 `offsetHeight` 对，`rectHeight` 是「心跳真的在动」
       的旁证。 */
    var rowNodes = document.querySelectorAll("[data-probe='pulse-session-row']");
    var recencies = [];
    for (var prow = 0; prow < rowNodes.length; prow++) {
      var recency = rowNodes[prow].getAttribute('data-recency') || '';
      recencies.push(recency);
      var tick = rowNodes[prow].querySelector("[data-probe='pulse-session-tick']");
      pulseFacts.session_ticks.push({
        recency: recency,
        rectHeight: tick ? tick.getBoundingClientRect().height : null,
        offsetHeight: tick ? tick.offsetHeight : null
      });
    }
    pulseFacts.session_rows = { count: rowNodes.length, recencies: recencies };
    /* 上下文曲线：在场 + `data-sample-count`（实际样本数，≤40）+ 参考带在不在
       + 断崖计数（`data-probe='pulse-context-cliff'`，一次压缩一条竖线）。
       参考带只在自动压缩 ≥ 3 次时画、断崖数 = 样本窗口内的压缩次数，而夹具的
       live 档给了 3 次——三条一起对账，说明「视图真的拿到了夹具那几次压缩」，
       不只是画了张空图。计数是事实，阈值与判定在脚本里。 */
    var pulseName = document.querySelector("[class*='sessionName']");
    pulseFacts.latest_title = pulseName ? pulseName.textContent.trim() : null;
    var pulseNote = document.querySelector("[data-probe='pulse-context-note']");
    pulseFacts.context_note = pulseNote ? pulseNote.textContent.trim() : null;
    var contextCurve = document.querySelector("[data-probe='pulse-context-curve']");
    if (contextCurve) {
      pulseFacts.context_curve = {
        present: true,
        sample_count: contextCurve.getAttribute('data-sample-count'),
        band: !!document.querySelector("[data-probe='pulse-context-band']"),
        cliffs: document.querySelectorAll("[data-probe='pulse-context-cliff']").length
      };
    }
  }
  facts.pulse = pulseFacts;

  /* 「里程碑」（Issue #214 / Round Y）：用量页的第三档子视图。锚点一律用组件
     自带的 `data-probe` 稳定属性（同脉搏 / 归因 / 日历先例），**禁裸标签选择器**
     ——「同屏唯一 table」那一课（消耗日历的表被 `querySelector('table')` 误捕，
     门禁红了 9 步）就是这么欠下的。事实只收集，阈值与判定在脚本里：
     - 根节点（milestones-view）自己的滚动几何：外壳的 overflow 会把内容溢出藏
       起来，量文档量不到它（同脉搏根节点的教训）；
     - 三组（milestones-group 的 data-group）各自的卡片数——组缺席时该键为 0；
     - 每枚卡片（milestone-card）的 state / 名称 / 值 / 填充条数 / 填充宽度：
       「未达成卡片里取不到 fill」（§15.2 裁决）是一条**布尔几何事实**，数的是
       `querySelectorAll` 的条数，不是 offsetWidth——宽度为 0 的元素与根本不在的
       元素不是一回事；
     - 距离条轨道（milestone-track）与 HC 档的 1px 描边。 */
  var milestoneFacts = {
    page: false,
    empty: false,
    container: null,
    /* 界面当前对比度档：HC 下轨道外壳才该带描边，判定留给脚本。 */
    contrast: document.documentElement.getAttribute('data-contrast') || '',
    scope_present: false,
    groups: { firsts: 0, tiers: 0, records: 0 },
    cards: [],
    tracks: { count: 0, ringed: 0 },
    fallbacks: document.querySelectorAll("[data-probe='milestones-fallback']").length,
    gap_notes: document.querySelectorAll("[data-probe='milestones-gap-note']").length
  };
  var milestoneView = document.querySelector("[data-probe='milestones-view']");
  if (milestoneView) {
    milestoneFacts.page = true;
    /* 空态（report.empty）与三组是两条互斥的形态：空态只有一条事实行。 */
    milestoneFacts.empty = !!document.querySelector("[data-probe='milestones-empty']");
    milestoneFacts.container = boxOf(milestoneView);
    milestoneFacts.scope_present = !!document.querySelector("[data-probe='milestones-scope']");
    var milestoneGroupNames = ['firsts', 'tiers', 'records'];
    for (var mg = 0; mg < milestoneGroupNames.length; mg++) {
      var milestoneGroup = document.querySelector(
        "[data-probe='milestones-group'][data-group='" + milestoneGroupNames[mg] + "']"
      );
      milestoneFacts.groups[milestoneGroupNames[mg]] = milestoneGroup
        ? milestoneGroup.querySelectorAll("[data-probe='milestone-card']").length
        : 0;
    }
    var milestoneCardNodes = document.querySelectorAll("[data-probe='milestone-card']");
    for (var mc = 0; mc < milestoneCardNodes.length; mc++) {
      var milestoneCard = milestoneCardNodes[mc];
      var milestoneFill = milestoneCard.querySelector("[data-probe='milestone-fill']");
      var milestoneName = milestoneCard.querySelector("[data-probe='milestone-name']");
      var milestoneValue = milestoneCard.querySelector("[data-probe='milestone-value']");
      var milestoneTrack = milestoneCard.querySelector("[data-probe='milestone-track']");
      if (milestoneTrack) {
        milestoneFacts.tracks.count += 1;
        /* HC 档的 1px 描边挂在外壳（.trackShell）的 box-shadow 上：轨道自己是
           overflow: hidden 的圆角盒，inset 阴影会被填充盖住下半条，所以读父级的
           计算样式。非 HC 档期望 "none"。 */
        if (milestoneTrack.parentElement
            && getComputedStyle(milestoneTrack.parentElement).boxShadow !== 'none') {
          milestoneFacts.tracks.ringed += 1;
        }
      }
      milestoneFacts.cards.push({
        key: milestoneCard.getAttribute('data-milestone') || '',
        state: milestoneCard.getAttribute('data-state') || '',
        /* 距离条只挂在阶梯卡上：锚点类（首次 / 记录）没有轨道，也就没有填充。
           判别「这枚是不是阶梯卡」只能靠这条事实——state 都是 reached，
           锚点卡的 reached 不表示「有墨迹」。 */
        track: !!milestoneTrack,
        name: milestoneName
          ? (milestoneName.textContent || '').replace(/\s+/g, ' ').trim()
          : null,
        value: milestoneValue
          ? (milestoneValue.textContent || '').replace(/\s+/g, ' ').trim()
          : null,
        fills: milestoneCard.querySelectorAll("[data-probe='milestone-fill']").length,
        fillWidth: milestoneFill ? milestoneFill.offsetWidth : null
      });
    }
  }
  facts.milestones = milestoneFacts;

  /* 「监控台」（Issue #225 / Round Z）：根节点与四态、四枚读数键序、24 小时
     三态、项目行、事件行与可见详情。锚点一律用组件自带的 data-probe 稳定
     属性，**禁裸标签选择器**（同脉搏 / 里程碑的教训）。

     future 小时的填充必须单独数：`data-phase='future'` 的槽里若出现
     `monitor-console-hour-fill`，界面就把「尚未发生」画成了「没有发生」。
     这是一条布尔几何事实，不能拿未来柱高为 0 代替。 */
  var monitorConsoleFacts = {
    page: false,
    state: null,
    container: null,
    readouts: { count: 0, keys: [] },
    hours: {
      count: 0,
      slots: 0,
      phases: { past: 0, current: 0, future: 0 },
      future_fills: 0
    },
    projects: { count: 0 },
    events: { count: 0, nonempty: 0 }
  };
  var monitorConsolePage = document.querySelector("[data-probe='monitor-console-page']");
  if (monitorConsolePage) {
    monitorConsoleFacts.page = true;
    monitorConsoleFacts.state = monitorConsolePage.getAttribute('data-state');
    monitorConsoleFacts.container = boxOf(monitorConsolePage);

    var consoleReadoutNodes =
      document.querySelectorAll("[data-probe='monitor-console-readout']");
    var consoleReadoutKeys = [];
    for (var cr = 0; cr < consoleReadoutNodes.length; cr++) {
      consoleReadoutKeys.push(consoleReadoutNodes[cr].getAttribute('data-readout') || '');
    }
    monitorConsoleFacts.readouts = {
      count: consoleReadoutNodes.length,
      keys: consoleReadoutKeys
    };

    var consoleHourNodes =
      document.querySelectorAll("[data-probe='monitor-console-hour']");
    for (var ch = 0; ch < consoleHourNodes.length; ch++) {
      var phase = consoleHourNodes[ch].getAttribute('data-phase') || '';
      if (phase === 'past' || phase === 'current' || phase === 'future') {
        monitorConsoleFacts.hours.phases[phase] += 1;
      }
    }
    monitorConsoleFacts.hours.count = consoleHourNodes.length;
    monitorConsoleFacts.hours.slots =
      document.querySelectorAll("[data-probe='monitor-console-hour-slot']").length;
    var futureHourFillSelector =
      "[data-probe='monitor-console-hour'][data-phase='future'] [data-probe='monitor-console-hour-fill']";
    monitorConsoleFacts.hours.future_fills =
      document.querySelectorAll(futureHourFillSelector).length;

    monitorConsoleFacts.projects.count =
      document.querySelectorAll("[data-probe='monitor-console-project-row']").length;

    var consoleEventNodes =
      document.querySelectorAll("[data-probe='monitor-console-event-row']");
    var consoleEventNonempty = 0;
    for (var ce = 0; ce < consoleEventNodes.length; ce++) {
      var eventText = (
        consoleEventNodes[ce].innerText ||
        consoleEventNodes[ce].textContent ||
        ''
      ).replace(/\s+/g, ' ').trim();
      if (eventText.length > 0) consoleEventNonempty += 1;
    }
    monitorConsoleFacts.events = {
      count: consoleEventNodes.length,
      nonempty: consoleEventNonempty
    };
  }
  facts.monitor_console = monitorConsoleFacts;

  /* 「会话重放」（Round AA）：设计 §13.1 的锚点只收**事实**——根 / 舞台 / 读数 /
     胶片带 / 轨道 / 播放头 / 走带的矩形与滚动几何，轨道自己的 aria 读数，舞台
     与卡片文案。阈值与判定一律留在 scripts/gui-test.sh：应用侧不写「应该是
     多少」，否则规格一改，探针和实现会一起错（同脉搏 / 里程碑 / 监控台）。 */
  var replayFacts = {
    present: false,
    root: null,
    stage: null,
    stage_text: '',
    stage_kind: null,
    stage_error: false,
    reads: null,
    reads_text: '',
    film: null,
    film_text: '',
    lane: null,
    lane_value: null,
    lane_text: null,
    lane_min: null,
    lane_max: null,
    head: null,
    transport: null,
    play_label: '',
    gap_switch: null,
    speed_text: '',
    marks: [],
    nested_scrollers: 0,
    documentBox: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight
    }
  };
  var replayRoot = document.querySelector("[data-probe='replay-root']");
  if (replayRoot) {
    replayFacts.present = true;
    replayFacts.root = {
      rect: rectOf(replayRoot),
      scrollWidth: replayRoot.scrollWidth,
      clientWidth: replayRoot.clientWidth,
      scrollHeight: replayRoot.scrollHeight,
      clientHeight: replayRoot.clientHeight,
      overflowY: getComputedStyle(replayRoot).overflowY
    };

    var replayStage = replayRoot.querySelector("[data-probe='replay-stage']");
    if (replayStage) {
      replayFacts.stage = rectOf(replayStage);
      replayFacts.stage_text = (replayStage.innerText || '')
        .replace(/\s+/g, ' ').trim();
      var replayErrorCard = replayStage.querySelector("[data-error='true']");
      replayFacts.stage_error = !!replayErrorCard;
      /* 舞台卡片按 kind 上色，卡片本体带 data-kind：拿到它就能把「舞台真的
         渲染了这类事件」作为文案之外的第二条证据。 */
      var replayCard = replayStage.querySelector("[data-kind]");
      if (replayCard) {
        replayFacts.stage_kind = replayCard.getAttribute('data-kind');
      }
    }

    var replayReads = replayRoot.querySelector("[data-probe='replay-reads']");
    if (replayReads) {
      replayFacts.reads = rectOf(replayReads);
      replayFacts.reads_text = (replayReads.innerText || '')
        .replace(/\s+/g, ' ').trim();
    }

    var replayFilm = replayRoot.querySelector("[data-probe='replay-film']");
    if (replayFilm) {
      replayFacts.film = rectOf(replayFilm);
      replayFacts.film_text = (replayFilm.innerText || '')
        .replace(/\s+/g, ' ').trim();
    }

    var replayLane = replayRoot.querySelector("[data-probe='replay-lane']");
    if (replayLane) {
      replayFacts.lane = rectOf(replayLane);
      replayFacts.lane_value = replayLane.getAttribute('aria-valuenow');
      replayFacts.lane_text = replayLane.getAttribute('aria-valuetext');
      replayFacts.lane_min = replayLane.getAttribute('aria-valuemin');
      replayFacts.lane_max = replayLane.getAttribute('aria-valuemax');
    }

    var replayHead = replayRoot.querySelector("[data-probe='replay-head']");
    if (replayHead) {
      replayFacts.head = rectOf(replayHead);
    }

    var replayTransport = replayRoot.querySelector("[data-probe='replay-transport']");
    if (replayTransport) {
      replayFacts.transport = rectOf(replayTransport);
      var replayPlay = replayTransport.querySelector(
        "button[aria-label='播放'], button[aria-label='暂停']"
      );
      if (replayPlay) {
        replayFacts.play_label = replayPlay.getAttribute('aria-label') || '';
      }
      var replayGap = replayTransport.querySelector("button[aria-pressed]");
      if (replayGap) {
        replayFacts.gap_switch = {
          text: (replayGap.innerText || '').replace(/\s+/g, ' ').trim(),
          pressed: replayGap.getAttribute('aria-pressed')
        };
      }
      var replaySpeed = replayTransport.querySelector("[class*='speed']");
      if (replaySpeed) {
        replayFacts.speed_text = (replaySpeed.innerText || '')
          .replace(/\s+/g, ' ').trim();
      }
    }

    /* 胶片带里的跃点是真按钮，可访问名形如「首次失败 · LLM+工具 · command failed」。
       只收带「 · 」的名字：走带那几枚图标按钮也叫 button[aria-label]，但名字里
       没有分隔点，混进来会让「跃点数」虚高。 */
    var replayMarkNodes = replayFilm
      ? replayFilm.querySelectorAll("button[aria-label]")
      : [];
    for (var rm = 0; rm < replayMarkNodes.length; rm++) {
      var replayMarkLabel = replayMarkNodes[rm].getAttribute('aria-label') || '';
      if (replayMarkLabel.indexOf(' \u00b7 ') < 0) continue;
      replayFacts.marks.push({
        label: replayMarkLabel,
        rect: rectOf(replayMarkNodes[rm])
      });
    }

    /* 第二条竖向滚动轴：文档本身不滚（main 才滚），重放内部也不该有 auto/scroll
       容器。这里只数事实，判定在脚本。 */
    var replayAll = replayRoot.querySelectorAll('*');
    for (var rs = 0; rs < replayAll.length; rs++) {
      var replayOverflowY = getComputedStyle(replayAll[rs]).overflowY;
      if (replayOverflowY === 'auto' || replayOverflowY === 'scroll') {
        replayFacts.nested_scrollers += 1;
      }
    }
  }
  facts.replay = replayFacts;

  /* Round CC（用量页 10 个新功能）：只收事实——周战报四行读数、流向图节点/边、
     擂台、项目卡片、时钟扇区、预报行文案、错误聚类行、图钉组、命令面板、大屏
     属性。阈值与判定在 scripts/gui-test.sh；这里不写「应该是多少」。 */
  var roundCC = {
    present: false,
    digest_rows: [],
    digest_copy: !!document.querySelector("[data-probe='digest-copy']"),
    flow: null,
    arena: null,
    cards: null,
    clock: null,
    forecast: null,
    clusters: null,
    pins: null,
    palette: { present: !!document.querySelector("[data-probe='palette-root']") },
    kiosk: document.documentElement.getAttribute('data-kiosk')
  };
  var digestRoot = document.querySelector("[data-probe='digest-root']");
  if (digestRoot) {
    roundCC.present = true;
    var digestRows = digestRoot.querySelectorAll("[data-probe='digest-row']");
    for (var dr = 0; dr < digestRows.length; dr++) {
      var digestCells = digestRows[dr].querySelectorAll('th, td');
      roundCC.digest_rows.push({
        label: digestCells[0] ? digestCells[0].innerText.trim() : '',
        now: digestCells[1] ? digestCells[1].innerText.trim() : '',
        prev: digestCells[2] ? digestCells[2].innerText.trim() : '',
        delta: digestCells[3] ? digestCells[3].innerText.trim() : '',
        delta_aria: digestCells[3] ? digestCells[3].getAttribute('aria-label') : null
      });
    }
  }
  var flowRoot = document.querySelector("[data-probe='flow-root']");
  if (flowRoot) {
    var flowPanel = flowRoot.parentElement;
    var flowImg = flowPanel ? flowPanel.querySelector("svg[role='img']") : null;
    roundCC.flow = {
      present: true,
      nodes: flowRoot.querySelectorAll('[data-flow-node]').length,
      links: flowRoot.querySelectorAll('[data-flow-link]').length,
      aria: flowImg ? flowImg.getAttribute('aria-label') : null
    };
  }
  var arenaRoot = document.querySelector("[data-probe='arena-root']");
  if (arenaRoot) {
    roundCC.arena = {
      present: true,
      bars: arenaRoot.querySelectorAll('[data-probe="arena-bar"]').length
    };
  }
  var cardsRoot = document.querySelector("[data-probe='cards-root']");
  if (cardsRoot) {
    var cardNodes = cardsRoot.querySelectorAll("[data-probe='card-item']");
    var cardLabels = [];
    for (var ci = 0; ci < cardNodes.length && ci < 8; ci++) {
      cardLabels.push(cardNodes[ci].getAttribute('aria-label') || '');
    }
    roundCC.cards = { present: true, count: cardNodes.length, labels: cardLabels };
  }
  var clockRoot = document.querySelector("[data-probe='clock-root']");
  if (clockRoot) {
    roundCC.clock = {
      present: true,
      sectors: clockRoot.querySelectorAll('[data-clock-hour]').length
    };
  }
  var forecastRow = document.querySelector("[data-probe='forecast-row']");
  if (forecastRow) {
    roundCC.forecast = { present: true, text: forecastRow.innerText.trim() };
  }
  var clustersRoot = document.querySelector("[data-probe='clusters-root']");
  if (clustersRoot) {
    var clusterRows = clustersRoot.querySelectorAll("[data-probe='cluster-row']");
    var clusterTexts = [];
    for (var cr = 0; cr < clusterRows.length && cr < 8; cr++) {
      clusterTexts.push(clusterRows[cr].innerText.trim());
    }
    roundCC.clusters = { present: true, count: clusterRows.length, rows: clusterTexts };
  }
  var pinnedToggles = document.querySelectorAll("[data-probe='pin-toggle'][aria-pressed='true']");
  var pinnedGroup = false;
  var sessionList = document.querySelector('[aria-label="会话列表"]');
  if (sessionList) {
    var groupNodes = sessionList.querySelectorAll('[role="button"]');
    for (var gi = 0; gi < groupNodes.length; gi++) {
      var groupText = (groupNodes[gi].innerText || '').trim();
      if (groupText.indexOf('置顶') === 0) { pinnedGroup = true; break; }
    }
  }
  roundCC.pins = { pinned: pinnedToggles.length, group: pinnedGroup };
  facts.roundcc = roundCC;



  /* 「会话账单」（Round BB）：设计 §13.1 的锚点只收**事实**——收据四行 / 合计 /
     按模型 / 缓存经济学 / 最贵五次 的文本与矩形，金额列的右沿，卡内与页面的
     滚动几何，当前选中的分析器标签，以及跳回日志后高亮那一行的文本。阈值与
     判定一律留在 scripts/gui-test.sh（同 facts.replay / 脉搏 / 里程碑）。 */
  var costFacts = {
    present: false,
    root: null,
    scroll: null,
    receipt: null,
    models: null,
    cache: null,
    top: null,
    footer: null,
    bars: null,
    money_right: { receipt: [], models: [], top: [] },
    active_tab: null,
    highlight_text: null,
    fade_visible: false,
    documentBox: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight
    }
  };
  var costRoot = document.querySelector("[data-probe='cost-root']");
  if (costRoot) {
    costFacts.present = true;
    costFacts.root = rectOf(costRoot);
    var costScroll = costRoot.querySelector("[data-probe='cost-scroll']");
    if (costScroll) {
      costFacts.scroll = {
        clientWidth: costScroll.clientWidth,
        scrollWidth: costScroll.scrollWidth,
        clientHeight: costScroll.clientHeight,
        scrollHeight: costScroll.scrollHeight
      };
    }
    var costReceipt = costRoot.querySelector("[data-probe='cost-receipt']");
    if (costReceipt) {
      var costRows = costReceipt.querySelectorAll("[data-probe='cost-receipt-row']");
      var costReceiptRows = [];
      for (var cri = 0; cri < costRows.length; cri++) {
        var costCells = costRows[cri].querySelectorAll("td");
        costReceiptRows.push({
          cls: costRows[cri].getAttribute("data-class"),
          tokens: costCells[0] ? costCells[0].textContent : "",
          rate: costCells[1] ? costCells[1].textContent : "",
          share: costCells[2] ? costCells[2].textContent : "",
          sum: costCells[3] ? costCells[3].textContent : "",
          height: costRows[cri].getBoundingClientRect().height
        });
      }
      var costTotal = costReceipt.querySelector("[data-probe='cost-receipt-total']");
      var costTotalFacts = null;
      if (costTotal) {
        var costTotalCell = costTotal.querySelector("[data-probe='cost-money']");
        var costTotalStyle = getComputedStyle(costTotalCell || costTotal);
        costTotalFacts = {
          height: costTotal.getBoundingClientRect().height,
          sum: costTotalCell ? costTotalCell.textContent : "",
          border_top: costTotalStyle.borderTopWidth,
          border_style: costTotalStyle.borderTopStyle
        };
      }
      /* 未计入提示在 section 里、table 外（<p> 是收据的脚注），所以从根上找。 */
      var costUnpriced = costRoot.querySelector("[data-probe='cost-unpriced']");
      var costMoneyNodes = costReceipt.querySelectorAll("[data-probe='cost-money']");
      for (var cmi = 0; cmi < costMoneyNodes.length; cmi++) {
        costFacts.money_right.receipt.push(costMoneyNodes[cmi].getBoundingClientRect().right);
      }
      costFacts.receipt = {
        rows: costReceiptRows,
        total: costTotalFacts,
        unpriced: costUnpriced ? costUnpriced.textContent.trim() : null
      };
    }
    var costModels = costRoot.querySelector("[data-probe='cost-models']");
    if (costModels) {
      var costModelRows = costModels.querySelectorAll("[data-probe='cost-model-row']");
      var costModelList = [];
      for (var cmr = 0; cmr < costModelRows.length; cmr++) {
        var costModelCells = costModelRows[cmr].querySelectorAll("td");
        var costModelName = costModelRows[cmr].querySelector("th strong");
        var costModelMeta = costModelRows[cmr].querySelector("th span");
        var costModelSum = costModelRows[cmr].querySelector("[data-probe='cost-money']");
        if (costModelSum) {
          costFacts.money_right.models.push(costModelSum.getBoundingClientRect().right);
        }
        costModelList.push({
          name: costModelName ? costModelName.textContent : "",
          meta: costModelMeta ? costModelMeta.textContent : "",
          tokens: costModelCells[0] ? costModelCells[0].textContent : "",
          output: costModelCells[1] ? costModelCells[1].textContent : "",
          cache_write: costModelCells[2] ? costModelCells[2].textContent : "",
          cache_read: costModelCells[3] ? costModelCells[3].textContent : "",
          sum: costModelSum ? costModelSum.textContent : "",
          height: costModelRows[cmr].getBoundingClientRect().height
        });
      }
      costFacts.models = costModelList;
    }
    var costCache = costRoot.querySelector("[data-probe='cost-cache']");
    if (costCache) {
      costFacts.cache = (costCache.innerText || "").replace(/\s+/g, " ").trim();
    }
    var costTop = costRoot.querySelector("[data-probe='cost-top']");
    if (costTop) {
      var costTopRows = costTop.querySelectorAll("[data-probe='cost-top-row']");
      var costTopList = [];
      for (var ctr = 0; ctr < costTopRows.length; ctr++) {
        var costTopButton = costTopRows[ctr].querySelector("button");
        var costTopSum = costTopRows[ctr].querySelector("[data-probe='cost-money']");
        if (costTopSum) {
          costFacts.money_right.top.push(costTopSum.getBoundingClientRect().right);
        }
        costTopList.push({
          clock: costTopButton ? costTopButton.textContent.trim() : "",
          sum: costTopSum ? costTopSum.textContent : "",
          height: costTopRows[ctr].getBoundingClientRect().height
        });
      }
      costFacts.top = { rows: costTopList };
    }
    var costFooter = costRoot.querySelector("[data-probe='cost-footnote']");
    if (costFooter) {
      var costFooterRect = costFooter.getBoundingClientRect();
      costFacts.footer = {
        text: (costFooter.textContent || "").trim(),
        bottom: costFooterRect.bottom,
        root_bottom: costRoot.getBoundingClientRect().bottom
      };
    }
    var costBars = costRoot.querySelectorAll("[data-probe='cost-bar']");
    var costBarList = [];
    var costHiddenBars = 0;
    for (var cb = 0; cb < costBars.length; cb++) {
      var costBarRect = costBars[cb].getBoundingClientRect();
      if (costBarRect.width <= 0 || costBarRect.height <= 0) costHiddenBars += 1;
      costBarList.push({ width: costBarRect.width, height: costBarRect.height });
    }
    costFacts.bars = { count: costBars.length, hidden: costHiddenBars, items: costBarList };
  }
  /* 页面里有两个 tablist（顶栏「页面切换」与分析器「视图切换」），必须限定后一个，
     否则第一个选中项永远是顶栏的「会话分析」。 */
  costFacts.fade_visible = !!document.querySelector("[data-probe='cost-fade']");
  var costActiveTab = document.querySelector(
    "[role='tablist'][aria-label='视图切换'] [role='tab'][aria-selected='true']"
  );
  costFacts.active_tab = costActiveTab ? (costActiveTab.textContent || "").trim() : null;
  var costHighlight = document.querySelector(
    "[data-probe='record-table'] tr[class*='highlight']"
  );
  costFacts.highlight_text = costHighlight
    ? (costHighlight.innerText || costHighlight.textContent || "").replace(/\s+/g, " ").trim()
    : null;
  /* 跳回日志之后的落点：日志表自己的矩形 + 每行首格（时刻）与行中心的视口 y。
     高亮只亮 1.6s，而每步取图前要静置 3s——探针到场时高亮已经灭了，所以判
     「停在那条记录上」只能靠**滚动后的位置**，不能靠高亮类名。 */
  var costLogTable = document.querySelector("[data-probe='record-table']");
  costFacts.log = null;
  if (costLogTable) {
    var costLogRows = costLogTable.querySelectorAll("tbody tr");
    var costLogRowList = [];
    for (var clr = 0; clr < costLogRows.length; clr++) {
      var costLogCell = costLogRows[clr].querySelector("td, th");
      var costLogRect = costLogRows[clr].getBoundingClientRect();
      costLogRowList.push({
        clock: costLogCell
          ? (costLogCell.innerText || costLogCell.textContent || "")
              .replace(/\s+/g, " ")
              .trim()
          : "",
        center: (costLogRect.top + costLogRect.bottom) / 2
      });
    }
    costFacts.log = {
      rect: rectOf(costLogTable),
      rows: costLogRowList
    };
  }
  facts.cost = costFacts;

  /* 「第二批十功能」（Round DD）：同 costFacts / replayFacts——只收矩形、文本、
     aria 与计数，阈值与判定留在 scripts/gui-test.sh。 */
  var roundddFacts = { present: false };
  var ddRoot = document.querySelector("[data-probe='usage-page']");
  if (ddRoot) {
    roundddFacts.present = true;
    var ddSummary = ddRoot.querySelector("[data-probe='compare-summary']");
    roundddFacts.compare = {
      selects: ddRoot.querySelectorAll("select[data-probe='compare-a'], select[data-probe='compare-b']").length,
      summary: ddSummary ? ddSummary.textContent.trim() : null
    };
    var ddRadarSvg = ddRoot.querySelector("[data-probe='fingerprint'] svg");
    roundddFacts.radar = ddRadarSvg
      ? {
          rect: rectOf(ddRadarSvg),
          axes: ddRoot.querySelectorAll("[data-probe='fingerprint-axis']").length
        }
      : null;
    var ddHabits = ddRoot.querySelector("[data-probe='work-habits']");
    roundddFacts.habits = ddHabits
      ? {
          cells: ddHabits.children.length,
          text: (ddHabits.innerText || "").replace(/\s+/g, " ").trim()
        }
      : null;
    var ddGantt = ddRoot.querySelector("[data-probe='gantt']");
    var ddGanttRows = ddRoot.querySelectorAll("[data-probe='gantt-row']");
    var ddGanttCharts = ddRoot.querySelectorAll("[data-probe='gantt']");
    roundddFacts.gantt = ddGantt
      ? {
          rect: rectOf(ddGantt),
          charts: ddGanttCharts.length,
          chartRows: (function () {
            var out = [];
            for (var gi = 0; gi < ddGanttCharts.length; gi++) {
              out.push(ddGanttCharts[gi].querySelectorAll("[data-probe='gantt-row']").length);
            }
            return out;
          })(),
          rows: ddGanttRows.length,
          first: ddGanttRows[0] ? ddGanttRows[0].getAttribute('aria-label') : null,
          last: ddGanttRows[ddGanttRows.length - 1]
            ? ddGanttRows[ddGanttRows.length - 1].getAttribute('aria-label')
            : null
        }
      : null;
    var ddSwap = ddRoot.querySelector("[data-probe='model-swap']");
    roundddFacts.swap = ddSwap
      ? {
          rows: ddSwap.querySelectorAll("tbody tr").length,
          text: (ddSwap.innerText || "").replace(/\s+/g, " ").trim()
        }
      : null;
    var ddHealth = ddRoot.querySelector("[data-probe='tool-health']");
    roundddFacts.health = ddHealth
      ? {
          rows: ddRoot.querySelectorAll("[data-probe='tool-health-row']").length,
          text: (ddHealth.innerText || "").replace(/\s+/g, " ").trim()
        }
      : null;
    var ddEquiv = ddRoot.querySelector("[data-probe='equivalents']");
    var ddToggle = ddRoot.querySelector("button[aria-controls='kpi-equivalents']");
    roundddFacts.equivalents = {
      present: !!ddEquiv,
      items: ddEquiv ? ddEquiv.children.length : 0,
      expanded: ddToggle ? ddToggle.getAttribute('aria-expanded') : null
    };
    var ddGauge = ddRoot.querySelector("[data-probe='burn-gauge'] svg");
    roundddFacts.gauge = ddGauge
      ? { viewBox: ddGauge.getAttribute('viewBox'), rect: rectOf(ddGauge) }
      : null;
  }
  facts.rounddd = roundddFacts;

  /* 「第三批十功能」（Round EE）：只收事实——趋势叠层与异常 ▲、年报卡、时间轴
     滑块、健康分、新鲜度、火花线与 CSV 入口的矩形/文本/aria，阈值留在脚本。 */
  var roundeeFacts = {
    present: false,
    trend: null,
    migration: null,
    annual: null,
    timeline: null,
    health: null,
    freshness: null,
    sparklines: 0,
    csv: null
  };
  var roundeeRoot = document.querySelector("[data-probe='trend-overlay']");
  if (roundeeRoot) {
    roundeeFacts.present = true;
    roundeeFacts.trend = {
      ma: document.querySelectorAll("[data-probe='trend-ma']").length,
      forecast: document.querySelectorAll("[data-probe='trend-forecast']").length,
      marks: document.querySelectorAll("[data-probe='anomaly-marks'] > span").length,
      mark_titles: Array.prototype.map.call(
        document.querySelectorAll("[data-probe='anomaly-marks'] > span"),
        function (node) { return node.getAttribute('title') || ''; }
      ),
      legend: (document.querySelector("[data-probe='trend-overlay']").parentElement.parentElement.querySelector('p') || {}).textContent || ''
    };
  }
  var migrationRoot = document.querySelector("[data-probe='model-migration']");
  if (migrationRoot) {
    roundeeFacts.migration = {
      bars: migrationRoot.querySelectorAll("[data-probe='migration-bar']").length,
      gaps: migrationRoot.querySelectorAll("[data-probe='migration-gap']").length,
      aria: (migrationRoot.querySelector("[role='img']") || {}).getAttribute
        ? migrationRoot.querySelector("[role='img']").getAttribute('aria-label')
        : null
    };
  }
  var annualRoot = document.querySelector("[data-probe='year-report']");
  if (annualRoot) {
    roundeeFacts.annual = {
      regions: annualRoot.querySelectorAll("section[aria-label]").length,
      region_names: Array.prototype.map.call(
        annualRoot.querySelectorAll("section[aria-label]"),
        function (node) { return node.getAttribute('aria-label') || ''; }
      ),
      text: (annualRoot.textContent || '').slice(0, 120),
      range_tablist: !!document.querySelector("[role='tablist'][aria-label='时间范围']"),
      export_snapshot: !!document.querySelector("[title*='导出用量快照']")
    };
  }
  var timelineRoot = document.querySelector("[data-probe='timeline-track']");
  if (timelineRoot) {
    var timelineRect = rectOf(timelineRoot);
    roundeeFacts.timeline = {
      rect: timelineRect,
      now: timelineRoot.getAttribute('aria-valuenow'),
      min: timelineRoot.getAttribute('aria-valuemin'),
      max: timelineRoot.getAttribute('aria-valuemax'),
      text: timelineRoot.getAttribute('aria-valuetext')
    };
  }
  var healthRoot = document.querySelector("[aria-label^='健康分']");
  if (healthRoot) {
    roundeeFacts.health = {
      aria: healthRoot.getAttribute('aria-label'),
      text: (healthRoot.textContent || '').slice(0, 80)
    };
  }
  var freshnessRoot = document.querySelector("[data-probe='data-freshness']");
  if (freshnessRoot) {
    roundeeFacts.freshness = {
      text: (freshnessRoot.textContent || '').trim(),
      state: freshnessRoot.getAttribute('data-state')
    };
  }
  roundeeFacts.sparklines = document.querySelectorAll("[data-probe='kpi-sparkline']").length;
  var csvProjects = document.querySelector("[data-probe='csv-export-projects'] button");
  var csvModels = document.querySelector("[data-probe='csv-export-models'] button");
  if (csvProjects || csvModels) {
    roundeeFacts.csv = {
      projects: csvProjects ? csvProjects.textContent : null,
      models: csvModels ? csvModels.textContent : null
    };
  }
  facts.roundee = roundeeFacts;

  /* 「第五批十功能」（Round GG）：只收事实——故事线天数与首行、项目卡片与
     季节条、筛选栏的展开态与字段数。阈值与判定留在 scripts/gui-test.sh。 */
  var roundggFacts = { present: false };
  var ggStory = document.querySelectorAll("[data-probe='story-day']");
  var ggCards = document.querySelectorAll("[data-probe='card-item']");
  var ggQuery = document.querySelector("[data-probe='session-query']");
  if (ggStory.length > 0 || ggCards.length > 0 || ggQuery) {
    roundggFacts.present = true;
    roundggFacts.story = {
      rows: ggStory.length,
      first: ggStory[0] ? (ggStory[0].textContent || "").replace(/\s+/g, " ").trim() : null,
      detail_items: document.querySelectorAll("[data-probe='story-detail'] li").length
    };
    var ggCardLabels = [];
    for (var gci = 0; gci < ggCards.length; gci += 1) {
      ggCardLabels.push(ggCards[gci].getAttribute('aria-label'));
    }
    roundggFacts.cards = { count: ggCards.length, labels: ggCardLabels };
    var ggSeasons = document.querySelectorAll("[data-probe='card-season']");
    var ggSeasonTexts = [];
    var ggSeasonQuarters = [];
    var ggSeasonText = document.querySelectorAll("[data-probe='card-season-text']");
    for (var gsi = 0; gsi < ggSeasons.length; gsi += 1) {
      ggSeasonQuarters.push(ggSeasons[gsi].getAttribute('data-quarters'));
      ggSeasonTexts.push(ggSeasonText[gsi] ? ggSeasonText[gsi].textContent.trim() : null);
    }
    roundggFacts.seasons = { count: ggSeasons.length, quarters: ggSeasonQuarters, texts: ggSeasonTexts };
    var ggToggle = document.querySelector("[data-probe='session-query-toggle']");
    var ggNote = document.querySelector("[data-probe='session-query-index-note']");
    roundggFacts.query = ggQuery
      ? {
          expanded: ggToggle ? ggToggle.getAttribute('aria-expanded') : null,
          head: ggToggle ? (ggToggle.textContent || "").replace(/\s+/g, " ").trim() : null,
          fields: ggQuery.querySelectorAll("select").length,
          note: ggNote ? ggNote.textContent.trim() : null
        }
      : null;
  }
  facts.roundgg = roundggFacts;

  /* 第六批（Round HH）：三件事条 / 模型 A-B / 缓存体检 / 会话筛选栏 / 分享卡。
     只收事实——条数、tone、文本、几何；阈值与判定都在 scripts/gui-test.sh。
     分享卡只读 `disabled` 与 `title`，**不点击**：真机上点它会弹原生保存对话框，
     门禁在无人值守下会挂住。 */
  (function () {
    var briefing = document.querySelector("[data-probe='briefing']");
    var items = Array.prototype.slice.call(document.querySelectorAll("[data-probe='briefing-item']"));
    var seesaw = document.querySelector("[data-probe='model-seesaw']");
    var rows = seesaw ? Array.prototype.slice.call(seesaw.querySelectorAll("[data-probe='seesaw-row']")) : [];
    var cache = document.querySelector("[data-probe='cache-hit']");
    var body = document.querySelector("[data-probe='session-query-body']");
    var share = document.querySelector("[data-probe='share-card']");
    var rhythm = document.querySelector("[data-probe='rhythm']");
    facts.roundhh = {
      present: !!(briefing || seesaw || cache || share || rhythm || body),
      briefing: briefing
        ? {
            count: items.length,
            tones: items.map(function (item) { return item.getAttribute('data-tone'); }),
            texts: items.map(function (item) { return (item.textContent || '').trim(); })
          }
        : null,
      seesaw: seesaw
        ? {
            rows: rows.length,
            months: rows.map(function (row) { return row.getAttribute('data-month'); }),
            text: (seesaw.textContent || '').slice(0, 400)
          }
        : null,
      cache: cache ? (cache.textContent || '').trim() : null,
      query: body ? { present: true, fields: body.querySelectorAll('select, input').length } : null,
      share: share
        ? { present: true, disabled: !!share.disabled, title: share.getAttribute('title') }
        : null,
      rhythm: rhythm
        ? { present: true, bars: document.querySelectorAll("[data-probe='rhythm-bar']").length }
        : null
    };
  })();

  /* 第七批（Round II）：会话形状 / 工作日对照 / 多选对照 / 提问画像。
     只收事实——桶数、读数、行文本、表头；阈值与判定在 scripts/gui-test.sh。 */
  (function () {
    var shape = document.querySelector("[data-probe='session-shape']");
    var shapeBars = shape ? Array.prototype.slice.call(shape.querySelectorAll("[data-probe='shape-bar']")) : [];
    var split = document.querySelector("[data-probe='workday-split']");
    var wdRows = split ? Array.prototype.slice.call(split.querySelectorAll("[data-probe='workday-row']")) : [];
    var multi = document.querySelector("[data-probe='multi-compare']");
    var profile = document.querySelector("[data-probe='prompt-profile']");
    var profileMetrics = profile ? profile.querySelectorAll("p > span").length : 0;
    facts.roundii = {
      present: !!(shape || split || multi || profile),
      shape: shape
        ? {
            mod: shape.getAttribute('data-shape'),
            buckets: shapeBars.map(function (bar) { return bar.getAttribute('data-bucket'); }),
            counts: shapeBars.map(function (bar) {
              var count = bar.querySelector("span:not([aria-hidden])");
              return count ? (count.textContent || '').trim() : null;
            }),
            readout: (shape.querySelector("[data-probe='shape-readout']") || {}).textContent || null
          }
        : null,
      workday: split
        ? {
            rows: wdRows.length,
            groups: wdRows.map(function (row) { return row.getAttribute('data-group'); }),
            texts: wdRows.map(function (row) { return (row.textContent || '').replace(/\s+/g, " ").trim(); })
          }
        : null,
      multi: multi
        ? {
            chips: multi.querySelectorAll("[data-probe='multi-chip']").length,
            rows: multi.querySelectorAll("[data-probe='multi-row']").length,
            table: (multi.querySelector("[data-probe='multi-table']") || {}).textContent || null
          }
        : null,
      profile: profile
        ? { metrics: profileMetrics, text: (profile.textContent || '').trim().slice(0, 160) }
        : null
    };
  })();

  return JSON.stringify(facts);
})();"##;

    /// 把目标名安全化成文件名片段：保留字母数字（含中文），其余折叠成单个 `-`。
    /// 与 `scripts/gui-test.sh` 里的 `slug_of` **必须逐字一致**——文件名对不上时
    /// 脚本会一直等不到文件，而那看起来像「取图失败」。
    pub(super) fn slug_of(value: &str) -> String {
        let mut out = String::new();
        let mut pending_dash = false;
        for ch in value.chars() {
            if ch.is_alphanumeric() {
                if pending_dash && !out.is_empty() {
                    out.push('-');
                }
                pending_dash = false;
                out.push(ch);
            } else {
                pending_dash = true;
            }
        }
        if out.is_empty() {
            "tab".to_string()
        } else {
            out
        }
    }

    /// 文件名后缀：**单个**目标沿用旧名 `-tab`（既有文档与脚本依赖它）；
    /// 多个目标各用 `-<slug>`，文件名能看出是哪张图。同名目标第 2 次及以后
    /// 再追加 `-<序号>`（如 `-全局搜索-2`），否则后一次会覆盖前一次的产物——
    /// 「开浮层 → 关浮层」这类成对目标就靠它保住第一次的证据。
    pub(super) fn tab_suffix(count: usize, tab: &str, nth: usize) -> String {
        let base = if count == 1 {
            "-tab".to_string()
        } else {
            format!("-{}", slug_of(tab))
        };
        if nth > 1 {
            format!("{base}-{nth}")
        } else {
            base
        }
    }

    /// 第 N 张图的输出路径：第一张去掉 `.pdf` 后缀再加 `-tab.pdf` / `-<slug>.pdf`。
    pub(super) fn tab_output_path(first: &Path, count: usize, tab: &str, nth: usize) -> PathBuf {
        let mut path = first.to_path_buf();
        path.set_extension("");
        path.as_mut_os_string()
            .push(format!("{}.pdf", tab_suffix(count, tab, nth)));
        path
    }

    /// 探针 JSON 的输出路径：文件名规则与取图一致，只是后缀换成 `.json`。
    pub(super) fn probe_output_path(first: &Path, count: usize, tab: &str, nth: usize) -> PathBuf {
        let mut path = first.to_path_buf();
        path.set_extension("");
        path.as_mut_os_string()
            .push(format!("{}.json", tab_suffix(count, tab, nth)));
        path
    }

    /// 把字符串安全地嵌进 JavaScript 的双引号字面量里。
    pub(super) fn js_string(value: &str) -> String {
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
    }

    /// 目标是不是「切界面字号」的动作形式 `字号=<档位>`（如 `字号=130%`）。
    ///
    /// 字号档位没有稳定的可访问名（按钮里带着视觉隐藏的「（默认）」），而且要先开
    /// 设置浮层才够得着——所以它不适用通用的「找一个按钮点下去」，单独走一条动作。
    pub(super) fn font_scale_target(target: &str) -> Option<&str> {
        target
            .strip_prefix("字号=")
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    /// 目标是不是「切界面对比度」的动作形式 `对比度=高` / `对比度=普通`（Round U / #73）。
    ///
    /// 与 `字号=` 同一动作协议：档位控件藏在设置浮层里，通用「找一个按钮点下去」
    /// 够不着，而且要在**同一个浮层里区分两个 radiogroup**（字号一档、对比度一档），
    /// 所以点选按容器锚点走（见 `contrast_js`），不靠「全文档第一枚 radio」。
    pub(super) fn contrast_target(target: &str) -> Option<&str> {
        target
            .strip_prefix("对比度=")
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    /// 目标是不是「确保设置浮层打开」的动作形式 `设置=开`。
    ///
    /// 与 `视图=` 同一类**状态自愈**动作：设置浮层是 toggle（顶栏那枚按钮），
    /// 面板开着的时候再点一次会把**它关掉**。默认清单里早先的「字号=130%」已经
    /// 把面板打开且此后没有任何一步会关它，所以按名点「设置」在这里是错的
    /// ——实测把面板关掉，后面的「导出归档包…」找不到按钮（Round Q 的真机
    /// 教训）。动作按 `aria-expanded` 判当前状态：已经开着就什么都不做。
    pub(super) fn settings_target(target: &str) -> Option<&str> {
        target
            .strip_prefix("设置=")
            .map(str::trim)
            .filter(|value| *value == "开")
    }

    /// 目标是不是「切用量页子视图」的动作形式 `视图=<名>`（`视图=用量` / `视图=错误`）。
    ///
    /// 与 `字号=` 同一动作协议。存在的理由是**状态泄漏自愈**：N1 给用量页加了
    /// 「用量|错误」分段，选择记进真实 WebKit 的 localStorage（不受 HOME 隔离），
    /// 上一次运行停在错误档时，后续运行点「用量总览」标签页只会得到错误档——
    /// 表盘与三块面板根本不渲染。默认清单因此在「用量总览」后显式重置一次。
    pub(super) fn view_target(target: &str) -> Option<&str> {
        target
            .strip_prefix("视图=")
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    /// 目标是不是「滚动内容区」的动作形式 `滚动=<选择器>`（如 `滚动=main`）。
    ///
    /// 与 `字号=<档位>` 同一动作协议：不是「点一个按钮」，是对滚动容器的操作。
    /// 用量总览的下半屏（按项目 / 按模型 / 活跃时段三块面板）只有滚过去才
    /// 看得见——取图与几何探针都要能跟着滚到底，`滚动=main` 就是那一步。
    pub(super) fn scroll_target(target: &str) -> Option<&str> {
        target
            .strip_prefix("滚动=")
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    /// 目标是不是「按选择器点选」的动作形式 `点选=<CSS 选择器>`（如
    /// `点选=[data-probe='compact-event-2']`）。
    ///
    /// 通用按钮扫描靠可访问名**精确**匹配，而有些控件的可访问名带动态数字
    /// （压缩事件 chip 是「#2 03-01 10:00 · 手动 · 156.2K→9.6K」）——把这种
    /// 文本当目标名，夹具一改就静默失配。这些控件带 `data-probe` 稳定属性
    /// （同 Gauge 的 `data-probe="gauge"` 先例），按选择器点它才不脆。
    /// 选择器里不能含逗号（目标清单以逗号分隔），这是动作协议的边界。
    pub(super) fn click_query_target(target: &str) -> Option<&str> {
        target
            .strip_prefix("点选=")
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    /// `设置=开`：确保设置浮层是**打开**的（已经开着就什么都不做）。
    ///
    /// 幂等靠顶栏那枚按钮的 `aria-expanded`（React 把 `settingsOpen` 直接写在
    /// 它上面）。不这么写的话，清单里「打开设置 → 点浮层里的东西」这两步会在
    /// 「面板本来就开着」时把面板关掉——被点的那个人不是按钮不存在，而是
    /// 整个浮层被上一步收走了（Round Q 真机上就栽在这上面）。
    pub(super) fn open_settings_js() -> String {
        r#"(function () {
  var button = document.querySelector('button[aria-label="设置"]');
  if (!button) { console.warn('gui-capture: 找不到顶栏的设置按钮'); return; }
  if (button.getAttribute('aria-expanded') === 'true') {
    console.log('gui-capture: 设置浮层已经是打开的，不用再点');
    return;
  }
  button.click();
  console.log('gui-capture: 已打开设置浮层');
})();"#
            .to_string()
    }

    /// 在真机上把界面字号切到指定档位：先点顶栏的「设置」打开浮层，再点「界面字号」
    /// 里对应的一项。**点的是真实控件**，不是直接改 localStorage——要证的正是
    /// 「设置里的控件真的接上了根变量」。`eval` 是单向的（拿不到返回值），所以结果
    /// 写进 console，与其它目标一样可在应用日志里追查。
    ///
    /// 开浮层与点档位之间隔一帧：React 渲染完那一项才存在于 DOM 里。
    ///
    /// 档位已经可见时**不再点「设置」**：那枚按钮是 toggle，面板开着再点一次就是
    /// 关掉它（见 `settings_target` 的注释）。
    pub(super) fn font_scale_js(label: &str) -> String {
        let escaped = js_string(label);
        format!(
            r#"(function () {{
  var wanted = "{escaped}";
  function clickRadio() {{
    var items = document.querySelectorAll('[role="radiogroup"] [role="radio"]');
    for (var i = 0; i < items.length; i++) {{
      var text = (items[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (text.indexOf(wanted) === 0) {{
        items[i].click();
        console.log('gui-capture: 已切界面字号 ' + wanted);
        return true;
      }}
    }}
    return false;
  }}
  if (clickRadio()) return;
  var buttons = document.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) {{
    if (buttons[i].getAttribute('aria-label') === '设置') {{ buttons[i].click(); break; }}
  }}
  setTimeout(function () {{
    if (!clickRadio()) console.warn('gui-capture: 找不到界面字号档位 ' + wanted);
  }}, 200);
}})();"#
        )
    }

    /// 在真机上把界面对比度切到指定档位（`对比度=高` / `对比度=普通`）。
    ///
    /// 与 `font_scale_js` 同一条动作协议，只有两处不同：一是**先按容器锚点收窄**
    /// （设置浮层里现在有两个 radiogroup——界面字号与界面对比度，全文档扫 radio
    /// 会按 DOM 顺序撞上另一档），二是面板本来就开着时不再点「设置」（那枚按钮是
    /// toggle，点一次就把面板关了）。
    pub(super) fn contrast_js(label: &str) -> String {
        let escaped = js_string(label);
        format!(
            r#"(function () {{
  var wanted = "{escaped}";
  function group() {{
    return document.querySelector('[data-probe="contrast-group"]')
      || document.querySelector('[data-probe="contrast-group"] [role="radiogroup"]')
      || document.querySelector('[role="radiogroup"][aria-label="界面对比度"]');
  }}
  function clickRadio() {{
    var box = group();
    if (!box) return false;
    var items = box.querySelectorAll('[role="radio"]');
    for (var i = 0; i < items.length; i++) {{
      var text = (items[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (text.indexOf(wanted) === 0) {{
        items[i].click();
        console.log('gui-capture: 已切界面对比度 ' + wanted);
        return true;
      }}
    }}
    return false;
  }}
  if (clickRadio()) return;
  var buttons = document.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) {{
    if (buttons[i].getAttribute('aria-label') === '设置') {{ buttons[i].click(); break; }}
  }}
  setTimeout(function () {{
    if (!clickRadio()) console.warn('gui-capture: 找不到界面对比度档位 ' + wanted);
  }}, 200);
}})();"#
        )
    }

    /// 找到目标并点击：优先标签页，其次任意按钮。匹配可取访问名的三种来源——
    /// `aria-label`、`title`、可见文本——所以既能点标签页（文本 / aria-label），
    /// 也能点会话条目（它的 `title` 是 cwd）。`eval` 是单向的（拿不到脚本返回值），
    /// 所以点击结果写进 console：成功与失败各一条，都能在测试脚本收集的应用日志里追查。
    ///
    /// 把内容区（当前只有 `main` 这一个滚动容器）滚到底。滚动是同步赋值
    /// （项目样式里没有 `scroll-behavior: smooth`），结果写进 console，
    /// 与其它动作一样可在应用日志里追查。
    pub(super) fn scroll_js(selector: &str) -> String {
        let escaped = js_string(selector);
        format!(
            r#"(function () {{
  var el = document.querySelector("{escaped}");
  if (!el) {{ console.warn('gui-capture: 找不到要滚动的 {escaped}'); return; }}
  el.scrollTop = el.scrollHeight;
  console.log('gui-capture: {escaped} 已滚到底 scrollTop=' + el.scrollTop + ' / scrollHeight=' + el.scrollHeight);
}})();"#
        )
    }

    /// `点选=<选择器>`：点通用扫描够不着的目标（可访问名带动态数字的控件）。
    ///
    /// 带回执版本（evaluateJavaScript 通道）：点击后**同步**读一次点击前后的
    /// aria-pressed（React 18 的离散事件在派发内同步跑 handler，setState 落到
    /// DOM 要到提交帧，所以同步读的是点击前状态——回执里两者都带，脚本侧
    /// 拿下一帧的探针对照）。返回字符串，三态：`clicked` / `missing` / 异常。
    pub(super) fn click_query_receipt_js(target: &str) -> Option<String> {
        let selector = click_query_target(target)?;
        let escaped = js_string(selector);
        Some(format!(
            r#"(function () {{
  var el = document.querySelector("{escaped}");
  if (!el) return 'missing';
  el.click();
  return 'clicked';
}})();"#
        ))
    }

    /// eval 通道的点选脚本（现仅由带回执版本取代，保留给潜在的非真机路径）。
    pub(super) fn click_query_js(selector: &str) -> String {
        let escaped = js_string(selector);
        format!(
            r#"(function () {{
  var el = document.querySelector("{escaped}");
  if (!el) {{ console.warn('gui-capture: 找不到点选目标 {escaped}'); return; }}
  el.click();
  console.log('gui-capture: 已点选 {escaped}');
}})();"#
        )
    }

    /// `视图=<名>` 的带回执点击脚本（同点选的 receipt 通道——J4 教训：点选类
    /// 动作别走单向 eval，脚本被丢弃时无从得知）。
    ///
    /// 锚点是分段的容器（`aria-label="总览视图"`，全站唯一）+ SegmentedControl
    /// 的默认角色 `tablist`/`tab`——**不是** radiogroup：那是它的另一种模式
    /// （设置里的字号档在用），这里不是。按可见文本**精确**匹配目标名，回执
    /// 带点击前的 aria-selected（泄漏时是 true，回执因此能区分「已在目标档」
    /// 与「切过去了」）。三态与点选一致：`clicked …` / `missing …` / 异常。
    pub(super) fn view_click_receipt_js(target: &str) -> Option<String> {
        let label = view_target(target)?;
        let escaped = js_string(label);
        Some(format!(
            r#"(function () {{
  var wanted = "{escaped}";
  var items = document.querySelectorAll('[role="tablist"][aria-label="总览视图"] [role="tab"]');
  for (var i = 0; i < items.length; i++) {{
    var text = (items[i].textContent || '').replace(/\s+/g, ' ').trim();
    if (text === wanted) {{
      var before = items[i].getAttribute('aria-selected');
      items[i].click();
      return 'clicked ' + wanted + ' (was ' + before + ')';
    }}
  }}
  return 'missing ' + wanted;
}})();"#
        ))
    }

    /// eval 通道的视图切换脚本（保留给潜在的非真机路径，同点选的备胎）。
    pub(super) fn view_click_js(label: &str) -> String {
        let escaped = js_string(label);
        format!(
            r#"(function () {{
  var wanted = "{escaped}";
  var items = document.querySelectorAll('[role="tablist"][aria-label="总览视图"] [role="tab"]');
  for (var i = 0; i < items.length; i++) {{
    var text = (items[i].textContent || '').replace(/\s+/g, ' ').trim();
    if (text === wanted) {{ items[i].click(); console.log('gui-capture: 已切总览视图 ' + wanted); return; }}
  }}
  console.warn('gui-capture: 找不到总览视图档 ' + wanted);
}})();"#
        )
    }

    /// `设置=开`、`字号=<档位>`、`滚动=<选择器>`、`点选=<选择器>` 与 `视图=<名>`
    /// 不是「点一个已有按钮」，各走各的动作。
    pub(super) fn click_target_js(target: &str) -> String {
        if settings_target(target).is_some() {
            return open_settings_js();
        }
        if let Some(label) = font_scale_target(target) {
            return font_scale_js(label);
        }
        if let Some(label) = contrast_target(target) {
            return contrast_js(label);
        }
        if let Some(label) = view_target(target) {
            return view_click_js(label);
        }
        if let Some(selector) = scroll_target(target) {
            return scroll_js(selector);
        }
        if let Some(selector) = click_query_target(target) {
            return click_query_js(selector);
        }
        let escaped = js_string(target);
        format!(
            r#"(function () {{
  var wanted = "{escaped}";
  var scopes = [
    document.querySelectorAll('[role="tablist"] button'),
    document.querySelectorAll('button'),
    /* 会话条目（#209 起）的本体是 `role="button"` 的 <div>，**不再是 <button>**
       ——出血点徽章得是真按钮，而按钮不能嵌按钮，所以外层降级成 role=button。
       只看 `button` 的旧扫描因此一条都选不到「点标题打开会话」的目标：门禁里
       `/repo/demo` 那一步静默落空，后面「导出 / 上下文 / 改动」与记录表、会话行
       的覆盖判定跟着整片红。锚点与 web/e2e/selectors.ts 的 SESSION_ITEM_SELECTOR
       （`[role="button"][title]:has(strong)`）同一形态：这里同样要 `[title]`，
       少了它会把工具栏那颗 IconButton 也卷进候选。 */
    document.querySelectorAll('[role="button"][title]')
  ];
  for (var s = 0; s < scopes.length; s++) {{
    var buttons = scopes[s];
    for (var i = 0; i < buttons.length; i++) {{
      var el = buttons[i];
      var candidates = [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        (el.textContent || '').replace(/\s+/g, ' ').trim()
      ];
      if (candidates.indexOf(wanted) >= 0) {{
        el.click();
        console.log('gui-capture: 已点击 ' + wanted);
        return;
      }}
    }}
  }}
  console.warn('gui-capture: 找不到目标 ' + wanted);
}})();"#
        )
    }

    /// 给探针 JSON 附加一条 **Rust 侧事实**：托盘是否真的建起来了。
    ///
    /// 放在 gui_probe（而不是 macos-only 的 gui_capture）里，是为了让这段纯字符串逻辑
    /// 在任意平台的 `cargo test` 下都能跑到，不再重演 #160。脚本按字段名取值，
    /// 所以其余字段一律原样保留；探针 JSON 坏掉时原样返回——不因为这一条附加事实
    /// 把整份取证丢掉，缺字段自会由脚本判失败。
    pub(super) fn with_tray_fact(text: &str) -> String {
        match serde_json::from_str::<serde_json::Value>(text) {
            Ok(mut value) => {
                if let Some(object) = value.as_object_mut() {
                    object.insert(
                        "tray_created".to_string(),
                        serde_json::Value::Bool(crate::tray::created()),
                    );
                }
                value.to_string()
            }
            Err(_) => text.to_string(),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn the_tray_fact_is_injected_without_touching_other_fields() {
            let injected = with_tray_fact(r#"{"escaped_text":0,"document":{"scrollWidth":10}}"#);
            let value: serde_json::Value =
                serde_json::from_str(&injected).expect("注入后仍是合法 JSON");
            assert!(
                value.get("tray_created").map(serde_json::Value::is_boolean) == Some(true),
                "应插入布尔类型的 tray_created：{injected}"
            );
            assert_eq!(value["escaped_text"], serde_json::json!(0));
            assert_eq!(value["document"]["scrollWidth"], serde_json::json!(10));
        }

        #[test]
        fn a_broken_probe_payload_is_written_back_verbatim() {
            // 探针 JSON 坏掉时不能顺手把整份取证也丢了。
            assert_eq!(with_tray_fact("不是 JSON"), "不是 JSON");
        }

        #[test]
        fn settings_target_only_matches_the_open_action() {
            assert_eq!(settings_target("设置=开"), Some("开"));
            assert_eq!(settings_target("设置= 开 "), Some("开"));
            // 只认「开」：没有「关」这个动作，写别的值就退化成按名点按钮。
            assert_eq!(settings_target("设置=关"), None);
            assert_eq!(settings_target("设置="), None);
            // 普通目标与另外几个动作都不归它管。
            assert_eq!(settings_target("设置"), None);
            assert_eq!(settings_target("字号=130%"), None);
            assert_eq!(settings_target("视图=用量"), None);
        }

        #[test]
        fn the_open_settings_action_is_idempotent_by_aria_expanded() {
            let js = open_settings_js();
            assert!(js.contains("aria-label=\"设置\""));
            // 幂等的关键：先读状态，开着就不再点（toggle 会把面板关掉）。
            assert!(js.contains("aria-expanded"));
            assert!(js.contains("已经是打开的"));
            assert!(click_target_js("设置=开").contains("aria-expanded"));
        }

        #[test]
        fn font_scale_target_only_matches_the_action_form() {
            assert_eq!(font_scale_target("字号=130%"), Some("130%"));
            assert_eq!(font_scale_target("字号= 110% "), Some("110%"));
            assert_eq!(font_scale_target("字号="), None);
            // 普通目标（标签页、会话 cwd）不该被当成动作吞掉。
            assert_eq!(font_scale_target("用量总览"), None);
            assert_eq!(font_scale_target("/repo/demo"), None);
            // `设置=开` 是另一个动作，不该被字号吞掉。
            assert_eq!(font_scale_target("设置=开"), None);
        }

        #[test]
        fn view_target_only_matches_the_action_form() {
            assert_eq!(view_target("视图=用量"), Some("用量"));
            assert_eq!(view_target("视图= 错误 "), Some("错误"));
            assert_eq!(view_target("视图="), None);
            // 普通目标与另外几个动作都不归它管。
            assert_eq!(view_target("用量总览"), None);
            assert_eq!(view_target("字号=130%"), None);
            assert_eq!(view_target("滚动=main"), None);
            assert_eq!(view_target("点选=[data-probe='compact-event-2']"), None);
            assert_eq!(view_target("设置=开"), None);
        }

        #[test]
        fn scroll_target_only_matches_the_action_form() {
            assert_eq!(scroll_target("滚动=main"), Some("main"));
            assert_eq!(scroll_target("滚动= main "), Some("main"));
            assert_eq!(scroll_target("滚动="), None);
            // 普通目标不该被当成动作吞掉；字号动作也不归它管。
            assert_eq!(scroll_target("用量总览"), None);
            assert_eq!(scroll_target("字号=130%"), None);
            assert_eq!(scroll_target("设置=开"), None);
        }

        #[test]
        fn click_query_target_only_matches_the_action_form() {
            assert_eq!(
                click_query_target("点选=[data-probe='compact-event-2']"),
                Some("[data-probe='compact-event-2']")
            );
            assert_eq!(click_query_target("点选= "), None);
            // 普通目标与另外两个动作都不归它管。
            assert_eq!(click_query_target("/repo/demo"), None);
            assert_eq!(click_query_target("滚动=main"), None);
            assert_eq!(click_query_target("字号=130%"), None);
            assert_eq!(click_query_target("设置=开"), None);
        }

        #[test]
        fn the_scroll_action_scrolls_the_container_and_reports() {
            let js = click_target_js("滚动=main");
            // 动作滚的是容器（赋值到底），而不是通用按钮扫描。
            assert!(js.contains("scrollTop = el.scrollHeight"));
            assert!(js.contains("已滚到底"));
            assert!(!js.contains("已点击"));
            assert!(!js.contains("已切界面字号"));
        }

        #[test]
        fn the_font_scale_action_clicks_a_radio_and_opens_settings() {
            let js = click_target_js("字号=130%");
            // 动作走的是 radiogroup 里的真实控件，而不是通用按钮扫描。
            assert!(js.contains("[role=\"radiogroup\"] [role=\"radio\"]"));
            assert!(js.contains("aria-label') === '设置"));
            assert!(js.contains("已切界面字号"));
            // 档位文案进的是被转义过的字面量。
            assert!(js.contains("var wanted = \"130%\""));
        }

        #[test]
        fn contrast_target_only_matches_the_action_form() {
            assert_eq!(contrast_target("对比度=高"), Some("高"));
            assert_eq!(contrast_target("对比度= 普通 "), Some("普通"));
            assert_eq!(contrast_target("对比度="), None);
            // 普通目标与另外几个动作都不归它管。
            assert_eq!(contrast_target("设置=开"), None);
            assert_eq!(contrast_target("字号=130%"), None);
            assert_eq!(contrast_target("用量总览"), None);
            // 字号动作也不该被对比度吞掉（两条动作名字相邻，最易写错）。
            assert_eq!(font_scale_target("对比度=高"), None);
        }

        #[test]
        fn the_contrast_action_targets_its_own_group() {
            let js = click_target_js("对比度=高");
            // 设置浮层里有两个 radiogroup（界面字号 / 界面对比度），所以点选必须
            // 按容器锚点收窄——直接扫全文档 radio 会按 DOM 顺序撞上另一档。
            assert!(js.contains("[data-probe=\"contrast-group\"]"));
            assert!(js.contains("[role=\"radio\"]"));
            assert!(js.contains("已切界面对比度"));
            assert!(js.contains("var wanted = \"高\""));
            // 面板本来就开着时不许再点「设置」——那是 toggle，会把面板关掉。
            assert!(js.contains("aria-label') === '设置"));
        }

        #[test]
        fn the_view_action_clicks_the_segment_with_a_receipt() {
            let js = view_click_receipt_js("视图=用量").expect("视图= 动作应有回执脚本");
            // 走的是总览视图分段的真实 tab 控件（SegmentedControl 默认 tablist；
            // radiogroup 是它的另一种模式，这里不是），而不是通用按钮扫描。
            assert!(js.contains("[role=\"tablist\"][aria-label=\"总览视图\"]"));
            assert!(js.contains("[role=\"tab\"]"));
            // 回执带点击前的选中态：泄漏时 was true 能与「已在目标档」区分。
            assert!(js.contains("aria-selected"));
            assert!(js.contains("clicked "));
            assert!(js.contains("missing "));
            // 目标名进的是被转义过的字面量。
            assert!(js.contains("var wanted = \"用量\""));
            // 非视图动作不产回执脚本（交给其它动作处理）。
            assert!(view_click_receipt_js("字号=130%").is_none());
            assert!(view_click_receipt_js("用量总览").is_none());
        }

        #[test]
        fn the_click_query_action_has_a_receipt_script() {
            let js = click_query_receipt_js("点选=[data-probe='compact-event-2']")
                .expect("点选= 动作应有回执脚本");
            // 选择器进的是被转义过的字面量，脚本按选择器直接取元素。
            assert!(js.contains("document.querySelector(\"[data-probe='compact-event-2']\")"));
            // 回执把「点了 / 没这个元素」分开——真机上点选 chip 曾整段静默失效，
            // 没有回执就分不清是脚本丢了还是元素不在。
            assert!(js.contains("return 'clicked'"));
            assert!(js.contains("return 'missing'"));
            // 非点选动作不产回执脚本（交给其它动作处理）。
            assert!(click_query_receipt_js("字号=130%").is_none());
            assert!(click_query_receipt_js("/repo/demo").is_none());
        }

        #[test]
        fn an_ordinary_target_still_uses_the_generic_button_scan() {
            let js = click_target_js("/repo/demo");
            assert!(js.contains("已点击"));
            assert!(!js.contains("已切界面字号"));
            // 目标里的引号必须被转义，否则会提前结束字面量、整段脚本变成语法错误。
            let quoted = click_target_js("say \"hi\"");
            assert!(quoted.contains("var wanted = \"say \\\"hi\\\"\""));
        }

        #[test]
        fn the_generic_scan_also_reaches_role_button_session_rows() {
            // #209 把会话行从 <button> 降级成 `role="button"` 的 <div>（出血点徽章
            // 得是真按钮，而按钮不能嵌按钮）。通用扫描只看 `button` 时，「点标题
            // 打开会话」那几步会**静默落空**——门禁里表现为导出 / 上下文 / 改动
            // 一连串红，而报错全在别处。锚点与 web/e2e/selectors.ts 同一形态。
            let js = click_target_js("/repo/demo");
            assert!(js.contains(r#"[role="button"][title]"#));
            assert!(js.contains("SESSION_ITEM_SELECTOR") || js.contains("出血点徽章"));
        }

        #[test]
        fn the_click_query_action_targets_a_selector() {
            let js = click_target_js("点选=[data-probe='compact-event-2']");
            // 动作走 querySelector（可访问名带动态数字的控件够不着通用扫描），
            // 而不是通用按钮扫描。
            assert!(js.contains("document.querySelector"));
            assert!(js.contains("已点选"));
            assert!(!js.contains("已点击"));
            assert!(!js.contains("已切界面字号"));
        }

        #[test]
        fn the_probe_reports_the_font_scale_and_session_rows() {
            assert!(PROBE_JS.contains("font_scale:"));
            assert!(PROBE_JS.contains("--font-scale"));
            // 高对比度档：根元素属性是「档位真的落地了」的唯一事实来源。
            assert!(PROBE_JS
                .contains("contrast: document.documentElement.getAttribute('data-contrast')"));
            assert!(PROBE_JS.contains("session_rows"));
            // 会话行的锚点是 role + title（#209 起行本体不再是 <button>），
            // 与 web/e2e/selectors.ts 的 SESSION_ITEM_SELECTOR 同一形态。
            assert!(PROBE_JS.contains(r#"[aria-label="会话列表"] [role="button"][title]"#));
            assert!(!PROBE_JS.contains("[aria-label=\"会话列表\"] button[title]"));
        }

        #[test]
        fn the_probe_reports_panels_billing_and_labeled_dialogs() {
            // 面板标题带文档位置（docTop）——「滚一次可达」的判定靠它。
            assert!(PROBE_JS.contains("panels"));
            assert!(PROBE_JS.contains("docTop"));
            // 限额区：卡、周用量层、卡内读数（<b>）三种矩形都要收集。
            assert!(PROBE_JS.contains("计费窗口"));
            assert!(PROBE_JS.contains("周用量（滚动 7 天）"));
            assert!(PROBE_JS.contains("name: 'billing'"));
            // 浮层靠 label 分流（导出走 aria-labelledby，搜索走 aria-label），
            // 不再假装全站只有一种 modal。
            assert!(PROBE_JS.contains("name: 'dialog'"));
            assert!(PROBE_JS.contains("aria-labelledby"));
            // 归档包口令浮层（#152）：浮层是 fixed，不进 PDF，所以字段数与
            // 警告文案也必须由探针带出来。
            assert!(PROBE_JS.contains("passwordFields"));
            assert!(PROBE_JS.contains("input[type=\"password\"]"));
            assert!(PROBE_JS.contains("text: dialogText.slice("));
        }

        #[test]
        fn the_probe_reports_context_view_anchors() {
            // 上下文标签页（Round J）的锚点：曲线宿主（role=img + aria-label 前缀）、
            // 压缩命中区（rect[data-event-id]）、取证卡与被丢清单（data-probe）、
            // 覆盖率 chip（全站唯一的 aria-haspopup="dialog" 按钮）。
            assert!(PROBE_JS.contains("上下文压力"));
            assert!(PROBE_JS.contains("rect[data-event-id]"));
            assert!(PROBE_JS.contains("forensic-card"));
            assert!(PROBE_JS.contains("dropped-list"));
            assert!(PROBE_JS.contains("aria-haspopup=\"dialog\""));
            assert!(PROBE_JS.contains("declaredCount"));
            assert!(PROBE_JS.contains("padHeights"));
        }

        #[test]
        fn the_probe_reports_error_view_anchors() {
            // 错误档（Round N / N1）的锚点：容器（data-error-view）、趋势 SVG
            // （data-error-trend + rect[data-bar]）、事件列表（data-error-events，
            // 行数 × 行高 = 总高的账目事实）、过滤态（data-error-filter）。
            assert!(PROBE_JS.contains("[data-error-view]"));
            assert!(PROBE_JS.contains("[data-error-trend]"));
            assert!(PROBE_JS.contains("rect[data-bar]"));
            assert!(PROBE_JS.contains("[data-error-events]"));
            assert!(PROBE_JS.contains("[data-error-filter]"));
            assert!(PROBE_JS.contains("facts.error"));
        }

        #[test]
        fn the_probe_reports_changes_view_anchors() {
            // 改动标签页（Round N / N2）的锚点：容器（data-changes-view）、文件
            // 列表（data-changes-files + li[data-changes-file] 的行高账目）、
            // 展开区（data-changes-records + 记录行 data-changes-record）、空态
            // （data-changes-empty）。声明行数读聚合读数自己的
            // data-changes-aggregate（不借面板结构，理由见 PROBE_JS 注释）。
            assert!(PROBE_JS.contains("[data-changes-view]"));
            assert!(PROBE_JS.contains("[data-changes-files]"));
            assert!(PROBE_JS.contains("li[data-changes-file]"));
            assert!(PROBE_JS.contains("[data-changes-aggregate]"));
            assert!(PROBE_JS.contains("[data-changes-records]"));
            assert!(PROBE_JS.contains("[data-changes-record]"));
            assert!(PROBE_JS.contains("[data-changes-empty]"));
            assert!(PROBE_JS.contains("个文件"));
            assert!(PROBE_JS.contains("facts.changes"));
            // closest('section') 方向相反（子不是祖），出现过就不许再回来。
            assert!(!PROBE_JS.contains("changesView.closest"));
        }

        #[test]
        fn the_probe_reports_tool_census_anchors() {
            // 工具与 skill 面板（Round N / N3）的锚点：容器（data-tool-census）、
            // 体首行双读数（data-tool-census-total）、四栏清单（data-tool-census-list，
            // 行数 × 行高 = 总高的账目事实，行高测 li）、下钻会话列表
            // （data-tool-census-sessions）与过滤态（data-tool-census-filter 的
            // 属性值 = 选中行 label）。
            assert!(PROBE_JS.contains("[data-tool-census]"));
            assert!(PROBE_JS.contains("[data-tool-census-total]"));
            assert!(PROBE_JS.contains("[data-tool-census-list]"));
            assert!(PROBE_JS.contains("[data-tool-census-sessions]"));
            assert!(PROBE_JS.contains("[data-tool-census-filter]"));
            assert!(PROBE_JS.contains("facts.toolCensus"));
        }

        #[test]
        fn the_probe_reports_quota_attribution_and_the_open_session_title() {
            // 按会话的配额归因（Round R / #151）：面板 / 列表 / 行 / 余项 /
            // 脚注五个锚点，行内四个字段（标题、token、占比条、百分比）分别取，
            // 行数与行高给脚本做「真列表对账」（防假列表）。
            assert!(PROBE_JS.contains("[data-probe=\"attribution-panel\"]"));
            assert!(PROBE_JS.contains("[data-probe=\"attribution-list\"]"));
            assert!(PROBE_JS.contains("[data-probe=\"attribution-row\"]"));
            assert!(PROBE_JS.contains("[data-probe=\"attribution-row-title\"]"));
            assert!(PROBE_JS.contains("[data-probe=\"attribution-row-token\"]"));
            assert!(PROBE_JS.contains("[data-probe=\"attribution-row-bar\"]"));
            assert!(PROBE_JS.contains("[data-probe=\"attribution-row-pct\"]"));
            assert!(PROBE_JS.contains("[data-probe=\"attribution-rest\"]"));
            assert!(PROBE_JS.contains("[data-probe=\"attribution-footnote\"]"));
            assert!(PROBE_JS.contains("rowHeights"));
            assert!(PROBE_JS.contains("barFillWidths"));
            assert!(PROBE_JS.contains("footnoteTitle"));
            assert!(PROBE_JS.contains("facts.attribution"));
            // 点行之后要比对**会话分析页当前会话的标题**——没有这条事实，
            // 门禁只能断言「页面没崩」，那就等于没验点击。
            assert!(PROBE_JS.contains("header[aria-label=\"会话信息\"]"));
            assert!(PROBE_JS.contains("facts.analyzer"));
        }

        #[test]
        fn the_probe_reports_the_day_review_summary_and_timeline() {
            // 「一日回望」（Round V2 / #192）：摘要行、时间线 rect、每条横条的
            // 会话键，以及组件声明的会话数——门禁拿**实测条数**跟它对账。
            assert!(PROBE_JS.contains("[data-probe=\"day-summary\"]"));
            assert!(PROBE_JS.contains("[data-probe=\"day-timeline\"]"));
            assert!(PROBE_JS.contains("[data-probe=\"day-timeline-bar\"]"));
            assert!(PROBE_JS.contains("data-session-path"));
            assert!(PROBE_JS.contains("data-session-count"));
            assert!(PROBE_JS.contains("calendarFacts.dayReview"));
        }

        #[test]
        fn the_probe_reports_the_calendar_insights_facts() {
            // 「一年洞察」（Round V3 / #199）：六句实事的容器锚点（data-probe）
            // 与键序列（data-insight-key）——门禁把键序与六个稳定词逐字对账
            // （DAY_SUMMARY_LABELS 的同款做法）。
            assert!(PROBE_JS.contains("[data-probe=\"calendar-insights\"]"));
            assert!(PROBE_JS.contains("data-insight-key"));
            assert!(PROBE_JS.contains("calendarFacts.insights"));
        }

        #[test]
        fn the_probe_reports_the_usage_snapshot_export_entry() {
            // 用量快照入口（Round S / #149）：探针只回答「按钮在不在、可不可点」，
            // 不去点它——点了会弹系统保存对话框、探针驱动不了那一步。锚点用
            // 按钮自己的 data-probe，可访问名会随文案改。
            assert!(PROBE_JS.contains("[data-probe=\"usage-snapshot-export\"]"));
            assert!(PROBE_JS.contains("facts.snapshot_export"));
            assert!(PROBE_JS.contains("disabled: snapshotEl.disabled === true"));
        }

        #[test]
        fn the_probe_targets_the_main_log_table_by_anchor_not_by_tag() {
            // 「记录表末列可达」检查的采集锚点（Round V / #187 期间修正）：此前是
            // 裸 querySelector('table')，依赖「文档第一个 table 恰是主日志表」的
            // 旧假设——消耗日历给用量页带来 table 后在用量页被误捕（日历无
            // thead → lastColumnRight 为 null → 误报「末列被裁切」）。锚点收紧到
            // LogView 主表的 data-probe，侧栏 / 浮层小表与日历都不再进这条检查。
            assert!(PROBE_JS.contains("table[data-probe=\"record-table\"]"));
        }

        #[test]
        fn the_probe_reports_the_usage_calendar_facts() {
            // 消耗日历（Round V / #187）的锚点：滚动容器（data-usage-calendar，
            // overflowX / 滚动几何走 boxOf）、365 天格计数（data-probe，pad 不挂）、
            // 今天格唯一性（挂在 td 上）、展开区（data-calendar-sessions）。
            assert!(PROBE_JS.contains("[data-usage-calendar]"));
            assert!(PROBE_JS.contains("calendar-day"));
            assert!(PROBE_JS.contains("calendar-today"));
            assert!(PROBE_JS.contains("facts.calendar = calendarFacts"));
            assert!(PROBE_JS.contains("data-calendar-sessions"));
        }

        #[test]
        fn the_probe_reports_the_pulse_view_facts() {
            // 「实时脉搏」（Issue #203 / Round W）：根节点（pulse-page）、四态
            // （根节点上的 data-state）、浮窗细头与拖动声明、5 个窗口读数的键序、
            // 60 根速率柱与进行中那一根、活跃会话行与字形高度、上下文曲线的样本数 /
            // 参考带 / 断崖计数。
            // 锚点一律 data-probe，**禁裸标签选择器**（日历表被 `querySelector('table')`
            // 误捕那一课：门禁红了 9 步才定位到）。
            assert!(PROBE_JS.contains("[data-probe='pulse-page']"));
            assert!(PROBE_JS.contains("pulseFacts.state"));
            assert!(PROBE_JS.contains("[data-probe='pulse-float-head']"));
            assert!(PROBE_JS.contains("data-tauri-drag-region"));
            assert!(PROBE_JS.contains("[data-probe='pulse-window-readout']"));
            assert!(PROBE_JS.contains("[data-probe='pulse-rate-bar']"));
            assert!(PROBE_JS.contains("[data-probe='pulse-session-row']"));
            assert!(PROBE_JS.contains("[data-probe='pulse-session-tick']"));
            assert!(PROBE_JS.contains("[data-probe='pulse-context-curve']"));
            assert!(PROBE_JS.contains("[data-probe='pulse-context-band']"));
            assert!(PROBE_JS.contains("[data-probe='pulse-context-cliff']"));
            assert!(PROBE_JS.contains("facts.pulse = pulseFacts"));
        }

        #[test]
        fn the_probe_reports_the_milestones_view_facts() {
            // 「里程碑」（Issue #214 / Round Y）：用量页第三档子视图。锚点：根节点
            // （milestones-view）、空态（milestones-empty）、三组
            // （milestones-group 的 data-group）、每枚卡片（milestone-card 的
            // state / 名称 / 值 / 填充）、距离条轨道（milestone-track）。
            // 锚点一律 data-probe，**禁裸标签选择器**（日历表被误捕那一课）。
            // 「未达成卡片里取不到 fill」（§15.2 的裁决）是一条布尔几何事实——
            // 探针数的是 querySelectorAll 的条数，这条选择器字符串必须留在脚本里，
            // 不然实现期把 milestone-fill 从探针里删掉也没人察觉。
            assert!(PROBE_JS.contains("[data-probe='milestones-view']"));
            assert!(PROBE_JS.contains("[data-probe='milestones-group']"));
            assert!(PROBE_JS.contains("[data-probe='milestone-card']"));
            assert!(PROBE_JS.contains("[data-probe='milestone-name']"));
            assert!(PROBE_JS.contains("[data-probe='milestone-value']"));
            assert!(PROBE_JS.contains("[data-probe='milestone-fill']"));
            assert!(PROBE_JS.contains("[data-probe='milestone-track']"));
            // 锚点类（首次 / 记录）没有轨道，也就没有填充——脚本靠这条事实
            // 把「阶梯卡的两态」与「锚点卡的无填充」分开，字段名必须留着。
            assert!(PROBE_JS.contains("track: !!milestoneTrack"));
            assert!(PROBE_JS.contains("facts.milestones = milestoneFacts"));
        }

        #[test]
        fn the_probe_reports_the_monitor_console_view_facts() {
            // 「监控台」（Issue #225 / Round Z）：根节点与四态、四枚读数键序、
            // 24 小时三态、项目行、事件行与可见详情。锚点一律 data-probe，
            // **禁裸标签选择器**；尤其 future 小时必须用组合选择器证明槽内
            // **没有任何填充**，不能把「未来」画成「0 token」。
            assert!(PROBE_JS.contains("[data-probe='monitor-console-page']"));
            assert!(PROBE_JS.contains("[data-probe='monitor-console-readout']"));
            assert!(PROBE_JS.contains("[data-probe='monitor-console-hour']"));
            assert!(PROBE_JS.contains("[data-probe='monitor-console-hour-slot']"));
            assert!(PROBE_JS.contains("[data-probe='monitor-console-project-row']"));
            assert!(PROBE_JS.contains("[data-probe='monitor-console-event-row']"));
            assert!(PROBE_JS.contains(
                "[data-probe='monitor-console-hour'][data-phase='future'] \
                 [data-probe='monitor-console-hour-fill']"
            ));
            assert!(PROBE_JS.contains("facts.monitor_console = monitorConsoleFacts"));
        }

        #[test]
        fn repeated_targets_get_numbered_suffixes() {
            // 同名目标的第二次出现必须换文件名，否则会覆盖第一次的产物
            // （「全局搜索」开与关就是同名的两次点击）。
            let first = Path::new("/tmp/app-capture.pdf");
            assert_eq!(
                tab_output_path(first, 2, "全局搜索", 1),
                PathBuf::from("/tmp/app-capture-全局搜索.pdf")
            );
            assert_eq!(
                tab_output_path(first, 2, "全局搜索", 2),
                PathBuf::from("/tmp/app-capture-全局搜索-2.pdf")
            );
            // 单个目标与首次出现保持旧规则（`-tab` 与不带序号）。
            assert_eq!(
                tab_output_path(first, 1, "用量总览", 1),
                PathBuf::from("/tmp/app-capture-tab.pdf")
            );
            assert_eq!(
                probe_output_path(first, 2, "全局搜索", 2),
                PathBuf::from("/tmp/app-capture-全局搜索-2.json")
            );
        }
    }
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
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSData, NSError, NSString};
    use objc2_web_kit::WKWebView;
    use std::path::{Path, PathBuf};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};
    use tauri::Manager;
    // 与平台无关的那一半在 gui_probe 里（单测因此在 Linux 上也会跑）
    use super::gui_probe::*;

    /// 应用启动后等这么久再取图：要留出 webview 完成首次渲染的时间。
    /// 截早了会拿到半张白屏，而那种失败是**静默**的（能生成文件，内容却是空的）。
    const SETTLE_MS: u64 = 6_000;

    /// 点击目标后等这么久再取图：新视图要先完成一轮渲染（打开会话还要先读文件
    /// 并解析）。探针与取图都排在这之后。
    const TAB_SETTLE_MS: u64 = 3_000;

    /// 等一张图落盘的上限。createPDF 的 completion handler 是异步回调，而且它的
    /// 渲染是**延后**发生的：实测过「探针先于快照求值」——同一张图对应的探针读到的
    /// 却是点击生效前、快照还没跟上的旧视图。所以探针要等到 PDF 落盘后再求值，
    /// 落盘即代表快照已完成，两者描述同一视图。点击下一步前也要等，
    /// 否则下一张截到的还是旧视图。
    ///
    /// **但这个上限不再是「探针的开关」**：等超时了也照样取探针（见 `spawn` 的注释）。
    /// 取 15s 与 `scripts/gui-test.sh` 里每个视图等取图 PDF 的秒数一致——它只决定
    /// 「正常路径下探针是否等到快照之后」，定大一点只是让正常的对齐更稳，
    /// 不会因为定大了就把失败藏起来。
    const PDF_TIMEOUT_MS: u64 = 15_000;

    /// 几何探针求值遇到瞬时失败时的重试次数与间隔。
    ///
    /// **只重试「求值本身失败」**（`evaluateJavaScript` 报错、回调没回、写文件失败）。
    /// 探针一旦**成功写出** JSON 就立刻返回——哪怕那份 JSON 描述的是一个坏布局
    /// （表盘被撑爆、记录表被裁切），也照样返回、由脚本判定失败。所以重试**不会**
    /// 掩盖真回归，它只把「页面过渡态 / 主线程忙导致的偶发求值失败」抹平。
    const PROBE_ATTEMPTS: u32 = 5;
    const PROBE_RETRY_MS: u64 = 300;

    /// 单次等待求值回调的上限。`with_webview` 是异步投递，回调何时回来由主线程决定；
    /// 给个上限，主线程若长时间不回来，重试不会被永久卡死。
    /// 5 × (3s + 0.3s) ≈ 17s 是最坏情况，脚本等探针的超时要盖过它（见 gui-test.sh）。
    const PROBE_EVAL_TIMEOUT_MS: u64 = 3_000;

    /// 取图前等「视图就绪」的上限与轮询间隔。
    ///
    /// `TAB_SETTLE_MS` 是**下限**（给一次渲染的时间），这里补的是**内容就绪**：
    /// 用量总览要先把本机会话扫一遍才有表盘，扫描期间页面上是进度行。等到页面上
    /// 没有 `[data-probe-pending]` 再取图，才不会拍到「还没算完」的那一帧。
    /// 等不到也照常取图（超时不阻断取证），只在日志里说清楚——这是取证旁路，
    /// 不是断言。
    const READY_TIMEOUT_MS: u64 = 10_000;
    const READY_POLL_MS: u64 = 250;
    /// 必须以**字符串**返回：`evaluateJavaScript` 对数字回的是 NSNumber，
    /// 而回调侧按 NSString 读——照数字比会永远等不到（第一版就栽在这）。
    const READY_JS: &str = "String(document.querySelectorAll('[data-probe-pending]').length)";

    /// 取图线程：默认视图先取一张，然后按 `tabs` 依次点击、每步再取一张。
    /// 每张图都配一份几何探针（若设了 `CCA_GUI_PROBE`），供测试脚本判定布局。
    pub fn spawn(webview: tauri::Webview, out: PathBuf, tabs: Vec<String>, probe: Option<PathBuf>) {
        std::thread::spawn(move || {
            let start = Instant::now();
            std::thread::sleep(Duration::from_millis(SETTLE_MS));
            wait_until_ready(&webview, start, "默认视图");
            capture(&webview, &out, start);
            // 默认视图的探针**不拿 PDF 当开关**：等图落盘只是为了让它和快照描述同一
            // 视图，等到等不到都照常求值。之前这里写的是「等不到就跳过探针」，于是存在
            // 这样一个窗口：应用这边等超时、把探针整个跳过，而脚本那边同一张图还在等、
            // 最终算作「截图通过」——表现为「截图过、探针缺」的假红。默认视图是启动后
            // 第一张，正赶上应用最忙的时刻，最慢、也最先撞上。默认视图之前没有任何
            // 点击/切换，「探针读到快照前旧视图」这个风险对它并不成立。
            if wait_for_file(&out, PDF_TIMEOUT_MS) {
                println!(
                    "gui-capture: [+{}ms] 默认视图的图已落盘",
                    start.elapsed().as_millis()
                );
            } else {
                eprintln!(
                    "gui-capture: [+{}ms] 默认视图的图没有落盘（等 {}ms），探针仍照常取",
                    start.elapsed().as_millis(),
                    PDF_TIMEOUT_MS
                );
            }
            if let Some(probe) = &probe {
                probe_at(&webview, probe, start);
            }

            // 每一步都要等**上一步**的 PDF 落盘再点下一个，否则截到的还是旧视图。
            // 探针同样不拿本步 PDF 当开关：等到了就等它落盘后再求值（与快照对齐），
            // 等不到也照常求值——宁可探针早一点，也不要「截图过、探针缺」。
            //
            // 同名目标会出现两次（「全局搜索」开与关）：文件按目标名命名的话，
            // 第二次会**覆盖**第一次的图与探针，「开着浮层」的那份证据就丢了。
            // 所以按出现次数给文件名加 `-2`、`-3` 后缀（首次不带）。
            let mut seen_counts: std::collections::HashMap<&str, usize> =
                std::collections::HashMap::new();
            let mut previous = out.clone();
            let mut previous_label = "默认视图".to_string();
            for tab in tabs.iter() {
                if !wait_for_file(&previous, PDF_TIMEOUT_MS) {
                    eprintln!(
                        "gui-capture: [+{}ms] {previous_label}的图迟迟没有落盘（等 {}ms），停在「{tab}」之前",
                        start.elapsed().as_millis(),
                        PDF_TIMEOUT_MS
                    );
                    return;
                }
                // `点选=<选择器>` 与 `视图=<名>` 走带回执的 evaluateJavaScript
                // （同探针通道）：eval() 是单向投递，脚本若被丢弃无从得知——真机上
                // 点选压缩事件 chip 曾整段静默失效（chip 全程 aria-pressed=false），
                // 带回执才能把「点了 / 没这个元素 / 脚本丢了」三态分开说清楚。
                let receipt_js = click_query_receipt_js(tab).or_else(|| view_click_receipt_js(tab));
                if let Some(receipt_js) = receipt_js {
                    match evaluate_string(&webview, &receipt_js) {
                        Some(receipt) => {
                            println!(
                                "gui-capture: [+{}ms] 「{tab}」点选回执 {receipt}",
                                start.elapsed().as_millis()
                            );
                        }
                        None => {
                            eprintln!(
                                "gui-capture: [+{}ms] 「{tab}」点选求值没有回执（回调超时或脚本异常）",
                                start.elapsed().as_millis()
                            );
                        }
                    }
                } else if let Err(err) = webview.eval(click_target_js(tab).as_str()) {
                    eprintln!("gui-capture: 执行点击「{tab}」的脚本失败 {err}");
                    return;
                }
                std::thread::sleep(Duration::from_millis(TAB_SETTLE_MS));
                wait_until_ready(&webview, start, &format!("「{tab}」"));
                let nth = *seen_counts
                    .entry(tab.as_str())
                    .and_modify(|c| *c += 1)
                    .or_insert(1);
                let pdf = tab_output_path(&out, tabs.len(), tab, nth);
                capture(&webview, &pdf, start);
                if !wait_for_file(&pdf, PDF_TIMEOUT_MS) {
                    eprintln!(
                        "gui-capture: [+{}ms] 「{}」的图没有落盘（等 {}ms），探针仍照常取",
                        start.elapsed().as_millis(),
                        tab,
                        PDF_TIMEOUT_MS
                    );
                }
                if let Some(probe) = &probe {
                    probe_at(
                        &webview,
                        &probe_output_path(probe, tabs.len(), tab, nth),
                        start,
                    );
                }
                previous = pdf;
                previous_label = format!("「{tab}」");
            }
        });
    }

    /// 把 webview 当前渲染结果写成一份 PDF。只发起、不等完成——落盘由
    /// createPDF 的 completion handler 异步负责。所有失败路径只打日志、
    /// 绝不 panic：这个线程挂在渲染循环里会连带整个应用，而它只是取证旁路。
    fn capture(webview: &tauri::Webview, out: &Path, start: Instant) {
        let target = out.to_path_buf();
        let name = file_label(out);
        let name_in_handler = name.clone();
        let result = webview.with_webview(move |platform| {
            // `inner()` 在 macOS 上返回底层 WKWebView 的裸指针。
            let ptr = platform.inner().cast::<WKWebView>();
            if ptr.is_null() {
                eprintln!("gui-capture: 拿不到 WKWebView 指针");
                return;
            }
            let wk: &WKWebView = unsafe { &*ptr };

            let handler = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                if !data.is_null() {
                    let bytes = unsafe { (*data).to_vec() };
                    match std::fs::write(&target, &bytes) {
                        Ok(()) => println!(
                            "gui-capture: [+{}ms] {name_in_handler} 已写出 {} 字节",
                            start.elapsed().as_millis(),
                            bytes.len()
                        ),
                        Err(err) => eprintln!(
                            "gui-capture: [+{}ms] {name_in_handler} 写文件失败 {err}",
                            start.elapsed().as_millis()
                        ),
                    }
                } else {
                    let msg = if error.is_null() {
                        "未知错误".to_string()
                    } else {
                        unsafe { (*error).localizedDescription().to_string() }
                    };
                    eprintln!(
                        "gui-capture: [+{}ms] {name_in_handler} 取图失败 {msg}",
                        start.elapsed().as_millis()
                    );
                }
                // 刻意不退出：应用由测试脚本统一管理生命周期，
                // 这样同一次启动里还能跑「存活 / 内存 / 缓存 / 正常退出」那些断言。
            });

            // 配置传 None：按文档，这会取「当前显示范围」的整页，
            // 而不是分页的打印版式。
            unsafe { wk.createPDFWithConfiguration_completionHandler(None, &handler) };
        });
        if let Err(err) = result {
            eprintln!(
                "gui-capture: [+{}ms] {name} with_webview 失败 {err}",
                start.elapsed().as_millis()
            );
        }
    }

    /// 求值几何探针并把返回的 JSON 写入 `out`，遇到瞬时失败重试有限次。
    ///
    /// 走 `evaluateJavaScript:completionHandler:`——它是**双向**的，能拿回脚本的返回值；
    /// `webview.eval` 是单向的、拿不到。与 `capture` 同一条纪律：失败只打日志、绝不 panic。
    ///
    /// **重试只针对「求值 / 写盘失败」**：探针一旦成功写出 JSON 就立刻返回，哪怕那份
    /// JSON 描述的是坏布局，也照样返回、由脚本判失败——重试不会把它吞掉（见
    /// `PROBE_ATTEMPTS` 的注释）。
    fn probe_at(webview: &tauri::Webview, out: &Path, start: Instant) {
        let name = file_label(out);
        for attempt in 1..=PROBE_ATTEMPTS {
            match probe_once(webview, out) {
                Ok(bytes) => {
                    println!(
                        "gui-probe: [+{}ms] {name} 已写出 {bytes} 字节",
                        start.elapsed().as_millis()
                    );
                    return;
                }
                Err(msg) if attempt < PROBE_ATTEMPTS => {
                    eprintln!(
                        "gui-probe: [+{}ms] {name} 第 {attempt}/{PROBE_ATTEMPTS} 次求值失败（{msg}），{PROBE_RETRY_MS}ms 后重试",
                        start.elapsed().as_millis()
                    );
                    std::thread::sleep(Duration::from_millis(PROBE_RETRY_MS));
                }
                Err(msg) => {
                    eprintln!(
                        "gui-probe: [+{}ms] {name} 求值重试 {PROBE_ATTEMPTS} 次仍失败（{msg}），放弃写出",
                        start.elapsed().as_millis()
                    );
                    return;
                }
            }
        }
    }

    /// 单次求值：把结果（写出字节数或错误信息）经通道送回调用线程。
    ///
    /// `with_webview` 是**异步投递**（把闭包塞进主线程事件队列后立刻返回），所以这里要等
    /// 回调，并给一个上限——主线程若长时间不回来，重试不会被永久卡死。回调里 `value`
    /// 为空即求值失败（`error` 带原因），此时不写任何文件。
    fn probe_once(webview: &tauri::Webview, out: &Path) -> Result<usize, String> {
        let target = out.to_path_buf();
        let (tx, rx) = mpsc::channel::<Result<usize, String>>();
        let result = webview.with_webview(move |platform| {
            let ptr = platform.inner().cast::<WKWebView>();
            if ptr.is_null() {
                let _ = tx.send(Err("拿不到 WKWebView 指针".to_string()));
                return;
            }
            let wk: &WKWebView = unsafe { &*ptr };

            let handler = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                if value.is_null() {
                    let msg = if error.is_null() {
                        "未知错误".to_string()
                    } else {
                        unsafe { (*error).localizedDescription().to_string() }
                    };
                    let _ = tx.send(Err(msg));
                    return;
                }
                // 探针脚本返回 JSON 字符串，桥接过来就是 NSString。
                let text = unsafe { (*value.cast::<NSString>()).to_string() };
                // 写盘前插入一条来自 Rust 的事实（托盘是否真建起来了）；
                // 探针 JSON 坏掉时原样写回，不把取证一起丢掉。
                let payload = with_tray_fact(&text);
                match std::fs::write(&target, payload.as_bytes()) {
                    Ok(()) => {
                        let _ = tx.send(Ok(payload.len()));
                    }
                    Err(err) => {
                        let _ = tx.send(Err(format!("写文件失败 {err}")));
                    }
                }
            });

            let source = NSString::from_str(PROBE_JS);
            unsafe { wk.evaluateJavaScript_completionHandler(&source, Some(&handler)) };
        });
        if let Err(err) = result {
            return Err(format!("with_webview 失败 {err}"));
        }
        match rx.recv_timeout(Duration::from_millis(PROBE_EVAL_TIMEOUT_MS)) {
            Ok(outcome) => outcome,
            Err(mpsc::RecvTimeoutError::Timeout) => Err("等待求值回调超时".to_string()),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err("求值回调通道断开".to_string()),
        }
    }

    /// 取图前等视图「内容就绪」：页面上没有 `[data-probe-pending]`（骨架条、
    /// 扫描进度行）就立刻返回；超时也只打日志、照常取图——这是取证旁路，
    /// 不能因为等不到就把整轮测试停掉。
    fn wait_until_ready(webview: &tauri::Webview, start: Instant, label: &str) {
        let deadline = Instant::now() + Duration::from_millis(READY_TIMEOUT_MS);
        loop {
            if let Some(value) = evaluate_string(webview, READY_JS) {
                if value.trim() == "0" {
                    println!(
                        "gui-capture: [+{}ms] {label} 内容已就绪，开始取图",
                        start.elapsed().as_millis()
                    );
                    return;
                }
            }
            if Instant::now() >= deadline {
                eprintln!(
                    "gui-capture: [+{}ms] {label} 等视图就绪超过 {}ms（页面上仍有进行中标记），照常取图",
                    start.elapsed().as_millis(),
                    READY_TIMEOUT_MS
                );
                return;
            }
            std::thread::sleep(Duration::from_millis(READY_POLL_MS));
        }
    }

    /// 一次同步求值：把 JS 结果按字符串取回；超时或失败返回 `None`。
    /// `with_webview` 是异步投递，所以照旧走通道 + 上限，避免主线程不回来时卡死。
    fn evaluate_string(webview: &tauri::Webview, js: &str) -> Option<String> {
        let (tx, rx) = mpsc::channel::<Option<String>>();
        let source = js.to_string();
        let result = webview.with_webview(move |platform| {
            let ptr = platform.inner().cast::<WKWebView>();
            if ptr.is_null() {
                let _ = tx.send(None);
                return;
            }
            let wk: &WKWebView = unsafe { &*ptr };
            let handler = RcBlock::new(move |value: *mut AnyObject, _error: *mut NSError| {
                if value.is_null() {
                    let _ = tx.send(None);
                    return;
                }
                let text = unsafe { (*value.cast::<NSString>()).to_string() };
                let _ = tx.send(Some(text));
            });
            let source = NSString::from_str(&source);
            unsafe { wk.evaluateJavaScript_completionHandler(&source, Some(&handler)) };
        });
        if result.is_err() {
            return None;
        }
        rx.recv_timeout(Duration::from_millis(PROBE_EVAL_TIMEOUT_MS))
            .ok()
            .flatten()
    }

    /// 日志里用来指认是哪张图 / 哪份探针：只取文件名，脚本按名 grep 定位。
    fn file_label(path: &Path) -> String {
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string())
    }

    /// 轮询等文件出现。completion handler 跑在主线程，这里不能回调式串联
    /// （把点击塞进 handler 会在主线程上引入等待），轮询最直白也最容易看出超时。
    fn wait_for_file(path: &Path, timeout_ms: u64) -> bool {
        let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
        while std::time::Instant::now() < deadline {
            if path.is_file() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        path.is_file()
    }

    /// 由 `setup` 调用：只有设了 `CCA_GUI_CAPTURE` 才生效，否则完全惰性。
    /// - `CCA_GUI_CAPTURE_TAB`：逗号分隔的目标列表（可取访问名或会话 cwd），
    ///   应用依次点击并在每步取一张图；**单个值沿用旧文件名 `-tab.pdf`**。
    /// - `CCA_GUI_PROBE`：几何探针输出路径；每张图对应一份 JSON 事实。
    pub fn maybe_spawn(app: &tauri::App) {
        let Ok(target) = std::env::var("CCA_GUI_CAPTURE") else {
            return;
        };
        if target.trim().is_empty() {
            return;
        }
        let tabs: Vec<String> = std::env::var("CCA_GUI_CAPTURE_TAB")
            .map(|value| {
                value
                    .split(',')
                    .map(|item| item.trim().to_string())
                    .filter(|item| !item.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        let probe = std::env::var("CCA_GUI_PROBE")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        if let Some(webview) = app.get_webview_window("main") {
            spawn(webview.as_ref().clone(), PathBuf::from(target), tabs, probe);
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(float_plugin::init())
        .manage(ProcState::default())
        .manage(updater::PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![
            read_dir,
            stat,
            read_text,
            read_head,
            write_text,
            write_binary,
            run_lines,
            cancel_lines,
            exec_text,
            spawn_detached,
            home_dir,
            app_data_dir,
            monitor_port,
            monitor_ping,
            app_version,
            check_updates,
            install_update,
            relaunch_app,
            update_tray_readout,
            set_tray_visible,
            export_archive_bundle,
            import_archive_bundle,
            remove_import_staging,
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

            // 菜单栏 / 托盘常驻读数（Issue #150）。建不起来只少一个托盘，
            // 不该拖垮应用——失败原因已在 tray::create 里 eprintln。
            let _ = tray::create(app.handle());

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
    use super::{home_dir_from, io_error, string_from_head, write_binary};
    use std::collections::BTreeSet;
    use std::ffi::OsString;

    // --- 命令清单：generate_handler! 与 build.rs 的 app_manifest 必须完全一致 ---

    /// `include_str!` 会把本文件自己的源码读进来，所以 marker 刻意拆成两段写：
    /// 原样写成一个字面量的话，测试这一行自己就成了一个匹配点，读到的是它后面的
    /// 内容而不是真的 handler 块。
    const HANDLER_MARKER: &str = concat!("generate_handler", "![");
    const APP_MANIFEST_MARKER: &str = "app_manifest(";

    const LIB_RS: &str = include_str!("lib.rs");
    const BUILD_RS: &str = include_str!("../build.rs");
    const CAPABILITY: &str = include_str!("../capabilities/default.json");

    /// 取出 `text` 里每一处 `marker` 之后、到最近的 `]` 为止的标识符（去引号、去空白）。
    ///
    /// `marker` **必须自带开括号**。不能改成「marker 之后再去找 `[`」：`generate_handler!`
    /// 后面未必紧跟一个块，那样会一路找到很远的、属于别人的 `[`——读出来的东西
    /// 看着像命令名，其实与 handler 无关。
    fn bracketed_items_after(text: &str, marker: &str) -> Vec<Vec<String>> {
        let mut blocks = Vec::new();
        let mut rest = text;

        while let Some(found) = rest.find(marker) {
            let after = &rest[found + marker.len()..];
            let Some(close) = after.find(']') else { break };

            blocks.push(
                after[..close]
                    .split(',')
                    .map(|item| item.trim().trim_matches('"').to_string())
                    .filter(|item| !item.is_empty())
                    .collect(),
            );
            rest = &after[close..];
        }

        blocks
    }

    #[test]
    fn build_manifest_lists_exactly_the_registered_commands() {
        // 主 handler 注册的命令最多——`float_plugin` 里那个小 handler 只有
        // `enter` / `exit`，它在 build.rs 侧对应的是 `InlinedPlugin::commands`，
        // 不是 `app_manifest`，两边的对应关系由各自的 marker 分开取。
        let mut blocks = bracketed_items_after(LIB_RS, HANDLER_MARKER);
        blocks.sort_by_key(|block| std::cmp::Reverse(block.len()));
        let registered: BTreeSet<String> = blocks
            .into_iter()
            .next()
            .expect("lib.rs 里找不到 generate_handler! 块")
            .into_iter()
            .collect();

        // 从 `app_manifest(` 往后切，取它后面第一个 `.commands(&[...])`。直接全文找
        // `.commands(` 会先撞上 `build.rs` 里 `InlinedPlugin` 的 `["enter", "exit"]`。
        let manifest = BUILD_RS
            .find(APP_MANIFEST_MARKER)
            .expect("build.rs 里找不到 app_manifest(");
        let declared: BTreeSet<String> =
            bracketed_items_after(&BUILD_RS[manifest..], concat!(".commands(&", "["))
                .into_iter()
                .next()
                .expect("app_manifest 里找不到 .commands(&[...])")
                .into_iter()
                .collect();

        let missing: Vec<&String> = registered.difference(&declared).collect();
        let extra: Vec<&String> = declared.difference(&registered).collect();
        assert!(
            missing.is_empty() && extra.is_empty(),
            "build.rs 的 app_manifest 与 lib.rs 的 generate_handler! 不一致：\n  \
             只有 lib.rs 注册（build.rs 漏声明，权限不会被生成）: {missing:?}\n  \
             只有 build.rs 声明（注册不存在的命令）: {extra:?}"
        );
    }

    #[test]
    fn every_app_command_is_allowed_in_the_capability() {
        // 缺 `allow-<命令>` 的后果是静默的：命令注册得好好的、build 全绿，
        // 但前端 invoke 一律被拒——用户侧表现为「版本未知」「检查更新一直失败」。
        // v0.9.0-beta.1 就是这么把整个更新功能发出去的，这条测试专门堵它。
        let manifest = BUILD_RS
            .find(APP_MANIFEST_MARKER)
            .expect("build.rs 里找不到 app_manifest(");
        let declared = bracketed_items_after(&BUILD_RS[manifest..], concat!(".commands(&", "["))
            .into_iter()
            .next()
            .expect("app_manifest 里找不到 .commands(&[...])");

        let missing: Vec<String> = declared
            .iter()
            .filter_map(|command| {
                let permission = format!("allow-{}", command.replace('_', "-"));
                (!CAPABILITY.contains(&format!("\"{permission}\""))).then_some(permission)
            })
            .collect();

        assert!(
            missing.is_empty(),
            "capabilities/default.json 缺少这些命令的授权（前端 invoke 会被拒）：{missing:?}"
        );
    }

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
    fn an_empty_userprofile_falls_back_to_home() {
        // Windows 上设了空 `USERPROFILE` 是常见情形。空值不算候选，`HOME` 应顶上，
        // 而不是让整个解析失败。
        let resolved = home_dir_from(
            Some(OsString::from("")),
            Some(OsString::from("/home/alice")),
        );

        assert_eq!(resolved, Ok("/home/alice".to_string()));
    }

    #[test]
    fn an_empty_value_is_not_a_home_directory() {
        let resolved = home_dir_from(Some(OsString::from("")), None);

        assert_eq!(resolved, Err("无法获取用户主目录".to_string()));
    }

    #[test]
    fn an_empty_home_is_not_a_home_directory_either() {
        let resolved = home_dir_from(None, Some(OsString::from("")));

        assert_eq!(resolved, Err("无法获取用户主目录".to_string()));
    }

    #[test]
    fn neither_variable_set_is_an_error() {
        assert_eq!(
            home_dir_from(None, None),
            Err("无法获取用户主目录".to_string())
        );
    }

    // --- 海报导出：write_binary ---

    /// A unique, empty-ish scratch directory. The tests write into it and leave
    /// the cleanup to the OS: three tiny files are not worth a `tempfile` dep.
    fn scratch_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock before the epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("cc-analyzer-{tag}-{}-{nanos}", std::process::id()))
    }

    #[test]
    fn write_binary_writes_the_decoded_bytes() {
        let dir = scratch_dir("binary-plain");
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        let path = dir.join("poster.png");
        // "PNG!" — short, non-UTF-8-safe as text but valid base64 (`UE5HIQ==`).
        write_binary(path.to_string_lossy().into_owned(), "UE5HIQ==".to_string())
            .expect("write_binary should succeed");

        assert_eq!(std::fs::read(&path).expect("read back"), b"PNG!");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_binary_creates_missing_parent_directories() {
        let dir = scratch_dir("binary-nested");
        let path = dir.join("a").join("b").join("poster.png");
        write_binary(path.to_string_lossy().into_owned(), "UE5HIQ==".to_string())
            .expect("write_binary should create the parents");

        assert!(path.exists(), "nested file should exist");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_binary_rejects_invalid_base64() {
        let dir = scratch_dir("binary-invalid");
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        let path = dir.join("poster.png");
        let error = write_binary(
            path.to_string_lossy().into_owned(),
            "not base64!!".to_string(),
        )
        .expect_err("invalid base64 must not be written");

        assert!(error.starts_with("解码 base64 失败"), "unexpected: {error}");
        assert!(!path.exists(), "a failed decode must not leave a file");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
