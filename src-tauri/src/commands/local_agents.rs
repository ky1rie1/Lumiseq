//! Connect the in-app assistant to the user's installed, signed-in agent CLIs.
//! The application passes conversation text to a fresh process. Only Lumiseq's
//! existing tool registry may apply edits returned by the model.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_PROMPT_BYTES: usize = 256 * 1024;
const MAX_STDOUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const MAX_TIMEOUT_MS: u64 = 600_000;
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES: usize = 32 * 1024 * 1024;
const MAX_IMAGES: usize = 16;
// Tool arguments are JSON text because strict structured-output schemas do
// not permit an object with arbitrary keys. normalize_output parses them back
// to objects before the frontend receives the reply.
const RESPONSE_SCHEMA: &str = r#"{"type":"object","properties":{"content":{"type":"string"},"toolCalls":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"arguments":{"type":"string"}},"required":["name","arguments"],"additionalProperties":false}}},"required":["content","toolCalls"],"additionalProperties":false}"#;

static RUNNING: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
static SESSION_SERIAL: AtomicU64 = AtomicU64::new(0);

fn running() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Agent {
    Codex,
    Claude,
    Antigravity,
}

impl Agent {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "codex" => Ok(Self::Codex),
            "claude" => Ok(Self::Claude),
            "antigravity" => Ok(Self::Antigravity),
            _ => Err("不支持的本地 Agent。".into()),
        }
    }
}

struct Launch {
    program: PathBuf,
    script: Option<PathBuf>,
}

fn path_executable(file_names: &[&str]) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for name in file_names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return candidate.canonicalize().ok().or(Some(candidate));
            }
        }
    }
    None
}

#[cfg(windows)]
fn npm_script_path(shim: &Path, script_parts: &[&str]) -> Option<PathBuf> {
    let mut script = shim.parent()?.to_path_buf();
    for part in script_parts {
        script.push(part);
    }
    script.is_file().then_some(script)
}

#[cfg(windows)]
fn npm_js_launch(shim_name: &str, script_parts: &[&str]) -> Option<Launch> {
    let shim = path_executable(&[shim_name])?;
    let script = npm_script_path(&shim, script_parts)?;
    let program = path_executable(&["node.exe"])?;
    Some(Launch {
        program,
        script: Some(script),
    })
}

fn direct_launch(windows_name: &str, unix_name: &str) -> Option<Launch> {
    #[cfg(windows)]
    let name = windows_name;
    #[cfg(not(windows))]
    let name = unix_name;
    let _ = (windows_name, unix_name);
    path_executable(&[name]).map(|program| Launch {
        program,
        script: None,
    })
}

fn find_agent(agent: Agent) -> Result<Launch, String> {
    match agent {
        Agent::Codex => {
            let launch = direct_launch("codex.exe", "codex");
            #[cfg(windows)]
            let launch = launch.or_else(|| {
                npm_js_launch(
                    "codex.cmd",
                    &["node_modules", "@openai", "codex", "bin", "codex.js"],
                )
            });
            launch.ok_or_else(|| "未找到 Codex CLI。请安装官方 codex 命令并登录。".into())
        }
        Agent::Claude => {
            let launch = direct_launch("claude.exe", "claude");
            #[cfg(windows)]
            let launch = launch.or_else(|| {
                npm_js_launch(
                    "claude.cmd",
                    &["node_modules", "@anthropic-ai", "claude-code", "cli.js"],
                )
            });
            launch.ok_or_else(|| "未找到 Claude Code CLI。请安装官方 claude 命令并登录。".into())
        }
        Agent::Antigravity => {
            if let Some(launch) = direct_launch("agy.exe", "agy") {
                return Ok(launch);
            }
            // The Windows npm shim is a .cmd file; invoking it through cmd.exe
            // would interpolate prompt text. Launch its known JS entry point
            // with node.exe and independent argv instead.
            let home = std::env::var_os("USERPROFILE")
                .or_else(|| std::env::var_os("HOME"))
                .ok_or_else(|| "未找到用户目录。".to_string())?;
            let script = PathBuf::from(home)
                .join(".gemini")
                .join("antigravity")
                .join("bin")
                .join("agy.mjs");
            if !script.is_file() {
                return Err("未找到 Antigravity CLI。请安装官方 agy 命令并登录。".into());
            }
            let program = path_executable(&["node.exe", "node"])
                .ok_or_else(|| "Antigravity CLI 需要 Node.js，但未找到 node 命令。".to_string())?;
            Ok(Launch {
                program,
                script: Some(script),
            })
        }
    }
}

fn command_for(launch: &Launch) -> Command {
    let mut command = Command::new(&launch.program);
    hide_console(&mut command);
    if let Some(script) = &launch.script {
        command.arg(script);
    }
    // Preserve the installed client's existing provider routing and credentials.
    command
}

fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    #[cfg(not(windows))]
    let _ = command;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAgentProbe {
    available: bool,
    detail: String,
    vision_support: bool,
    vision_reason: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAgentImage {
    mime_type: String,
    data: String,
    observation_id: Option<String>,
}

#[tauri::command]
pub fn probe_local_agent(agent: String) -> Result<LocalAgentProbe, String> {
    let agent = Agent::parse(&agent)?;
    Ok(match find_agent(agent) {
        Ok(launch) => {
            if agent == Agent::Antigravity && !antigravity_supported(&launch) {
                LocalAgentProbe {
                    available: false,
                    vision_support: false,
                    vision_reason: "Installed Antigravity has no supported safe headless image transport.".into(),
                    detail: "Antigravity CLI 版本过旧，缺少安全沙箱或结构化无界面接口。请更新官方 agy 命令。".into(),
                }
            } else {
                let name = match agent {
                    Agent::Codex => "Codex",
                    Agent::Claude => "Claude Code",
                    Agent::Antigravity => "Antigravity",
                };
                LocalAgentProbe {
                    available: true,
                    vision_support: agent == Agent::Codex && codex_image_supported(&launch, Arc::new(AtomicBool::new(false))),
                    vision_reason: match agent {
                        Agent::Codex => "Image transport requires installed exec --image and the safe output/sandbox interface; installation does not verify model vision or login.".into(),
                        _ => "Local image input unsupported: this connector has no locally verified safe headless image interface.".into(),
                    },
                    detail: format!("已找到 {name} 本地客户端。请确认已在官方客户端登录。"),
                }
            }
        }
        Err(detail) => LocalAgentProbe {
            available: false,
            vision_support: false,
            vision_reason: "Local image input unsupported: CLI is absent.".into(),
            detail,
        },
    })
}

#[tauri::command]
pub fn cancel_local_agent(request_id: String) -> Result<(), String> {
    validate_request_id(&request_id)?;
    if let Some(flag) = running()
        .lock()
        .map_err(|_| "本地 Agent 状态不可用。")?
        .get(&request_id)
    {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn run_local_agent(
    agent: String,
    prompt: String,
    request_id: String,
    timeout_ms: u64,
    images: Option<Vec<LocalAgentImage>>,
) -> Result<String, String> {
    let agent = Agent::parse(&agent)?;
    validate_request_id(&request_id)?;
    if prompt.trim().is_empty() || prompt.len() > MAX_PROMPT_BYTES {
        return Err("Agent 请求为空或超过 256 KiB。".into());
    }
    if !(1_000..=MAX_TIMEOUT_MS).contains(&timeout_ms) {
        return Err("Agent 超时必须在 1 秒到 10 分钟之间。".into());
    }
    let images = images.unwrap_or_default();
    validate_image_budget(
        &images
            .iter()
            .map(image_decoded_size)
            .collect::<Result<Vec<_>, _>>()?,
    )?;
    if !images.is_empty() && agent != Agent::Codex {
        return Err("Local image input unsupported by this connector.".into());
    }
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut requests = running().lock().map_err(|_| "本地 Agent 状态不可用。")?;
        if requests.contains_key(&request_id) {
            return Err("Agent 请求 ID 已被使用。".into());
        }
        requests.insert(request_id.clone(), flag.clone());
    }
    let completed_id = request_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_inner(agent, prompt, timeout_ms, flag, images)
    })
    .await;
    running()
        .lock()
        .map_err(|_| "本地 Agent 状态不可用。")?
        .remove(&completed_id);
    result.map_err(|error| format!("Agent 工作线程失败：{error}"))?
}

