//! 归档包导出 / 导入（Issue #152）：把本地会话归档打包成一个加密文件，供跨机器搬运。
//!
//! 容器与加密的契约定稿见 Issue #152 的评论，这里只复述**实现侧**的约束：
//! - **容器 = tar**，包内固定 `manifest.json` + `archive/<项目>/<会话>.jsonl`；
//! - **加密 = age 的口令收件人**（`age::scrypt`，工作因子取库默认值），产物是单文件；
//! - **Rust 只负责**建包、解密、解包到前端指定的临时目录、逐条校验 SHA-256，然后把清单
//!   与解出的文件交回前端。索引语义（新增 / 已存在 / 并列保留）全部留在前端。
//!
//! 安全红线（与 Issue 一致）：
//! - 口令、密钥材料绝不进日志，错误文案也不带口令；
//! - 解包条目路径若是绝对路径、含 `..`、或规范化后逃出临时目录，一律拒绝；
//! - 导入只写临时目录，而临时目录必须在应用数据目录下、目录名以 `import-staging`
//!   开头（同一条校验既守着「只写临时目录」，也守着 `remove_import_staging` 不是
//!   「任意删除」命令）；
//! - 哈希不匹配整体失败，不留半个包。
//!
//! 与平台无关的纯逻辑（清单编解码、路径规范化与越界判定、哈希校验、条目→tar 路径映射、
//! 临时目录校验）都收敛在 [`logic`] 子模块里，加密 / 解密与文件系统 I/O 尽量薄，
//! 这样这些单测在 Linux CI 上都能跑（沿用 #160 的约定，不做 `target_os` 门控）。

use std::{
    fs::File,
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::io_error;

/// 包内清单文件名（Issue #152 的容器格式定稿）。
pub const MANIFEST_NAME: &str = "manifest.json";
/// 包内会话目录名。
pub const ARCHIVE_DIR: &str = "archive";
/// 归档包格式版本，从 1 开始。
pub const FORMAT_VERSION: u32 = 1;
/// 导入临时目录名必须以此为前缀：`remove_import_staging` 的校验依据。
pub const STAGING_PREFIX: &str = "import-staging";

/// 归档条目：导出机器上的原始会话（索引主键）与本地归档副本的对应关系。
///
/// 字段名走 `camelCase` 与前端 `web/src/features/archive` 的类型逐字对齐。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleEntry {
    /// 导出机器上的原始 `~/.claude/projects/.../<会话>.jsonl`（索引主键）。
    pub source_path: String,
    /// 归档目录里的绝对路径（本机）。导出时从这里读字节。
    pub archive_path: String,
    /// 项目目录名，例如 `-repo-demo`。
    pub project_label: String,
    /// 文件名去掉 `.jsonl`。
    pub session_id: String,
    /// 原始大小。
    pub size_bytes: u64,
    /// **原始** mtime（不是归档副本的落盘时间）。
    pub mtime_ms: u64,
}

/// 清单里的条目 = [`BundleEntry`] 加完整性校验值。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    #[serde(flatten)]
    pub entry: BundleEntry,
    /// 会话内容的 SHA-256（base64 编码，不带前缀）。
    pub sha256: String,
}

/// 包内 `manifest.json` 的结构。绝对路径之外不写任何机器相关信息。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleManifest {
    pub format_version: u32,
    /// epoch 毫秒。
    pub exported_at: u64,
    /// 导出时的应用版本，取 `env!("CARGO_PKG_VERSION")`，与 `tauri.conf.json` 保持一致。
    pub app_version: String,
    pub entries: Vec<ManifestEntry>,
}

/// `export_archive_bundle` 的返回值。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    /// 打进包里的条目数。
    pub entries: usize,
    /// 归档包文件的字节数。
    pub bytes: u64,
}

/// 解出来的一条会话：清单条目 + 它在临时目录里的落盘位置。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFile {
    pub entry: BundleEntry,
    pub staged_path: String,
}

/// `import_archive_bundle` 的返回值。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub manifest: BundleManifest,
    pub files: Vec<ImportedFile>,
}

