use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::Value;
use std::io::{self, Read};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const ENDPOINT: &str = "https://api.github.com/repos/ky1rie1/Lumiseq/releases?per_page=100&page=1";
const MAX_JSON: usize = 1_048_576;
type ActiveRequest = Option<(String, Arc<AtomicBool>)>;
fn active_request() -> &'static Mutex<ActiveRequest> {
    static ACTIVE: OnceLock<Mutex<ActiveRequest>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(None))
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseResult {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    releases: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    etag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    has_next_page: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_at: Option<u64>,
}
impl ReleaseResult {
    fn status(status: &'static str) -> Self {
        Self {
            status,
            releases: None,
            etag: None,
            has_next_page: None,
            retry_at: None,
        }
    }
}

fn read_bounded(mut reader: impl Read) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take((MAX_JSON + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_JSON {
        return Err(io::Error::new(
            io::ErrorKind::FileTooLarge,
            "Release response exceeds 1 MiB",
        ));
    }
    Ok(bytes)
}
fn stable_version(tag: &str) -> bool {
    let version = tag.strip_prefix('v').unwrap_or(tag);
    let parts: Vec<_> = version.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && (part.len() == 1 || !part.starts_with('0'))
                && part.bytes().all(|c| c.is_ascii_digit())
                && part
                    .parse::<u64>()
                    .is_ok_and(|n| n <= 9_007_199_254_740_991)
        })
}
fn trusted_page(url: &str) -> bool {
    url.strip_prefix("https://github.com/ky1rie1/Lumiseq/releases/tag/")
        .is_some_and(stable_version)
}
fn parse_response(
    status: u16,
    body: &[u8],
    etag: Option<String>,
    next: bool,
    retry: Option<u64>,
) -> ReleaseResult {
    if status == 304 {
        return ReleaseResult::status("notModified");
    }
    if status == 403 || status == 429 {
        let mut result = ReleaseResult::status("rateLimited");
        result.retry_at = retry.or(Some(now_ms() + 86_400_000));
        return result;
    }
    if status == 404 {
        return ReleaseResult::status("notFound");
    }
    if status != 200 {
        return ReleaseResult::status("error");
    }
    let Ok(Value::Array(mut rows)) = serde_json::from_slice::<Value>(body) else {
        return ReleaseResult::status("malformed");
    };
    if rows.len() > 100 {
        return ReleaseResult::status("malformed");
    }
    if rows.iter().any(|row| {
        !row["draft"].is_boolean()
            || !row["prerelease"].is_boolean()
            || !row["tag_name"].is_string()
            || !row["html_url"].is_string()
            || !row["assets"].is_array()
            || !(row["body"].is_string() || row["body"].is_null())
    }) {
        return ReleaseResult::status("malformed");
    }
    for row in &mut rows {
        if let Some(Value::String(body)) = row.get_mut("body") {
            let mut end = body.len().min(32768);
            while !body.is_char_boundary(end) {
                end -= 1;
            }
            body.truncate(end);
        }
    }
    ReleaseResult {
        status: "ok",
        releases: Some(rows),
        etag,
        has_next_page: Some(next),
        retry_at: None,
    }
}
fn query(
    client: &Client,
    endpoint: &str,
    etag: Option<&str>,
    cancelled: &AtomicBool,
) -> ReleaseResult {
    if cancelled.load(Ordering::Relaxed) {
        return ReleaseResult::status("cancelled");
    }
    let mut request = client
        .get(endpoint)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(etag) =
        etag.filter(|value| value.len() <= 512 && !value.chars().any(char::is_control))
    {
        request = request.header("If-None-Match", etag);
    }
    let mut response = match request.send() {
        Ok(response) => response,
        Err(error) => {
            return ReleaseResult::status(if error.is_timeout() {
                "timeout"
            } else if error.is_connect() {
                "offline"
            } else {
                "error"
            })
        }
    };
    let status = response.status().as_u16();
    let header = |name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
    };
    let next = header("link")
        .is_some_and(|value| value.split(',').any(|part| part.contains("rel=\"next\"")));
    let etag = header("etag")
        .filter(|value| value.len() <= 512)
        .map(str::to_owned);
    let retry = header("retry-after")
        .and_then(|value| value.parse::<u64>().ok())
        .map(|seconds| now_ms().saturating_add(seconds.saturating_mul(1000)))
        .or_else(|| {
            header("retry-after")
                .and_then(|value| httpdate::parse_http_date(value).ok())
                .and_then(|date| date.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
        })
        .or_else(|| {
            header("x-ratelimit-reset")
                .and_then(|value| value.parse::<u64>().ok())
                .map(|seconds| seconds.saturating_mul(1000))
        });
    if status != 200 {
        return parse_response(status, &[], etag, next, retry);
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_JSON as u64)
    {
        return ReleaseResult::status("tooLarge");
    }
    let body = match read_bounded(&mut response) {
        Ok(bytes) => bytes,
        Err(error) => {
            return ReleaseResult::status(if error.kind() == io::ErrorKind::FileTooLarge {
                "tooLarge"
            } else if error.kind() == io::ErrorKind::TimedOut
                || error.to_string().contains("timed out")
            {
                "timeout"
            } else {
                "offline"
            })
        }
    };
    if cancelled.load(Ordering::Relaxed) {
        return ReleaseResult::status("cancelled");
    }
    parse_response(status, &body, etag, next, retry)
}
fn public_client() -> Result<Client, reqwest::Error> {
    Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .user_agent(concat!(
            "Lumiseq/",
            env!("CARGO_PKG_VERSION"),
            " release-check"
        ))
        .build()
}
#[tauri::command]
pub async fn check_release(
    etag: Option<String>,
    request_id: String,
) -> Result<ReleaseResult, String> {
    if request_id.len() > 128 {
        return Err("Invalid request id".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = active_request().lock().map_err(|error| error.to_string())?;
        if let Some((_, previous)) = active.take() {
            previous.store(true, Ordering::Relaxed);
        }
        *active = Some((request_id.clone(), cancelled.clone()));
    }
    let result = tauri::async_runtime::spawn_blocking(move || match public_client() {
        Ok(client) => query(&client, ENDPOINT, etag.as_deref(), &cancelled),
        Err(_) => ReleaseResult::status("error"),
    })
    .await
    .map_err(|error| error.to_string());
    if let Ok(mut active) = active_request().lock() {
        if active.as_ref().is_some_and(|(id, _)| id == &request_id) {
            *active = None;
        }
    }
    result
}
#[tauri::command]
pub fn cancel_release_check(request_id: String) {
    if let Ok(active) = active_request().lock() {
        if let Some((id, flag)) = active.as_ref() {
            if id == &request_id {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }
}
#[tauri::command]
pub fn open_release_page(url: String) -> Result<(), String> {
    if !trusted_page(&url) {
        return Err("Only an official stable release page may be opened".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32.exe")
            .arg("url.dll,FileProtocolHandler")
            .arg(url)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("Opening release pages requires Windows".into())
    }
}
#[derive(Serialize)]
pub struct BuildIdentity {
    version: &'static str,
    commit: &'static str,
    channel: &'static str,
    dirty: bool,
}
#[tauri::command]
pub fn get_build_identity() -> BuildIdentity {
    BuildIdentity {
        version: env!("CARGO_PKG_VERSION"),
        commit: env!("LUMISEQ_BUILD_COMMIT"),
        channel: env!("LUMISEQ_BUILD_CHANNEL"),
        dirty: env!("LUMISEQ_BUILD_DIRTY") == "true",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[test]
    fn reader_bounds_streams_without_content_length() {
        assert!(read_bounded(Cursor::new(vec![0; MAX_JSON])).is_ok());
        assert!(read_bounded(Cursor::new(vec![0; MAX_JSON + 1])).is_err());
    }
    #[test]
    fn only_canonical_stable_official_pages_can_open() {
        assert!(trusted_page(
            "https://github.com/ky1rie1/Lumiseq/releases/tag/v0.9.7"
        ));
        for url in [
            "https://github.com:443/ky1rie1/Lumiseq/releases/tag/v0.9.7",
            "https://user@github.com/ky1rie1/Lumiseq/releases/tag/v0.9.7",
            "https://github.com/ky1rie1/Lumiseq/releases/tag/../v0.9.7",
            "https://github.com/ky1rie1/Lumiseq/releases/tag/v0.9.7?x=y",
            "https://github.com/evil/Lumiseq/releases/tag/v0.9.7",
            "https://github.com/ky1rie1/Lumiseq/releases/tag/v0.9.7-beta",
        ] {
            assert!(!trusted_page(url), "{url}");
        }
    }
    #[test]
    fn public_responses_have_distinct_http_and_format_states() {
        assert_eq!(
            parse_response(304, &[], None, false, None).status,
            "notModified"
        );
        assert_eq!(
            parse_response(429, &[], None, false, Some(123)).retry_at,
            Some(123)
        );
        assert_eq!(
            parse_response(404, &[], None, false, None).status,
            "notFound"
        );
        assert_eq!(
            parse_response(200, b"not json", None, false, None).status,
            "malformed"
        );
        assert_eq!(
            parse_response(200, b"[]", None, true, None).has_next_page,
            Some(true)
        );
        assert_eq!(
            parse_response(200, b"{}", None, false, None).status,
            "malformed"
        );
        assert_eq!(
            parse_response(200, b"[{}]", None, false, None).status,
            "malformed"
        );
    }
    fn local_response(response: String, delay: Duration) -> String {
        use std::io::Write;
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request = [0; 4096];
                let _ = stream.read(&mut request);
                std::thread::sleep(delay);
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{address}/")
    }
    #[test]
    fn transport_fixtures_handle_etags_limits_format_and_pagination() {
        let client = Client::builder()
            .timeout(Duration::from_secs(1))
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .build()
            .unwrap();
        let cancelled = AtomicBool::new(false);
        for (headers, body, expected) in [
            ("304 Not Modified\r\n", "", "notModified"),
            (
                "429 Too Many Requests\r\nRetry-After: 120\r\n",
                "",
                "rateLimited",
            ),
            ("200 OK\r\n", "broken", "malformed"),
            (
                "200 OK\r\nLink: <http://ignored.test/>; rel=\"next\"\r\nETag: \"test\"\r\n",
                "[]",
                "ok",
            ),
            ("200 OK\r\nContent-Length: 1048577\r\n", "", "tooLarge"),
        ] {
            let endpoint = local_response(
                format!("HTTP/1.1 {headers}Connection: close\r\n\r\n{body}"),
                Duration::ZERO,
            );
            let result = query(&client, &endpoint, Some("\"test\""), &cancelled);
            assert_eq!(result.status, expected);
            if expected == "rateLimited" {
                assert!(result.retry_at.unwrap() > now_ms() + 100_000);
            }
            if expected == "ok" {
                assert_eq!(result.etag.as_deref(), Some("\"test\""));
                assert_eq!(result.has_next_page, Some(true));
            }
        }
    }
    #[test]
    fn transport_timeout_and_cancellation_are_distinct() {
        let client = Client::builder()
            .timeout(Duration::from_millis(60))
            .no_proxy()
            .build()
            .unwrap();
        let endpoint = local_response(
            "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n[]".into(),
            Duration::from_millis(200),
        );
        assert_eq!(
            query(&client, &endpoint, None, &AtomicBool::new(false)).status,
            "timeout"
        );
        assert_eq!(
            query(&client, &endpoint, None, &AtomicBool::new(true)).status,
            "cancelled"
        );
    }
    #[test]
    #[ignore = "explicit read-only public release query"]
    fn live_public_release_query() {
        let result = query(
            &public_client().unwrap(),
            ENDPOINT,
            None,
            &AtomicBool::new(false),
        );
        println!(
            "BUILD {} {} dirty={}",
            get_build_identity().channel,
            get_build_identity().commit,
            get_build_identity().dirty
        );
        println!(
            "LIVE status={} next={:?} etag={:?}",
            result.status, result.has_next_page, result.etag
        );
        if let Some(rows) = &result.releases {
            for row in rows {
                println!(
                    "RELEASE {} draft={} prerelease={}",
                    row["tag_name"], row["draft"], row["prerelease"]
                );
                if let Some(assets) = row["assets"].as_array() {
                    for asset in assets {
                        println!("ASSET {} {}", asset["name"], asset["browser_download_url"]);
                    }
                }
            }
        }
        assert_eq!(result.status, "ok");
    }
}