fn validate_request_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Agent 请求 ID 无效。".into());
    }
    Ok(())
}

struct SessionDir(PathBuf);

impl SessionDir {
    fn create() -> Result<Self, String> {
        let root = std::env::temp_dir().join("lumiseq-local-agent");
        fs::create_dir_all(&root).map_err(|error| format!("无法创建 Agent 临时目录：{error}"))?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos();
        // Wall clock timestamps can repeat across concurrent requests on Windows.
        let serial = SESSION_SERIAL.fetch_add(1, Ordering::Relaxed);
        let dir = root.join(format!("{}-{stamp}-{serial}", std::process::id()));
        fs::create_dir(&dir).map_err(|error| format!("无法创建 Agent 工作目录：{error}"))?;
        Ok(Self(dir))
    }
}

impl Drop for SessionDir {
    fn drop(&mut self) {
        // Only fixed image names inside this task-owned directory can be made writable.
        // Windows requires clearing READONLY before removing these transient files.
        #[cfg(windows)]
        for index in 1..=MAX_IMAGES {
            for extension in ["png", "jpg"] {
                let path = self.0.join(format!("image-{index}.{extension}"));
                if let Ok(metadata) = fs::symlink_metadata(&path) {
                    if metadata.is_file() && !metadata.file_type().is_symlink() {
                        let mut permissions = metadata.permissions();
                        permissions.set_readonly(false);
                        let _ = fs::set_permissions(&path, permissions);
                    }
                }
            }
        }
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn run_inner(
    agent: Agent,
    prompt: String,
    timeout_ms: u64,
    cancel: Arc<AtomicBool>,
    images: Vec<LocalAgentImage>,
) -> Result<String, String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("Agent 请求已取消。".into());
    }
    validate_images(&images)?;
    let launch = find_agent(agent)?;
    if !images.is_empty()
        && (agent != Agent::Codex || !codex_image_supported(&launch, cancel.clone()))
    {
        return Err("Local image input unsupported by installed CLI.".into());
    }
    if agent == Agent::Antigravity && !antigravity_supported(&launch) {
        return Err(
            "Antigravity CLI 版本过旧，缺少安全沙箱或结构化无界面接口。请更新官方 agy 命令。"
                .into(),
        );
    }
    let session = SessionDir::create()?;
    let image_paths = write_images(&session, &images)?;
    drop(images);
    let mut command = command_for(&launch);
    command
        .current_dir(&session.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let answer_path = session.0.join("answer.txt");
    let schema_path = session.0.join("response-schema.json");
    fs::write(&schema_path, RESPONSE_SCHEMA)
        .map_err(|error| format!("无法准备 Agent 回复格式：{error}"))?;
    let agy_modern = agent == Agent::Antigravity;
    match agent {
        Agent::Codex => {
            let mcp_names = codex_mcp_names(&launch, &session.0, cancel.clone())?;
            verify_codex_mcp_disabled(&launch, &session.0, &mcp_names, cancel.clone())?;
            command.args(codex_exec_image_arguments(
                &schema_path,
                &answer_path,
                &mcp_names,
                &image_paths,
            ));
        }
        Agent::Claude => {
            // --bare disables subscription authentication. Safe mode retains
            // login while disabling custom hooks and MCP configuration.
            command.args([
                "--safe-mode",
                "--tools",
                "",
                "--disallowedTools",
                "*",
                "--disable-slash-commands",
                "--permission-mode",
                "dontAsk",
                "--output-format",
                "json",
                "--json-schema",
                RESPONSE_SCHEMA,
                "-p",
                "Use the Lumiseq chat request provided on standard input. Return only the requested structured response.",
            ]);
        }
        Agent::Antigravity => {
            command.args([
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--json-schema",
                RESPONSE_SCHEMA,
                "--sandbox",
            ]);
        }
    }
    let stdin_text = if agent == Agent::Antigravity {
        format!(
            "{}\n",
            serde_json::json!({"event":"user","message":{"content":prompt}})
        )
    } else {
        prompt
    };
    let output = execute_command(
        command,
        stdin_text,
        Duration::from_millis(timeout_ms),
        cancel,
        MAX_STDOUT_BYTES,
        MAX_STDERR_BYTES,
    )?;
    let final_bytes = if agent == Agent::Codex && answer_path.is_file() {
        if fs::metadata(&answer_path)
            .map_err(|_| "无法读取 Agent 回复。")?
            .len()
            > MAX_STDOUT_BYTES as u64
        {
            return Err("Agent 回复超过安全上限。".into());
        }
        fs::read(&answer_path).map_err(|error| format!("无法读取 Agent 回复：{error}"))?
    } else {
        output
    };
    if final_bytes.len() > MAX_STDOUT_BYTES {
        return Err("Agent 回复超过安全上限。".into());
    }
    let answer = String::from_utf8(final_bytes).map_err(|_| "Agent 回复不是 UTF-8。")?;
    let answer = if agy_modern {
        final_stream_result(&answer)?
    } else {
        answer
    };
    if let Some(reason) = cli_error(&answer) {
        return Err(reason);
    }
    let answer = normalize_output(&answer);
    if answer.trim().is_empty() {
        return Err("Agent 未返回内容。请确认客户端已登录。".into());
    }
    Ok(answer)
}

fn image_decoded_size(image: &LocalAgentImage) -> Result<usize, String> {
    if !["image/png", "image/jpeg"].contains(&image.mime_type.as_str())
        || image.data.is_empty()
        || image.data.len() % 4 != 0
        || image.data.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4
    {
        return Err("Invalid or oversized local image payload.".into());
    }
    let padding = if image.data.ends_with("==") {
        2
    } else if image.data.ends_with('=') {
        1
    } else {
        0
    };
    Ok(image.data.len() / 4 * 3 - padding)
}

fn validate_image_budget(sizes: &[usize]) -> Result<(), String> {
    if sizes.len() > MAX_IMAGES
        || sizes
            .iter()
            .any(|size| *size == 0 || *size > MAX_IMAGE_BYTES)
        || sizes
            .iter()
            .try_fold(0usize, |total, size| total.checked_add(*size))
            .is_none_or(|total| total > MAX_IMAGE_TOTAL_BYTES)
    {
        return Err("Local image payload exceeds count or decoded 32 MiB budget.".into());
    }
    Ok(())
}

fn decode_image(image: &LocalAgentImage) -> Result<Vec<u8>, String> {
    let size = image_decoded_size(image)?;
    let mut decoded = Vec::with_capacity(size);
    let sextet = |byte: u8| -> Result<u8, String> {
        match byte {
            b'A'..=b'Z' => Ok(byte - b'A'),
            b'a'..=b'z' => Ok(byte - b'a' + 26),
            b'0'..=b'9' => Ok(byte - b'0' + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err("Invalid local image base64.".into()),
        }
    };
    for (index, group) in image.data.as_bytes().chunks_exact(4).enumerate() {
        let a = sextet(group[0])?;
        let b = sextet(group[1])?;
        let last = (index + 1) * 4 == image.data.len();
        let c = if group[2] == b'=' && last && group[3] == b'=' {
            0
        } else {
            sextet(group[2])?
        };
        let d = if group[3] == b'=' && last {
            0
        } else {
            sextet(group[3])?
        };
        if group[2] == b'=' && b & 15 != 0 || group[2] != b'=' && group[3] == b'=' && c & 3 != 0 {
            return Err("Invalid local image base64 padding.".into());
        }
        decoded.push(a << 2 | b >> 4);
        if group[2] != b'=' {
            decoded.push(b << 4 | c >> 2);
        }
        if group[3] != b'=' {
            decoded.push(c << 6 | d);
        }
    }
    let format = match image.mime_type.as_str() {
        "image/png" => image::ImageFormat::Png,
        _ => image::ImageFormat::Jpeg,
    };
    if decoded.len() != size || image::guess_format(&decoded).ok() != Some(format) {
        return Err("Local image bytes do not match supported MIME.".into());
    }
    Ok(decoded)
}

fn validate_images(images: &[LocalAgentImage]) -> Result<(), String> {
    validate_image_budget(
        &images
            .iter()
            .map(image_decoded_size)
            .collect::<Result<Vec<_>, _>>()?,
    )?;
    for image in images {
        decode_image(image)?;
    }
    Ok(())
}

fn write_images(session: &SessionDir, images: &[LocalAgentImage]) -> Result<Vec<PathBuf>, String> {
    validate_image_budget(
        &images
            .iter()
            .map(image_decoded_size)
            .collect::<Result<Vec<_>, _>>()?,
    )?;
    let mut paths = Vec::new();
    for (index, image) in images.iter().enumerate() {
        // Observation IDs are evidence references, never paths or filenames.
        let _ = &image.observation_id;
        let extension = if image.mime_type == "image/png" {
            "png"
        } else {
            "jpg"
        };
        let path = session.0.join(format!("image-{}.{extension}", index + 1));
        let bytes = decode_image(image)?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "Unable to create task image file.")?;
        file.write_all(&bytes)
            .map_err(|_| "Unable to write task image file.")?;
        let mut permissions = file
            .metadata()
            .map_err(|_| "Unable to protect task image file.")?
            .permissions();
        permissions.set_readonly(true);
        file.set_permissions(permissions)
            .map_err(|_| "Unable to protect task image file.")?;
        paths.push(path);
    }
    Ok(paths)
}

fn codex_exec_image_arguments(
    schema: &Path,
    answer: &Path,
    names: &[String],
    images: &[PathBuf],
) -> Vec<OsString> {
    let mut args = codex_exec_arguments(schema, answer, names);
    args.pop();
    for image in images {
        args.extend([OsString::from("--image"), image.as_os_str().to_owned()]);
    }
    args.push(OsString::from("-"));
    args
}

fn codex_has_image_support(help: &str) -> bool {
    [
        "--image",
        "--sandbox",
        "--output-schema",
        "--output-last-message",
        "--ephemeral",
    ]
    .iter()
    .all(|flag| help.contains(flag))
}

fn codex_image_supported(launch: &Launch, cancel: Arc<AtomicBool>) -> bool {
    let mut command = command_for(launch);
    command.args(["exec", "--help"]);
    execute_command(
        command,
        String::new(),
        Duration::from_secs(2),
        cancel,
        64 * 1024,
        64 * 1024,
    )
    .ok()
    .is_some_and(|bytes| codex_has_image_support(&String::from_utf8_lossy(&bytes)))
}

fn parse_codex_mcp_names(text: &str) -> Result<Vec<String>, String> {
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|_| "无法解析 Codex MCP 配置列表，已停止连接。".to_string())?;
    let entries = value
        .as_array()
        .ok_or_else(|| "Codex MCP 配置列表格式不受支持，已停止连接。".to_string())?;
    let mut names = Vec::new();
    for entry in entries {
        let name = entry
            .get("name")
            .and_then(|value| value.as_str())
            .filter(|name| {
                !name.is_empty() && name.len() <= 256 && !name.chars().any(char::is_control)
            })
            .ok_or_else(|| "Codex MCP 配置名称无效，已停止连接。".to_string())?;
        if !names.iter().any(|existing| existing == name) {
            names.push(name.to_string());
        }
    }
    Ok(names)
}