/// 与平台无关的纯逻辑。放在单独子模块里，是为了让全部单测在任何平台上都能跑：
/// CI 的 Rust 作业全在 ubuntu，带了平台门控的逻辑在那边根本不参与编译。
mod logic {
    use std::io::Read;
    use std::path::{Component, Path, PathBuf};

    use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
    use sha2::{Digest, Sha256};

    use super::{BundleManifest, ARCHIVE_DIR, FORMAT_VERSION, STAGING_PREFIX};

    /// 条目在包内的 tar 路径：`archive/<项目>/<会话>.jsonl`。
    pub(super) fn archive_entry_path(
        project_label: &str,
        session_id: &str,
    ) -> Result<String, String> {
        validate_segment(project_label, "项目目录名")?;
        validate_segment(session_id, "会话 ID")?;
        Ok(format!("{ARCHIVE_DIR}/{project_label}/{session_id}.jsonl"))
    }

    /// 单个路径片段：不能为空、不能是 `.`/`..`，也不能夹带路径分隔符——
    /// 否则 `project_label` / `session_id` 就能在包内造出越界条目。
    fn validate_segment(segment: &str, what: &str) -> Result<(), String> {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.contains('/')
            || segment.contains('\\')
            || segment.contains('\0')
        {
            return Err(format!("无效的{what}"));
        }
        Ok(())
    }

    /// 校验 tar 条目路径：只接受普通相对路径，并顺手解析掉 `.`。
    /// 绝对路径、`..`、Windows 盘符 / UNC 前缀一律拒绝——这是本功能的头号安全点。
    pub(super) fn safe_relative_path(raw: &Path) -> Result<PathBuf, String> {
        if raw.is_absolute() {
            return Err("归档条目路径越界（不允许绝对路径）".to_string());
        }
        let mut normalized = PathBuf::new();
        for component in raw.components() {
            match component {
                Component::Normal(segment) => normalized.push(segment),
                Component::CurDir => {}
                Component::ParentDir => {
                    return Err("归档条目路径越界（不允许 .. 片段）".to_string())
                }
                Component::RootDir | Component::Prefix(_) => {
                    return Err("归档条目路径越界（不允许根目录或盘符前缀）".to_string())
                }
            }
        }
        if normalized.as_os_str().is_empty() {
            return Err("归档条目路径为空".to_string());
        }
        Ok(normalized)
    }

    /// 把已校验的相对路径落到 `root` 下，并做一次「仍在 root 之内」的纵深防御。
    ///
    /// 前缀按**路径组件**比较，不做字符串前缀比较——否则 `/data/app` 会错误地
    /// 认为 `/data/app-evil` 在其内部。
    pub(super) fn resolve_under(root: &Path, relative: &Path) -> Result<PathBuf, String> {
        let target = root.join(relative);
        if !is_within(&target, root) {
            return Err("归档条目路径越界（规范化后逃出临时目录）".to_string());
        }
        Ok(target)
    }

    /// `child` 是否位于 `parent` 之内（含相等）。
    pub(super) fn is_within(child: &Path, parent: &Path) -> bool {
        let mut child_components = child.components();
        for parent_component in parent.components() {
            match child_components.next() {
                Some(component) if component == parent_component => {}
                _ => return false,
            }
        }
        true
    }

    /// 词法规范化：解析 `.` 与 `..`，不触碰文件系统（临时目录此刻可能还不存在）。
    pub(super) fn normalize_lexical(path: &Path) -> PathBuf {
        let mut result = PathBuf::new();
        for component in path.components() {
            match component {
                Component::Prefix(prefix) => result.push(prefix.as_os_str()),
                Component::RootDir => result.push(Component::RootDir.as_os_str()),
                Component::CurDir => {}
                Component::ParentDir => {
                    result.pop();
                }
                Component::Normal(segment) => result.push(segment),
            }
        }
        result
    }

    pub(super) fn encode_manifest(manifest: &BundleManifest) -> Result<Vec<u8>, String> {
        serde_json::to_vec_pretty(manifest).map_err(|e| format!("序列化归档包清单失败：{e}"))
    }

    /// 清单解析失败时只给一句中文结论，不回显 serde 的原文（可能夹带内容片段）。
    pub(super) fn decode_manifest(bytes: &[u8]) -> Result<BundleManifest, String> {
        serde_json::from_slice(bytes).map_err(|_| "归档包清单无法解析（可能已损坏）".to_string())
    }

