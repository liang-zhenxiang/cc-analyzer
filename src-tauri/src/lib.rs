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
mod updater;
// 顶层重导出：generate_handler 以裸名注册，build.rs 的权限清单才能用
// 裸名——带 `::` 的名字会生成 Windows 文件系统非法的权限文件名
// （v0.9.0-beta.1 的 Windows 构建当场拦下）。
use updater::{app_version, check_updates, install_update, relaunch_app};

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

    /// 几何探针脚本：**只收集事实，不含任何断言或阈值**——判定属于测试脚本，
    /// 应用不该携带测试策略。返回一个 JSON 字符串。
    ///
    /// 锚点：`data-probe="gauge"`（仅用于探测的稳定属性；Gauge 的 `aria-label`
    /// 是随读数变化的文案，靠它匹配会在文案改动后**静默失配**），卡片复用既有的
    /// `aria-label="计费窗口"`，记录表复用 `table` / `[data-scroll-hint]` 结构。
    const PROBE_JS: &str = r##"(function () {
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  function boxOf(el) {
    if (!el) return null;
    return {
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      overflowX: getComputedStyle(el).overflowX,
      right: el.getBoundingClientRect().right
    };
  }
  var facts = {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    },
    main: boxOf(document.querySelector('main')),
    elements: [],
    tables: []
  };
  var gauge = document.querySelector("[data-probe='gauge']");
  if (gauge) {
    var card = gauge.closest("[aria-label='计费窗口']");
    facts.elements.push({ name: 'gauge', rect: rectOf(gauge), card: card ? rectOf(card) : null });
  }
  var table = document.querySelector('table');
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
  return JSON.stringify(facts);
})();"##;

    /// 取图线程：默认视图先取一张，然后按 `tabs` 依次点击、每步再取一张。
    /// 每张图都配一份几何探针（若设了 `CCA_GUI_PROBE`），供测试脚本判定布局。
    pub fn spawn(webview: tauri::Webview, out: PathBuf, tabs: Vec<String>, probe: Option<PathBuf>) {
        std::thread::spawn(move || {
            let start = Instant::now();
            std::thread::sleep(Duration::from_millis(SETTLE_MS));
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
                if let Err(err) = webview.eval(click_target_js(tab).as_str()) {
                    eprintln!("gui-capture: 执行点击「{tab}」的脚本失败 {err}");
                    return;
                }
                std::thread::sleep(Duration::from_millis(TAB_SETTLE_MS));
                let pdf = tab_output_path(&out, tabs.len(), tab);
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
                    probe_at(&webview, &probe_output_path(probe, tabs.len(), tab), start);
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
                match std::fs::write(&target, text.as_bytes()) {
                    Ok(()) => {
                        let _ = tx.send(Ok(text.len()));
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

    /// 把目标名安全化成文件名片段：保留字母数字（含中文），其余折叠成单个 `-`。
    /// 与 `scripts/gui-test.sh` 里的 `slug_of` **必须逐字一致**——文件名对不上时
    /// 脚本会一直等不到文件，而那看起来像「取图失败」。
    fn slug_of(value: &str) -> String {
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
    /// 多个目标各用 `-<slug>`，文件名能看出是哪张图。
    fn tab_suffix(count: usize, tab: &str) -> String {
        if count == 1 {
            "-tab".to_string()
        } else {
            format!("-{}", slug_of(tab))
        }
    }

    /// 第 N 张图的输出路径：第一张去掉 `.pdf` 后缀再加 `-tab.pdf` / `-<slug>.pdf`。
    fn tab_output_path(first: &Path, count: usize, tab: &str) -> PathBuf {
        let mut path = first.to_path_buf();
        path.set_extension("");
        path.as_mut_os_string()
            .push(format!("{}.pdf", tab_suffix(count, tab)));
        path
    }

    /// 探针 JSON 的输出路径：文件名规则与取图一致，只是后缀换成 `.json`。
    fn probe_output_path(first: &Path, count: usize, tab: &str) -> PathBuf {
        let mut path = first.to_path_buf();
        path.set_extension("");
        path.as_mut_os_string()
            .push(format!("{}.json", tab_suffix(count, tab)));
        path
    }

    /// 找到目标并点击：优先标签页，其次任意按钮。匹配可取访问名的三种来源——
    /// `aria-label`、`title`、可见文本——所以既能点标签页（文本 / aria-label），
    /// 也能点会话条目（它的 `title` 是 cwd）。`eval` 是单向的（拿不到脚本返回值），
    /// 所以点击结果写进 console：成功与失败各一条，都能在测试脚本收集的应用日志里追查。
    fn click_target_js(target: &str) -> String {
        let escaped = target
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r");
        format!(
            r#"(function () {{
  var wanted = "{escaped}";
  var scopes = [
    document.querySelectorAll('[role="tablist"] button'),
    document.querySelectorAll('button')
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
}