fn codex_mcp_names(
    launch: &Launch,
    cwd: &Path,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<String>, String> {
    let mut command = command_for(launch);
    command.current_dir(cwd).args(["mcp", "list", "--json"]);
    let result = execute_command(
        command,
        String::new(),
        Duration::from_secs(10),
        cancel.clone(),
        256 * 1024,
        64 * 1024,
    );
    if cancel.load(Ordering::Relaxed) {
        return Err("Agent 请求已取消。".into());
    }
    // List output can contain private transport settings. Never expose either
    // its stdout or a CLI failure diagnostic to the chat or app logs.
    let bytes = result.map_err(|_| {
        "无法检查 Codex MCP 配置，已停止连接。请在官方 CLI 检查 codex mcp list。".to_string()
    })?;
    let text =
        std::str::from_utf8(&bytes).map_err(|_| "Codex MCP 配置列表编码无效。".to_string())?;
    parse_codex_mcp_names(text)
}

fn codex_exec_arguments(schema: &Path, answer: &Path, mcp_names: &[String]) -> Vec<OsString> {
    let mut args: Vec<OsString> = [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
    ]
    .iter()
    .map(OsString::from)
    .collect();
    for feature in [
        "hooks",
        "shell_tool",
        "unified_exec",
        "plugins",
        "apps",
        "multi_agent",
        "computer_use",
        "browser_use",
        "image_generation",
    ] {
        args.extend([OsString::from("--disable"), OsString::from(feature)]);
    }
    for setting in ["web_search='disabled'", "notify=[]"] {
        args.extend([OsString::from("-c"), OsString::from(setting)]);
    }
    args.extend([
        OsString::from("-c"),
        OsString::from(codex_mcp_override(mcp_names)),
    ]);
    args.extend([
        OsString::from("--output-schema"),
        schema.as_os_str().to_owned(),
        OsString::from("--output-last-message"),
        answer.as_os_str().to_owned(),
        OsString::from("-"),
    ]);
    args
}

fn codex_mcp_override(names: &[String]) -> String {
    // Inline table values preserve dots/quotes in server names. The CLI
    // replaces each table, so provide a valid inert stdio transport as well
    // as enabled=false; an enabled-only table fails config validation.
    let disabled = names
        .iter()
        .map(|name| {
            let quoted = serde_json::to_string(name).expect("serializing a string cannot fail");
            format!("{quoted}={{enabled=false,command=\"lumiseq-disabled-mcp\"}}")
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("mcp_servers={{{disabled}}}")
}

fn codex_mcp_list_is_disabled(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| {
            value.as_array().map(|entries| {
                entries.iter().all(|entry| {
                    entry.get("enabled").and_then(|field| field.as_bool()) == Some(false)
                })
            })
        })
        .unwrap_or(false)
}

fn verify_codex_mcp_disabled(
    launch: &Launch,
    cwd: &Path,
    names: &[String],
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut command = command_for(launch);
    command
        .current_dir(cwd)
        .args(["-c", &codex_mcp_override(names), "mcp", "list", "--json"]);
    let result = execute_command(
        command,
        String::new(),
        Duration::from_secs(10),
        cancel.clone(),
        256 * 1024,
        64 * 1024,
    );
    if cancel.load(Ordering::Relaxed) {
        return Err("Agent 请求已取消。".into());
    }
    let bytes = result.map_err(|_| "无法验证 Codex MCP 隔离配置，已停止连接。".to_string())?;
    if !codex_mcp_list_is_disabled(&String::from_utf8_lossy(&bytes)) {
        return Err("Codex 仍有未关闭的 MCP 服务，已停止连接。".into());
    }
    Ok(())
}

fn execute_command(
    command: Command,
    stdin_text: String,
    timeout: Duration,
    cancel: Arc<AtomicBool>,
    stdout_limit: usize,
    stderr_limit: usize,
) -> Result<Vec<u8>, String> {
    execute_command_capture(
        command,
        stdin_text,
        timeout,
        cancel,
        stdout_limit,
        stderr_limit,
    )
    .map(|(stdout, _)| stdout)
}

fn execute_command_capture(
    mut command: Command,
    stdin_text: String,
    timeout: Duration,
    cancel: Arc<AtomicBool>,
    stdout_limit: usize,
    stderr_limit: usize,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    let job = process_job::Job::new()?;
    #[cfg(windows)]
    command.creation_flags(0x0800_0000 | 0x0000_0004); // NO_WINDOW | SUSPENDED
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动本地 Agent：{error}"))?;
    #[cfg(windows)]
    if let Err(error) = job.assign_and_resume(&child) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    let mut stdin = child.stdin.take().ok_or("无法连接 Agent 输入。")?;
    let writer = std::thread::spawn(move || {
        if !stdin_text.is_empty() {
            let _ = stdin.write_all(stdin_text.as_bytes());
        }
    });
    let overflow = Arc::new(AtomicBool::new(false));
    let stdout = spawn_reader(
        child.stdout.take().ok_or("无法连接 Agent 输出。")?,
        stdout_limit,
        overflow.clone(),
    );
    let stderr = spawn_reader(
        child.stderr.take().ok_or("无法连接 Agent 错误输出。")?,
        stderr_limit,
        overflow.clone(),
    );
    let started = Instant::now();
    let stop_reason = loop {
        if cancel.load(Ordering::Relaxed) {
            break Some("Agent 请求已取消。".to_string());
        }
        if overflow.load(Ordering::Relaxed) {
            break Some("Agent 输出超过安全上限。".to_string());
        }
        if started.elapsed() >= timeout {
            break Some("Agent 请求超时。".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    break Some(format!("Agent 退出，状态码：{}。", status));
                }
                if stdout.is_finished() && stderr.is_finished() && writer.is_finished() {
                    break None;
                }
            }
            Ok(None) => (),
            Err(error) => break Some(format!("Agent 进程状态读取失败：{error}")),
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    // The job owns descendants even after their wrapper process has exited.
    #[cfg(windows)]
    drop(job);
    if stop_reason.is_some() {
        #[cfg(not(windows))]
        terminate_process_tree(&mut child);
    }
    let _ = child.wait();
    let _ = writer.join();
    let output = stdout.join().map_err(|_| "Agent 输出读取失败。")?;
    let error_output = stderr.join().map_err(|_| "Agent 错误输出读取失败。")?;
    // A process can exit before the polling loop observes a full reader pipe.
    // Check after joining readers as well, even when the exit status was zero.
    if overflow.load(Ordering::Relaxed) {
        return Err("Agent 输出超过安全上限。".into());
    }
    if let Some(mut reason) = stop_reason {
        let detail = String::from_utf8_lossy(&error_output);
        if !detail.trim().is_empty() {
            reason.push_str(&format!(
                " {}",
                redact_diagnostic(&detail)
                    .trim()
                    .chars()
                    .rev()
                    .take(500)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<String>()
            ));
        }
        return Err(reason);
    }
    Ok((output, error_output))
}

fn redact_diagnostic(text: &str) -> String {
    text.split_inclusive(char::is_whitespace)
        .map(|part| {
            if let Some(start) = part.find("sk-") {
                format!("{}[redacted] ", &part[..start])
            } else {
                part.to_string()
            }
        })
        .collect()
}

fn final_stream_result(text: &str) -> Result<String, String> {
    for line in text.lines().rev() {
        if let Ok(event) = serde_json::from_str::<serde_json::Value>(line) {
            if event.get("event").and_then(|value| value.as_str()) == Some("result") {
                return event
                    .get("result")
                    .map(|value| value.to_string())
                    .ok_or_else(|| "Antigravity 未返回结果。".to_string());
            }
        }
    }
    Err("Antigravity 未返回结果。请确认客户端已登录。".into())
}

fn antigravity_has_required_features(help: &str) -> bool {
    [
        "--input-format",
        "--output-format",
        "--json-schema",
        "--sandbox",
    ]
    .iter()
    .all(|flag| help.contains(flag))
}

fn antigravity_supported(launch: &Launch) -> bool {
    agent_help(launch).is_some_and(|help| antigravity_has_required_features(&help))
}

fn agent_help(launch: &Launch) -> Option<String> {
    let mut command = command_for(launch);
    command.arg("--help");
    let bytes = execute_command(
        command,
        String::new(),
        Duration::from_secs(2),
        Arc::new(AtomicBool::new(false)),
        64 * 1024,
        64 * 1024,
    )
    .ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(not(windows))]
fn terminate_process_tree(child: &mut Child) {
    let _ = child.kill();
}

#[cfg(windows)]
mod process_job {
    use super::*;
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;

    #[repr(C)]
    #[derive(Default)]
    struct BasicLimits {
        process_time: i64,
        job_time: i64,
        flags: u32,
        min_working_set: usize,
        max_working_set: usize,
        active_processes: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimits {
        basic: BasicLimits,
        io_counters: [u64; 6],
        process_memory: usize,
        job_memory: usize,
        peak_process_memory: usize,
        peak_job_memory: usize,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> *mut c_void;
        fn SetInformationJobObject(
            job: *mut c_void,
            class: i32,
            information: *const c_void,
            length: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtResumeProcess(process: *mut c_void) -> i32;
    }

    pub struct Job(*mut c_void);

    impl Job {
        pub fn new() -> Result<Self, String> {
            // A fresh, unnamed, non-inherited job belongs only to this request.
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err("无法创建 Agent 进程组。".into());
            }
            let job = Self(handle);
            let limits = ExtendedLimits {
                basic: BasicLimits {
                    flags: 0x2000,
                    ..Default::default()
                }, // KILL_ON_JOB_CLOSE
                ..Default::default()
            };
            if unsafe {
                SetInformationJobObject(
                    handle,
                    9,
                    &limits as *const _ as *const c_void,
                    std::mem::size_of::<ExtendedLimits>() as u32,
                )
            } == 0
            {
                return Err("无法配置 Agent 进程组。".into());
            }
            Ok(job)
        }

        pub fn assign_and_resume(&self, child: &Child) -> Result<(), String> {
            // Spawn is suspended so it cannot create an unowned descendant
            // between launch and assignment. Fail closed if assignment fails.
            let process = child.as_raw_handle();
            if unsafe { AssignProcessToJobObject(self.0, process) } == 0 {
                return Err("无法隔离 Agent 进程组。".into());
            }
            if unsafe { NtResumeProcess(process) } < 0 {
                return Err("无法恢复 Agent 进程。".into());
            }
            Ok(())
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

fn spawn_reader<R: Read + Send + 'static>(
    mut input: R,
    limit: usize,
    overflow: Arc<AtomicBool>,
) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            match input.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    if bytes.len() + count > limit {
                        overflow.store(true, Ordering::Relaxed);
                        break;
                    }
                    bytes.extend_from_slice(&chunk[..count]);
                }
            }
        }
        bytes
    })
}