    pub(super) fn validate_manifest(manifest: &BundleManifest) -> Result<(), String> {
        if manifest.format_version != FORMAT_VERSION {
            return Err(format!(
                "不支持的归档包版本（formatVersion={}）",
                manifest.format_version
            ));
        }
        for item in &manifest.entries {
            archive_entry_path(&item.entry.project_label, &item.entry.session_id)?;
            if item.sha256.is_empty() {
                return Err("归档包清单缺少完整性校验值".to_string());
            }
        }
        Ok(())
    }

    /// 会话内容的 SHA-256，base64 编码后写进清单。
    ///
    /// 生产路径一律走 [`sha256_base64_reader`] 的流式版本；这个切片版只给单测做对照。
    #[cfg(test)]
    pub(super) fn sha256_base64(bytes: &[u8]) -> String {
        BASE64_STANDARD.encode(Sha256::digest(bytes))
    }

    /// 流式算哈希，避免把整个会话读进内存。
    pub(super) fn sha256_base64_reader<R: Read>(mut reader: R) -> std::io::Result<String> {
        let mut hasher = Sha256::new();
        std::io::copy(&mut reader, &mut hasher)?;
        Ok(BASE64_STANDARD.encode(hasher.finalize()))
    }

    /// 校验前端传入的临时目录：必须在应用数据目录之内，且目录名以 `import-staging` 开头。
    pub(super) fn validate_staging_dir(
        app_data_dir: &Path,
        staging_dir: &Path,
    ) -> Result<PathBuf, String> {
        let app_data = normalize_lexical(app_data_dir);
        let staging = normalize_lexical(staging_dir);
        // 先挡掉「把应用数据目录本身当临时目录」——那样删除命令会清掉整个数据目录。
        if staging == app_data {
            return Err("临时目录不能是应用数据目录本身".to_string());
        }
        if !is_within(&staging, &app_data) {
            return Err("临时目录必须位于应用数据目录之内".to_string());
        }
        let leaf = staging
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");
        if !leaf.starts_with(STAGING_PREFIX) {
            return Err(format!("临时目录名必须以 {STAGING_PREFIX} 开头"));
        }
        Ok(staging)
    }
}

/// 导出归档包。条目读不到就**明确失败并点名**，绝不静默跳过。
fn export_bundle(
    out_path: &Path,
    password: &str,
    entries: &[BundleEntry],
) -> Result<ExportResult, String> {
    // 第一遍：先算齐所有哈希——清单要写在 tar 的最前面，所以它必须先成形。
    let mut manifest_entries = Vec::with_capacity(entries.len());
    for entry in entries {
        // 条目→tar 路径的映射先校验，越界的 project_label / session_id 直接挡下。
        logic::archive_entry_path(&entry.project_label, &entry.session_id)?;
        let sha256 = hash_archive_copy(Path::new(&entry.archive_path), &entry.session_id)?;
        manifest_entries.push(ManifestEntry {
            entry: entry.clone(),
            sha256,
        });
    }
    let manifest = BundleManifest {
        format_version: FORMAT_VERSION,
        exported_at: now_ms(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        entries: manifest_entries,
    };
    let manifest_bytes = logic::encode_manifest(&manifest)?;

    // 先写同目录下的临时文件，全部成功后再改名——失败不留半个包。
    let temp_path = partial_path(out_path);
    match write_encrypted_bundle(&temp_path, password, &manifest_bytes, entries) {
        Ok(bytes) => {
            if let Err(error) = std::fs::rename(&temp_path, out_path) {
                let _ = std::fs::remove_file(&temp_path);
                return Err(io_error("写入归档包失败", error));
            }
            Ok(ExportResult {
                entries: entries.len(),
                bytes,
            })
        }
        Err(error) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(error)
        }
    }
}

fn hash_archive_copy(path: &Path, session_id: &str) -> Result<String, String> {
    let file =
        File::open(path).map_err(|e| export_entry_error(session_id, "读取归档副本失败", e))?;
    logic::sha256_base64_reader(file)
        .map_err(|e| export_entry_error(session_id, "读取归档副本失败", e))
}

fn export_entry_error(session_id: &str, context: &str, error: std::io::Error) -> String {
    format!(
        "导出失败，会话「{session_id}」：{}",
        io_error(context, error)
    )
}

fn write_encrypted_bundle(
    temp_path: &Path,
    password: &str,
    manifest_bytes: &[u8],
    entries: &[BundleEntry],
) -> Result<u64, String> {
    let file = File::create(temp_path).map_err(|e| io_error("创建归档包失败", e))?;
    let recipient = age::scrypt::Recipient::new(age::secrecy::SecretString::from(password));
    let encryptor =
        age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
            .map_err(|_| "初始化加密失败".to_string())?;
    let writer = encryptor
        .wrap_output(file)
        .map_err(|e| io_error("写入归档包失败", e))?;
    let writer = write_tar(writer, manifest_bytes, entries)?;
    let file = writer.finish().map_err(|e| io_error("写入归档包失败", e))?;
    file.sync_all().map_err(|e| io_error("写入归档包失败", e))?;
    file.metadata()
        .map(|meta| meta.len())
        .map_err(|e| io_error("写入归档包失败", e))
}

/// 把 `manifest.json` 与各 `archive/<项目>/<会话>.jsonl` 依次写进 tar，并把底层 writer 交回。
///
/// 返回泛型 `W` 是为了让导出侧接得住 age 的 `StreamWriter::finish`。
fn write_tar<W: Write>(
    writer: W,
    manifest_bytes: &[u8],
    entries: &[BundleEntry],
) -> Result<W, String> {
    let mut tar = tar::Builder::new(writer);
    append_bytes(&mut tar, MANIFEST_NAME, manifest_bytes, now_ms())?;
    for entry in entries {
        append_entry(&mut tar, entry)?;
    }
    tar.into_inner().map_err(|e| io_error("写入归档包失败", e))
}

fn append_bytes<W: Write>(
    tar: &mut tar::Builder<W>,
    name: &str,
    bytes: &[u8],
    mtime_ms: u64,
) -> Result<(), String> {
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(tar::EntryType::Regular);
    header.set_mode(0o644);
    header.set_size(bytes.len() as u64);
    header.set_mtime(mtime_ms / 1000);
    tar.append_data(&mut header, name, bytes)
        .map_err(|e| io_error("写入归档包失败", e))
}

fn append_entry<W: Write>(tar: &mut tar::Builder<W>, entry: &BundleEntry) -> Result<(), String> {
    let name = logic::archive_entry_path(&entry.project_label, &entry.session_id)?;
    let path = Path::new(&entry.archive_path);
    let mut file = File::open(path)
        .map_err(|e| export_entry_error(&entry.session_id, "读取归档副本失败", e))?;
    let size = file
        .metadata()
        .map_err(|e| export_entry_error(&entry.session_id, "读取归档副本失败", e))?
        .len();
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(tar::EntryType::Regular);
    header.set_mode(0o644);
    header.set_size(size);
    // 用**原始** mtime 落 header：解包方据此还能还原会话真实发生的时间。
    header.set_mtime(entry.mtime_ms / 1000);
    tar.append_data(&mut header, name, &mut file)
        .map_err(|e| io_error("写入归档包失败", e))
}

/// 导入归档包：解密 → 解包到临时目录 → 逐条校验哈希。
///
/// 任何一步失败都会把这个「半个包」从临时目录里清掉。
fn import_bundle(in_path: &Path, password: &str, staging: &Path) -> Result<ImportResult, String> {
    let outcome = extract_and_verify(in_path, password, staging);
    if outcome.is_err() {
        let _ = std::fs::remove_dir_all(staging);
    }
    outcome
}