fn normalize_output(text: &str) -> String {
    let trimmed = text.trim();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(structured) = value.get("structured_output") {
            if structured.is_object() {
                return normalize_arguments(structured.clone()).to_string();
            }
        }
        if value.get("content").is_some() || value.get("toolCalls").is_some() {
            return normalize_arguments(value).to_string();
        }
        for key in ["result", "response"] {
            if let Some(content) = value.get(key).and_then(|field| field.as_str()) {
                return normalize_output(content);
            }
        }
    }
    trimmed.to_string()
}

fn normalize_arguments(mut value: serde_json::Value) -> serde_json::Value {
    if let Some(calls) = value
        .get_mut("toolCalls")
        .and_then(|field| field.as_array_mut())
    {
        for call in calls {
            if let Some(raw) = call.get("arguments").and_then(|field| field.as_str()) {
                if let Ok(args) = serde_json::from_str::<serde_json::Value>(raw) {
                    if args.is_object() {
                        call["arguments"] = args;
                    }
                }
            }
        }
    }
    value
}

fn cli_error(text: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(text.trim()).ok()?;
    if value.get("is_error").and_then(|field| field.as_bool()) == Some(true) {
        let detail = value
            .get("result")
            .and_then(|field| field.as_str())
            .unwrap_or("Claude Code 未完成请求。");
        return Some(format!(
            "Agent 错误：{}",
            detail.chars().take(500).collect::<String>()
        ));
    }
    if let Some(status) = value.get("status").and_then(|field| field.as_str()) {
        if status != "SUCCESS" {
            let detail = value
                .get("error")
                .and_then(|field| field.as_str())
                .unwrap_or(status);
            return Some(format!(
                "Agent 错误：{}",
                detail.chars().take(500).collect::<String>()
            ));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_arguments_agree_with_frontend_shared_protocol_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../src/ai/providers/localAgentProtocol.fixture.json"
        ))
        .unwrap();
        let normalized: serde_json::Value =
            serde_json::from_str(&normalize_output(&fixture["raw"].to_string())).unwrap();
        assert_eq!(normalized, fixture["normalized"]);
        let malformed =
            r#"{"content":"","toolCalls":[{"name":"inspect_region","arguments":"{broken"}]}"#;
        let value: serde_json::Value = serde_json::from_str(&normalize_output(malformed)).unwrap();
        assert!(
            value["toolCalls"][0]["arguments"].is_string(),
            "malformed arguments must remain rejectable by the frontend"
        );
    }

    #[test]
    fn concurrent_sessions_have_unique_owned_directories() {
        let barrier = Arc::new(std::sync::Barrier::new(16));
        let threads = (0..16)
            .map(|_| {
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    (0..32)
                        .map(|_| SessionDir::create().unwrap())
                        .collect::<Vec<_>>()
                })
            })
            .collect::<Vec<_>>();
        let sessions = threads
            .into_iter()
            .flat_map(|thread| thread.join().unwrap())
            .collect::<Vec<_>>();
        let paths = sessions
            .iter()
            .map(|session| session.0.clone())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(paths.len(), 512);
        drop(sessions);
        assert!(paths.iter().all(|path| !path.exists()));
    }

    #[test]
    #[ignore = "read-only installed CLI help probe; no authentication or model request"]
    fn installed_connector_image_capability_probe() {
        for name in ["codex", "claude", "antigravity"] {
            let probe = probe_local_agent(name.into()).unwrap();
            println!(
                "{name}: available={}, image_interface={}",
                probe.available, probe.vision_support
            );
        }
    }

    #[test]
    fn only_known_agents_and_safe_request_ids_are_accepted() {
        assert_eq!(Agent::parse("codex").unwrap(), Agent::Codex);
        assert_eq!(Agent::parse("claude").unwrap(), Agent::Claude);
        assert_eq!(Agent::parse("antigravity").unwrap(), Agent::Antigravity);
        assert!(Agent::parse("cmd.exe").is_err());
        assert!(validate_request_id("chat_12-a").is_ok());
        assert!(validate_request_id("../outside").is_err());
        assert!(validate_request_id("").is_err());
    }

    #[test]
    fn returns_only_model_content_from_cli_envelopes() {
        assert_eq!(
            normalize_output(r#"{"result":"{\"content\":\"ok\",\"toolCalls\":[]}"} "#),
            r#"{"content":"ok","toolCalls":[]}"#
        );
        assert_eq!(normalize_output(r#"{"response":"hello"}"#), "hello");
        assert_eq!(
            normalize_output(r#"{"structured_output":{"content":"ready","toolCalls":[]}}"#),
            r#"{"content":"ready","toolCalls":[]}"#
        );
        assert_eq!(
            normalize_output(
                r#"{"content":"","toolCalls":[{"name":"set_exposure","arguments":"{\"ev\":0.5}"}]}"#
            ),
            r#"{"content":"","toolCalls":[{"arguments":{"ev":0.5},"name":"set_exposure"}]}"#
        );
    }

    #[test]
    fn structured_response_schema_is_strict_and_loadable() {
        let schema: serde_json::Value = serde_json::from_str(RESPONSE_SCHEMA).unwrap();
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(
            schema["properties"]["toolCalls"]["items"]["additionalProperties"],
            false
        );
        assert_eq!(
            schema["properties"]["toolCalls"]["items"]["properties"]["arguments"]["type"],
            "string"
        );
    }

    #[test]
    fn cli_error_envelopes_are_not_displayed_as_successful_chat() {
        assert!(cli_error(r#"{"is_error":true,"result":"authentication required"}"#).is_some());
        assert!(cli_error(r#"{"status":"ERROR","error":"quota exceeded"}"#).is_some());
        assert!(cli_error(r#"{"status":"SUCCESS","response":"hello"}"#).is_none());
    }

    #[test]
    fn api_key_diagnostics_are_redacted() {
        assert_eq!(
            redact_diagnostic("Incorrect key: sk-test-secret. Try again."),
            "Incorrect key: [redacted] Try again."
        );
    }

    #[test]
    fn extracts_only_final_antigravity_stream_result() {
        let stream = "{\"event\":\"init\"}\n{\"event\":\"result\",\"result\":{\"status\":\"SUCCESS\",\"response\":\"hello\"}}\n";
        assert_eq!(
            normalize_output(&final_stream_result(stream).unwrap()),
            "hello"
        );
        assert!(final_stream_result("{\"event\":\"init\"}\n").is_err());
    }

    #[test]
    fn command_preserves_existing_agent_environment() {
        let launch = Launch {
            program: PathBuf::from("codex.exe"),
            script: None,
        };
        let command = command_for(&launch);
        // No per-command removal or replacement: std::process inherits the
        // user's environment, including credential and provider-routing vars.
        assert!(command.get_envs().next().is_none());
    }

    #[test]
    fn codex_mcp_parser_only_extracts_valid_names() {
        assert_eq!(parse_codex_mcp_names(r#"[{"name":"my.server","transport":{"private":"ignored"}},{"name":"quoted\"name"}]"#).unwrap(), ["my.server", "quoted\"name"]);
        assert!(parse_codex_mcp_names(r#"{"servers":[]}"#).is_err());
        assert!(parse_codex_mcp_names(r#"[{"name":"bad\nname"}]"#).is_err());
        assert!(parse_codex_mcp_names(r#"[{"url":"private"}]"#).is_err());
        assert!(parse_codex_mcp_names("not json").is_err());
    }

    #[test]
    fn codex_arguments_preserve_config_and_disable_external_operations() {
        let args = codex_exec_arguments(
            Path::new("schema.json"),
            Path::new("answer.txt"),
            &["name.with.dot".into(), "quote\"slash\\".into()],
        );
        let args: Vec<String> = args
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(!args.iter().any(|arg| arg == "--ignore-user-config"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "read-only"]));
        assert!(args.iter().any(|arg| arg == "web_search='disabled'"));
        assert!(args.iter().any(|arg| arg == "notify=[]"));
        assert!(args.iter().any(|arg| arg == "mcp_servers={\"name.with.dot\"={enabled=false,command=\"lumiseq-disabled-mcp\"},\"quote\\\"slash\\\\\"={enabled=false,command=\"lumiseq-disabled-mcp\"}}"));
        for feature in [
            "hooks",
            "shell_tool",
            "unified_exec",
            "plugins",
            "apps",
            "multi_agent",
            "computer_use",
            "browser_use",
            "image_generation",
        ] {
            assert!(args.windows(2).any(|pair| pair == ["--disable", feature]));
        }
    }

    #[test]
    fn antigravity_needs_all_safe_headless_flags() {
        let modern = "--input-format --output-format --json-schema --sandbox";
        assert!(antigravity_has_required_features(modern));
        assert!(!antigravity_has_required_features("-p --prompt"));
        assert!(!antigravity_has_required_features(
            "--input-format --output-format --json-schema"
        ));
        assert!(!antigravity_has_required_features(
            "--input-format --output-format --sandbox"
        ));
    }

    #[test]
    fn codex_disabled_mcp_check_fails_closed() {
        assert!(codex_mcp_list_is_disabled("[]"));
        assert!(codex_mcp_list_is_disabled(
            r#"[{"name":"one","enabled":false}]"#
        ));
        assert!(!codex_mcp_list_is_disabled(
            r#"[{"name":"one","enabled":true}]"#
        ));
        assert!(!codex_mcp_list_is_disabled(r#"[{"name":"one"}]"#));
        assert!(!codex_mcp_list_is_disabled("{}"));
        assert!(!codex_mcp_list_is_disabled("bad json"));
    }

    #[cfg(windows)]
    #[test]
    fn npm_shim_maps_only_to_known_installed_js_entry() {
        let temp = SessionDir::create().unwrap();
        let shim = temp.0.join("claude.cmd");
        let script = temp
            .0
            .join("node_modules")
            .join("@anthropic-ai")
            .join("claude-code")
            .join("cli.js");
        fs::create_dir_all(script.parent().unwrap()).unwrap();
        fs::write(&shim, "ignored").unwrap();
        fs::write(&script, "ignored").unwrap();
        assert_eq!(
            npm_script_path(
                &shim,
                &["node_modules", "@anthropic-ai", "claude-code", "cli.js"]
            ),
            Some(script)
        );
        assert!(npm_script_path(&shim, &["missing.js"]).is_none());
    }

    #[test]
    fn fake_agent_process_entry() {
        let Ok(mode) = std::env::var("LUMISEQ_FAKE_AGENT_MODE") else {
            return;
        };
        match mode.as_str() {
            "read_image" => {
                let bytes = fs::read(std::env::var("LUMISEQ_FAKE_AGENT_IMAGE").unwrap()).unwrap();
                assert_eq!(
                    image::guess_format(&bytes).unwrap(),
                    image::ImageFormat::Png
                );
                println!("image-bytes:{}", bytes.len());
            }
            "echo" => {
                let mut input = String::new();
                std::io::stdin().read_to_string(&mut input).unwrap();
                print!("fake:{input}");
            }
            "sleep" => std::thread::sleep(Duration::from_secs(5)),
            "overflow" => {
                std::io::stdout().write_all(&vec![b'x'; 2048]).unwrap();
                std::io::stdout().flush().unwrap();
                std::thread::sleep(Duration::from_secs(5));
            }
            "fast_overflow" => {
                std::io::stdout().write_all(&vec![b'x'; 2048]).unwrap();
                std::io::stdout().flush().unwrap();
            }
            #[cfg(windows)]
            "spawn_child" => {
                let mut child = fake_command("write_sentinel");
                child
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                child.spawn().unwrap();
                std::thread::sleep(Duration::from_secs(5));
            }
            #[cfg(windows)]
            "exit_with_inherited_pipes" => {
                let mut child = fake_command("sleep");
                child
                    .stdin(Stdio::null())
                    .stdout(Stdio::inherit())
                    .stderr(Stdio::inherit());
                child.spawn().unwrap();
                std::process::exit(0);
            }
            #[cfg(windows)]
            "write_sentinel" => {
                std::thread::sleep(Duration::from_millis(1500));
                fs::write(
                    std::env::var("LUMISEQ_FAKE_AGENT_SENTINEL").unwrap(),
                    b"escaped",
                )
                .unwrap();
            }
            _ => panic!("unknown fake agent mode"),
        }
    }

    fn fake_command(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command.args([
            "--exact",
            "commands::local_agents::tests::fake_agent_process_entry",
            "--nocapture",
        ]);
        command.env("LUMISEQ_FAKE_AGENT_MODE", mode);
        command
    }

    #[test]
    fn fake_agent_launches_and_receives_stdin() {
        let output = execute_command(
            fake_command("echo"),
            "hello".into(),
            Duration::from_secs(5),
            Arc::new(AtomicBool::new(false)),
            4096,
            4096,
        )
        .unwrap();
        assert!(String::from_utf8_lossy(&output).contains("fake:hello"));
    }

    #[test]
    fn fake_agent_cancels_before_completion() {
        let cancel = Arc::new(AtomicBool::new(false));
        let trigger = cancel.clone();
        let thread = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            trigger.store(true, Ordering::Relaxed);
        });
        let result = execute_command(
            fake_command("sleep"),
            String::new(),
            Duration::from_secs(5),
            cancel,
            4096,
            4096,
        );
        thread.join().unwrap();
        assert!(result.unwrap_err().contains("已取消"));
    }

    #[test]
    fn fake_agent_times_out() {
        let result = execute_command(
            fake_command("sleep"),
            String::new(),
            Duration::from_millis(100),
            Arc::new(AtomicBool::new(false)),
            4096,
            4096,
        );
        assert!(result.unwrap_err().contains("超时"));
    }

    #[test]
    fn fake_agent_output_is_capped() {
        let result = execute_command(
            fake_command("overflow"),
            String::new(),
            Duration::from_secs(5),
            Arc::new(AtomicBool::new(false)),
            128,
            4096,
        );
        assert!(result.unwrap_err().contains("安全上限"));
    }

    #[test]
    fn fast_successful_exit_cannot_bypass_output_cap() {
        let result = execute_command(
            fake_command("fast_overflow"),
            String::new(),
            Duration::from_secs(5),
            Arc::new(AtomicBool::new(false)),
            128,
            4096,
        );
        assert!(result.unwrap_err().contains("安全上限"));
    }

    #[cfg(windows)]
    #[test]
    fn timeout_terminates_fake_agent_descendants() {
        let temp = SessionDir::create().unwrap();
        let marker = temp.0.join("escaped.txt");
        let mut command = fake_command("spawn_child");
        command.env("LUMISEQ_FAKE_AGENT_SENTINEL", &marker);
        let result = execute_command(
            command,
            String::new(),
            Duration::from_millis(500),
            Arc::new(AtomicBool::new(false)),
            4096,
            4096,
        );
        assert!(result.unwrap_err().contains("超时"));
        std::thread::sleep(Duration::from_secs(2));
        assert!(
            !marker.exists(),
            "timed-out agent descendant was left running"
        );
    }

    #[cfg(windows)]
    #[test]
    fn exited_wrapper_with_inherited_pipes_still_obeys_timeout() {
        let started = Instant::now();
        let result = execute_command(
            fake_command("exit_with_inherited_pipes"),
            String::new(),
            Duration::from_millis(200),
            Arc::new(AtomicBool::new(false)),
            4096,
            4096,
        );
        assert!(result.unwrap_err().contains("超时"));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "inherited pipe blocked past request deadline"
        );
    }

    #[test]
    #[ignore = "requires an installed and configured Codex CLI; makes a real model request"]
    fn codex_cli_smoke() {
        let answer = run_inner(
            Agent::Codex,
            "Reply with content exactly 'ok' and an empty toolCalls array.".to_string(),
            90_000,
            Arc::new(AtomicBool::new(false)),
            Vec::new(),
        )
        .expect("Codex CLI call failed");
        let value: serde_json::Value = serde_json::from_str(&answer).expect("invalid JSON answer");
        assert!(value["content"].is_string());
        assert_eq!(value["toolCalls"].as_array().map(Vec::len), Some(0));
    }

    #[test]
    #[ignore = "requires an installed and configured Antigravity CLI; makes a real model request"]
    fn antigravity_cli_smoke() {
        let answer = run_inner(
            Agent::Antigravity,
            "Reply with JSON: content is 'ok' and toolCalls is an empty array.".to_string(),
            90_000,
            Arc::new(AtomicBool::new(false)),
            Vec::new(),
        )
        .expect("Antigravity CLI call failed");
        let value: serde_json::Value = serde_json::from_str(&answer).expect("invalid JSON answer");
        assert!(value["content"].is_string());
        assert_eq!(value["toolCalls"].as_array().map(Vec::len), Some(0));
    }
    const TEST_PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5WQAAAAASUVORK5CYII=";

    #[test]
    fn prepared_document_reference_uses_strict_native_attachment_dto() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../src/ai/providers/localAgentReference.fixture.json"
        )).unwrap();
        let images: Vec<LocalAgentImage> = serde_json::from_value(fixture["nativeImages"].clone()).unwrap();
        assert_eq!(serde_json::to_value(&images).unwrap(), fixture["nativeImages"]);
        assert_eq!(images[0].mime_type, "image/png");
        assert_eq!(images[0].data, "YWN0dWFsIHJlZ2lvbg==");
        assert_eq!(images[0].observation_id.as_deref(), Some("observation:reference-document"));
        let mut invalid = fixture["nativeImages"][0].clone();
        invalid["evidence"] = serde_json::json!({"region":{"x":5,"y":6,"width":20,"height":15}});
        assert!(serde_json::from_value::<LocalAgentImage>(invalid).is_err());
    }

    #[test]
    fn image_payload_validation_is_bounded_and_canonical() {
        let image = LocalAgentImage {
            mime_type: "image/png".into(),
            data: TEST_PNG.into(),
            observation_id: Some("../../escape".into()),
        };
        assert!(validate_images(&[image.clone()]).is_ok());
        assert!(validate_images(&vec![image.clone(); 17]).is_err());
        for (mime, data) in [
            ("text/plain", TEST_PNG),
            ("image/png", "aGVsbG8="),
            ("image/png", "aGVsbG8=!"),
            ("image/jpeg", TEST_PNG),
            ("image/png", "AB=="),
        ] {
            assert!(validate_images(&[LocalAgentImage {
                mime_type: mime.into(),
                data: data.into(),
                observation_id: None
            }])
            .is_err());
        }
        let oversized = LocalAgentImage {
            data: "A".repeat((MAX_IMAGE_BYTES / 3 + 1) * 4),
            ..image.clone()
        };
        assert!(validate_images(&[oversized]).is_err());
        // Header-valid synthetic bytes exercise aggregate decoded accounting without large allocations.
        let size = MAX_IMAGE_BYTES;
        assert!(validate_image_budget(&[size, size, size, size]).is_ok());
        assert!(validate_image_budget(&[size, size, size, size, 1]).is_err());
    }

    #[test]
    fn image_files_are_task_owned_and_removed_after_process_success_error_and_cancel() {
        for mode in ["read_image", "sleep", "fast_overflow", "timeout"] {
            let session = SessionDir::create().unwrap();
            let path = session.0.clone();
            let files = write_images(
                &session,
                &[LocalAgentImage {
                    mime_type: "image/png".into(),
                    data: TEST_PNG.into(),
                    observation_id: Some("../../escape".into()),
                }],
            )
            .unwrap();
            assert_eq!(files[0], path.join("image-1.png"));
            assert_eq!(
                image::guess_format(&fs::read(&files[0]).unwrap()).unwrap(),
                image::ImageFormat::Png
            );
            let cancel = Arc::new(AtomicBool::new(false));
            let trigger = cancel.clone();
            let thread = std::thread::spawn(move || {
                if mode == "sleep" {
                    std::thread::sleep(Duration::from_millis(100));
                    trigger.store(true, Ordering::Relaxed);
                }
            });
            let mut command = fake_command(if mode == "timeout" { "sleep" } else { mode });
            command.env("LUMISEQ_FAKE_AGENT_IMAGE", &files[0]);
            let result = execute_command(
                command,
                "request".into(),
                if mode == "timeout" {
                    Duration::from_millis(100)
                } else {
                    Duration::from_secs(5)
                },
                cancel,
                if mode == "fast_overflow" { 128 } else { 4096 },
                4096,
            );
            thread.join().unwrap();
            if mode == "read_image" {
                assert!(String::from_utf8_lossy(&result.unwrap()).contains("image-bytes:"));
            } else {
                assert!(result.is_err())
            }
            drop(session);
            assert!(!path.exists(), "task image directory survived {mode}");
        }
    }

    #[test]
    fn invalid_later_image_cleans_up_already_written_images() {
        let session = SessionDir::create().unwrap();
        let path = session.0.clone();
        let result = write_images(
            &session,
            &[
                LocalAgentImage {
                    mime_type: "image/png".into(),
                    data: TEST_PNG.into(),
                    observation_id: None,
                },
                LocalAgentImage {
                    mime_type: "image/png".into(),
                    data: "aGVsbG8=".into(),
                    observation_id: None,
                },
            ],
        );
        assert!(result.is_err());
        assert!(path.join("image-1.png").exists());
        drop(session);
        assert!(!path.exists());
    }

    #[test]
    fn codex_images_are_independent_argv_before_stdin_prompt() {
        let paths = vec![
            PathBuf::from("C:/task with spaces/image-1.png"),
            PathBuf::from("C:/task/image-2.jpg"),
        ];
        let args =
            codex_exec_image_arguments(Path::new("schema"), Path::new("answer"), &[], &paths);
        let args = args
            .iter()
            .map(|arg| arg.to_string_lossy())
            .collect::<Vec<_>>();
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--image", "C:/task with spaces/image-1.png"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--image", "C:/task/image-2.jpg"]));
        assert_eq!(args.last().unwrap(), "-");
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "read-only"]));
        assert!(codex_has_image_support(
            "--image --sandbox --output-schema --output-last-message --ephemeral"
        ));
        assert!(!codex_has_image_support(
            "--sandbox --output-schema --output-last-message"
        ));
    }
}