fn extract_and_verify(
    in_path: &Path,
    password: &str,
    staging: &Path,
) -> Result<ImportResult, String> {
    let file = File::open(in_path).map_err(|e| io_error("打开归档包失败", e))?;
    let identity = age::scrypt::Identity::new(age::secrecy::SecretString::from(password));
    let decryptor = age::Decryptor::new(BufReader::new(file)).map_err(classify_decrypt_error)?;
    let reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(classify_decrypt_error)?;

    std::fs::create_dir_all(staging).map_err(|e| io_error("创建临时目录失败", e))?;
    extract_tar(reader, staging)?;

    let manifest_bytes = std::fs::read(staging.join(MANIFEST_NAME))
        .map_err(|_| "归档包缺少清单文件（可能已损坏）".to_string())?;
    let manifest = logic::decode_manifest(&manifest_bytes)?;
    logic::validate_manifest(&manifest)?;

    let mut files = Vec::with_capacity(manifest.entries.len());
    for item in &manifest.entries {
        let relative =
            logic::archive_entry_path(&item.entry.project_label, &item.entry.session_id)?;
        let staged = logic::resolve_under(staging, Path::new(&relative))?;
        let handle = File::open(&staged)
            .map_err(|_| format!("归档包缺少会话「{}」的内容", item.entry.session_id))?;
        let actual =
            logic::sha256_base64_reader(handle).map_err(|e| io_error("读取解包内容失败", e))?;
        if actual != item.sha256 {
            return Err(format!(
                "归档包内容校验失败：会话「{}」的哈希对不上",
                item.entry.session_id
            ));
        }
        files.push(ImportedFile {
            entry: item.entry.clone(),
            staged_path: staged.to_string_lossy().into_owned(),
        });
    }

    Ok(ImportResult { manifest, files })
}

/// 把解密后的 tar 解包到 `staging`：逐条校验路径，只接受普通文件。
///
/// 目录由我们按需创建；symlink / hardlink / 设备节点一律拒绝——否则条目可以借
/// 链接跳到暂存目录之外。
fn extract_tar<R: Read>(reader: R, staging: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(reader);
    let entries = archive.entries().map_err(describe_read_error)?;
    for entry in entries {
        let mut entry = entry.map_err(describe_read_error)?;
        let relative = logic::safe_relative_path(&entry.path().map_err(describe_read_error)?)?;
        if !entry.header().entry_type().is_file() {
            return Err("归档包含非普通文件条目，已拒绝".to_string());
        }
        let target = logic::resolve_under(staging, &relative)?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| io_error("创建临时目录失败", e))?;
        }
        let mut output = File::create(&target).map_err(|e| io_error("写入解包文件失败", e))?;
        std::io::copy(&mut entry, &mut output).map_err(describe_read_error)?;
    }
    Ok(())
}

/// 删除导入临时目录。校验不通过就拒绝，绝不退回「任意删除」。
fn remove_staging(app_data_dir: &Path, staging_dir: &Path) -> Result<(), String> {
    let staging = logic::validate_staging_dir(app_data_dir, staging_dir)?;
    match std::fs::remove_dir_all(&staging) {
        // 目录已经不在了也算清理成功（幂等）。
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error("删除临时目录失败", error)),
    }
}

/// 把 age 的解密错误翻成人能读的中文。
///
/// **不回显 age 的原始细节**：那些文字会描述密钥材料出了什么问题，没必要给用户看。
fn classify_decrypt_error(error: age::DecryptError) -> String {
    use age::DecryptError;
    match error {
        // 口令不对时 scrypt 解出错误密钥，文件密钥解不开，age 报 DecryptionFailed。
        DecryptError::DecryptionFailed => {
            "口令错误：这个口令打不开归档包（口令无法找回）".to_string()
        }
        // 没有能用的口令收件人——多半也是口令问题，或拿到的是别的工具产出的包。
        DecryptError::NoMatchingKeys | DecryptError::KeyDecryptionFailed => {
            "口令错误，或归档包不是用口令加密的".to_string()
        }
        // 导出机器太快、本机太慢时可能撞上：不是损坏，但本机确实解不开。
        DecryptError::ExcessiveWork { .. } => {
            "归档包的加密强度超出本机允许范围，无法在本机打开".to_string()
        }
        _ => "归档包已损坏或不是有效的归档包".to_string(),
    }
}

/// 解密流 / tar 的读错误。age 在载荷被改坏时报 `InvalidData`、被截断时报
/// `UnexpectedEof`——这两种都归到「包坏了」，与「口令错」区分开。
fn describe_read_error(error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::InvalidData => "归档包已损坏（内容校验未通过）".to_string(),
        std::io::ErrorKind::UnexpectedEof => "归档包不完整（文件被截断）".to_string(),
        _ => io_error("解包归档失败", error),
    }
}

fn partial_path(out_path: &Path) -> PathBuf {
    let mut raw = out_path.as_os_str().to_owned();
    raw.push(".partial");
    PathBuf::from(raw)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn app_data_dir_of(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录：{e}"))
}

#[tauri::command]
pub fn export_archive_bundle(
    out_path: String,
    password: String,
    entries: Vec<BundleEntry>,
) -> Result<ExportResult, String> {
    export_bundle(Path::new(&out_path), &password, &entries)
}

#[tauri::command]
pub fn import_archive_bundle(
    app: tauri::AppHandle,
    in_path: String,
    password: String,
    staging_dir: String,
) -> Result<ImportResult, String> {
    let app_data = app_data_dir_of(&app)?;
    let staging = logic::validate_staging_dir(&app_data, Path::new(&staging_dir))?;
    import_bundle(Path::new(&in_path), &password, &staging)
}

#[tauri::command]
pub fn remove_import_staging(app: tauri::AppHandle, staging_dir: String) -> Result<(), String> {
    let app_data = app_data_dir_of(&app)?;
    remove_staging(&app_data, Path::new(&staging_dir))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        export_bundle, extract_tar, import_bundle, logic, remove_staging, write_tar, BundleEntry,
        BundleManifest, ManifestEntry, FORMAT_VERSION,
    };

    /// 每个用例一个临时目录，`Drop` 时递归清掉；不引入 `tempfile` 依赖。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!(
                "cc-analyzer-archive-{tag}-{}-{nanos}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("创建临时目录");
            TempDir(path)
        }

        fn join(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// 在临时目录里落一份「归档副本」，并造出对应的 [`BundleEntry`]。
    fn archived_session(
        workspace: &TempDir,
        project_label: &str,
        session_id: &str,
        contents: &[u8],
        mtime_ms: u64,
    ) -> BundleEntry {
        let archive_path = workspace.join(&format!("{project_label}-{session_id}.jsonl"));
        fs::write(&archive_path, contents).expect("写归档副本");
        BundleEntry {
            source_path: format!("/home/alice/.claude/projects/{project_label}/{session_id}.jsonl"),
            archive_path: archive_path.to_string_lossy().into_owned(),
            project_label: project_label.to_string(),
            session_id: session_id.to_string(),
            size_bytes: contents.len() as u64,
            mtime_ms,
        }
    }

    #[test]
    fn export_then_import_roundtrips_entries_bytes_and_mtime() {
        let workspace = TempDir::new("roundtrip");
        let entries = vec![
            archived_session(
                &workspace,
                "-repo-demo",
                "sess-a",
                b"{\"type\":\"user\"}\n",
                1_700_000_000_123,
            ),
            archived_session(
                &workspace,
                "-repo-other",
                "sess-b",
                b"line one\nline two\n",
                1_699_999_999_000,
            ),
        ];

        let bundle = workspace.join("bundle.ccabundle");
        let exported = export_bundle(&bundle, "correct horse battery", &entries).expect("导出");
        assert_eq!(exported.entries, 2);
        assert_eq!(exported.bytes, fs::metadata(&bundle).unwrap().len());

        let staging = workspace.join("import-staging-roundtrip");
        let imported = import_bundle(&bundle, "correct horse battery", &staging).expect("导入");

        assert_eq!(imported.manifest.format_version, FORMAT_VERSION);
        assert_eq!(imported.manifest.app_version, env!("CARGO_PKG_VERSION"));
        assert_eq!(imported.files.len(), entries.len());

        for (index, entry) in entries.iter().enumerate() {
            let item = &imported.manifest.entries[index];
            // 「条目 / mtime」逐字一致：sizeBytes 与 mtimeMs 都在 BundleEntry 里。
            assert_eq!(&item.entry, entry, "清单条目应逐字往返一致");
            assert_eq!(item.entry.mtime_ms, entry.mtime_ms);
            assert_eq!(
                item.sha256,
                logic::sha256_base64(&fs::read(&entry.archive_path).unwrap())
            );

            let file = &imported.files[index];
            assert_eq!(file.entry, *entry);
            let expected_staged = staging
                .join("archive")
                .join(&entry.project_label)
                .join(format!("{}.jsonl", entry.session_id));
            assert_eq!(Path::new(&file.staged_path), expected_staged);
            // 「字节」一致：解出来的内容与原始归档副本逐字节相同。
            assert_eq!(
                fs::read(&file.staged_path).unwrap(),
                fs::read(&entry.archive_path).unwrap()
            );
        }
    }

    #[test]
    fn a_wrong_passphrase_fails_without_echoing_the_passphrase() {
        let workspace = TempDir::new("wrongpass");
        let entries = vec![archived_session(
            &workspace,
            "-repo-demo",
            "sess-a",
            b"secret transcript\n",
            1_700_000_000_000,
        )];
        let bundle = workspace.join("bundle.ccabundle");
        export_bundle(&bundle, "the-real-passphrase", &entries).expect("导出");

        let staging = workspace.join("import-staging-wrong");
        let error = import_bundle(&bundle, "not-the-passphrase", &staging).unwrap_err();

        assert!(error.contains("口令"), "口令错应点名口令：{error}");
        assert!(
            !error.contains("the-real-passphrase") && !error.contains("not-the-passphrase"),
            "报错不能回显口令：{error}"
        );
        assert!(!staging.exists(), "失败不应在临时目录留下半个包");
    }

    #[test]
    fn a_tampered_bundle_is_rejected() {
        let workspace = TempDir::new("tamper");
        let entries = vec![archived_session(
            &workspace,
            "-repo-demo",
            "sess-a",
            b"payload that will be flipped\n",
            1_700_000_000_000,
        )];
        let bundle = workspace.join("bundle.ccabundle");
        export_bundle(&bundle, "passphrase", &entries).expect("导出");

        // 翻最后一个字节：一定落在 age 的载荷里，改的是密文而不是头部。
        let mut bytes = fs::read(&bundle).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0x01;
        fs::write(&bundle, &bytes).unwrap();

        let staging = workspace.join("import-staging-tamper");
        let error = import_bundle(&bundle, "passphrase", &staging).unwrap_err();
        assert!(
            error.contains("损坏") || error.contains("不完整"),
            "篡改应被判为损坏：{error}"
        );
        assert!(!staging.exists(), "失败不应在临时目录留下半个包");
    }

    #[test]
    fn a_manifest_hash_that_does_not_match_the_bytes_is_rejected() {
        let workspace = TempDir::new("badhash");
        let entry = archived_session(&workspace, "-repo-demo", "sess-a", b"real payload", 42);
        let manifest = BundleManifest {
            format_version: FORMAT_VERSION,
            exported_at: 0,
            app_version: "test".to_string(),
            entries: vec![ManifestEntry {
                entry: entry.clone(),
                // 故意写一个与内容对不上的哈希。
                sha256: logic::sha256_base64(b"some other bytes"),
            }],
        };

        let bundle = workspace.join("bad-hash.ccabundle");
        write_plain_bundle(
            &bundle,
            "passphrase",
            &manifest,
            std::slice::from_ref(&entry),
        );

        let staging = workspace.join("import-staging-badhash");
        let error = import_bundle(&bundle, "passphrase", &staging).unwrap_err();
        assert!(
            error.contains("校验") || error.contains("哈希"),
            "哈希不匹配应明确失败：{error}"
        );
        assert!(!staging.exists(), "失败不应在临时目录留下半个包");
    }

    #[test]
    fn a_tar_entry_that_escapes_the_staging_dir_is_rejected() {
        // 直接造一个含越界路径的 tar：Builder 会拒绝写 `..`，所以手工拼头部。
        for name in [
            "../evil.jsonl",
            "archive/../../evil.jsonl",
            "/etc/passwd",
            "..",
        ] {
            let payload = plain_tar_with_entry(name, b"oops");
            let workspace = TempDir::new("traversal");
            let staging = workspace.join("stage");

            let error = extract_tar(&payload[..], &staging).unwrap_err();
            assert!(error.contains("越界"), "条目 {name} 应被判越界：{error}");
            assert!(
                !workspace.join("evil.jsonl").exists(),
                "越界条目不能在暂存目录之外落地"
            );
        }
    }

    #[test]
    fn pure_path_guards_reject_absolute_and_parent_segments() {
        for name in ["../evil", "/etc/passwd", "a/../../b", ".."] {
            assert!(
                logic::safe_relative_path(Path::new(name)).is_err(),
                "{name} 应被拒绝"
            );
        }
        assert_eq!(
            logic::safe_relative_path(Path::new("./archive/demo/a.jsonl")).unwrap(),
            PathBuf::from("archive/demo/a.jsonl")
        );
    }

    #[test]
    fn staging_dir_must_live_under_app_data_and_be_prefixed() {
        let app_data = Path::new("/data/cc-analyzer");
        assert!(logic::validate_staging_dir(
            app_data,
            Path::new("/data/cc-analyzer/import-staging-1")
        )
        .is_ok());
        // 逃出应用数据目录
        assert!(
            logic::validate_staging_dir(app_data, Path::new("/data/other/import-staging-1"))
                .is_err()
        );
        assert!(logic::validate_staging_dir(
            app_data,
            Path::new("/data/cc-analyzer/../other/import-staging-1")
        )
        .is_err());
        // 名字前缀不对
        assert!(
            logic::validate_staging_dir(app_data, Path::new("/data/cc-analyzer/tmp-1")).is_err()
        );
        // 就是应用数据目录本身
        assert!(logic::validate_staging_dir(app_data, Path::new("/data/cc-analyzer")).is_err());
    }

    #[test]
    fn remove_staging_only_touches_the_validated_directory() {
        let workspace = TempDir::new("remove");
        let app_data = workspace.join("app-data");
        fs::create_dir_all(&app_data).unwrap();

        // 合规路径：真的删掉。
        let inside = app_data.join("import-staging-ok");
        fs::create_dir_all(inside.join("archive")).unwrap();
        fs::write(inside.join("archive").join("a.jsonl"), b"x").unwrap();
        remove_staging(&app_data, &inside).expect("合规临时目录应被删除");
        assert!(!inside.exists());

        // 目录不存在时幂等成功。
        remove_staging(&app_data, &app_data.join("import-staging-missing"))
            .expect("缺失目录也应成功");

        // 越界路径：拒绝，且原目录原封不动。
        let outside = workspace.join("import-staging-outside");
        fs::create_dir_all(&outside).unwrap();
        let error = remove_staging(&app_data, &outside).unwrap_err();
        assert!(error.contains("应用数据目录"), "{error}");
        assert!(outside.exists(), "越界目录不能在拒绝前就被删掉");
    }

    // --- 测试辅助 ---------------------------------------------------------

    fn write_plain_bundle(
        bundle: &Path,
        password: &str,
        manifest: &BundleManifest,
        entries: &[BundleEntry],
    ) {
        let manifest_bytes = logic::encode_manifest(manifest).expect("序列化清单");
        let mut plain = Vec::new();
        write_tar(&mut plain, &manifest_bytes, entries).expect("写 tar");
        let recipient = age::scrypt::Recipient::new(age::secrecy::SecretString::from(password));
        let encrypted = age::encrypt(&recipient, &plain).expect("加密");
        fs::write(bundle, encrypted).expect("写归档包");
    }

    /// 手工拼一个只含单个越界条目的 tar。`tar::Builder` 会拒绝写 `..`，
    /// 所以这里直接往 512 字节头里写名字，再手算校验和。
    fn plain_tar_with_entry(name: &str, contents: &[u8]) -> Vec<u8> {
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Regular);
        header.set_mode(0o644);
        header.set_size(contents.len() as u64);
        header.set_mtime(0);
        let raw_name = name.as_bytes();
        header.as_old_mut().name[..raw_name.len()].copy_from_slice(raw_name);
        header.set_cksum();

        let mut out = Vec::new();
        out.extend_from_slice(header.as_bytes());
        out.extend_from_slice(contents);
        let padding = (512 - contents.len() % 512) % 512;
        out.extend(std::iter::repeat_n(0u8, padding));
        // 两个全零块，tar 的正常结尾。
        out.extend(std::iter::repeat_n(0u8, 1024));
        out
    }
}
