// src-tauri/src/mcp/server.rs
//! Native Model Context Protocol (MCP) Streamable HTTP Server
//! Listens strictly on localhost (127.0.0.1 or ::1).
//! Dispatches external agent tool requests to the Tauri Document Engine via IPC events.
//! Full lifecycle control: stopped by default, starts on demand, immediate socket release.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

fn is_valid_auth_token(token: &str) -> bool {
    !token.is_empty() && token != "mcp_live_studio_token" && !token.chars().any(char::is_whitespace)
}

fn reject_http(stream: &mut TcpStream, status: &str) -> Result<(), String> {
    let body = serde_json::json!({ "error": status }).to_string();
    let response = format!("HTTP/1.1 {}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", status, body.len(), body);
    stream.write_all(response.as_bytes()).map_err(|error| error.to_string())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct McpServerStatusDto {
    pub running: bool,
    pub port: u16,
    pub bind_address: String,
    pub endpoint: String,
}

#[cfg(test)]
mod security_tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    static SOCKET_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn exchange(request: &str, token: &str) -> (String, usize) {
        let _lock = SOCKET_TEST_LOCK.lock().unwrap();
        let manager = McpServerManager::global();
        let _ = manager.set_auth_token(token.to_string());
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let worker_count = count.clone();
        let worker = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            McpServerManager::handle_http_request(stream, |payload| {
                worker_count.fetch_add(1, Ordering::SeqCst);
                manager.complete_request(payload["id"].as_str().unwrap(), r#"{"jsonrpc":"2.0","id":1,"result":{}}"#.to_string());
                Ok(())
            }).unwrap();
        });
        client.write_all(request.as_bytes()).unwrap();
        client.shutdown(std::net::Shutdown::Write).unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        worker.join().unwrap();
        (response, count.load(Ordering::SeqCst))
    }

    #[test]
    fn browser_origin_cannot_dispatch_authenticated_request() {
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        let request = format!("POST /mcp HTTP/1.1\r\nOrigin: https://untrusted.example\r\nAuthorization: Bearer private-native-token\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
        let (response, dispatches) = exchange(&request, "private-native-token");
        assert!(response.starts_with("HTTP/1.1 403"), "untrusted browser origin must be rejected: {response}");
        assert_eq!(dispatches, 0);
        assert!(!response.contains("Access-Control-Allow-Origin: *"));
    }

    #[test]
    fn oversized_content_length_is_rejected_before_dispatch() {
        let request = "POST /mcp HTTP/1.1\r\nAuthorization: Bearer private-native-token\r\nContent-Length: 1048577\r\n\r\n";
        let (response, dispatches) = exchange(&request, "private-native-token");
        assert!(response.starts_with("HTTP/1.1 413"), "oversized bodies must be rejected");
        assert_eq!(dispatches, 0);
    }

    #[test]
    fn authenticated_native_client_can_dispatch_without_a_browser_origin() {
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        let request = format!("POST /mcp HTTP/1.1\r\nAuthorization: Bearer private-native-token\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
        let (response, dispatches) = exchange(&request, "private-native-token");
        assert!(response.starts_with("HTTP/1.1 200"));
        assert_eq!(dispatches, 1);
    }

    #[test]
    fn rejects_missing_and_public_authentication_tokens() {
        let manager = McpServerManager {
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            auth_token: Arc::new(Mutex::new("private-native-token".to_string())),
            request_counter: AtomicU64::new(1),
            active_server: Arc::new(Mutex::new(None)),
        };
        let _ = manager.set_auth_token(String::new());
        assert_eq!(manager.get_auth_token(), "private-native-token", "empty token must not disable authentication");
        let _ = manager.set_auth_token("mcp_live_studio_token".to_string());
        assert_eq!(manager.get_auth_token(), "private-native-token", "known public token must not authenticate clients");
    }
}

struct RunningServer {
    running: Arc<AtomicBool>,
    port: u16,
    bind_address: String,
    thread_handle: Option<thread::JoinHandle<()>>,
}

pub struct McpServerManager {
    pending_requests: Arc<Mutex<HashMap<String, mpsc::Sender<String>>>>,
    auth_token: Arc<Mutex<String>>,
    request_counter: AtomicU64,
    active_server: Arc<Mutex<Option<RunningServer>>>,
}

impl McpServerManager {
    pub fn global() -> &'static McpServerManager {
        static INSTANCE: OnceLock<McpServerManager> = OnceLock::new();
        INSTANCE.get_or_init(|| {
            let initial_token = std::env::var("STUDIO_AUTH_TOKEN")
                .ok().filter(|token| is_valid_auth_token(token)).unwrap_or_default();
            McpServerManager {
                pending_requests: Arc::new(Mutex::new(HashMap::new())),
                auth_token: Arc::new(Mutex::new(initial_token)),
                request_counter: AtomicU64::new(1),
                active_server: Arc::new(Mutex::new(None)),
            }
        })
    }

    pub fn set_auth_token(&self, token: String) -> Result<(), String> {
        if !is_valid_auth_token(&token) {
            return Err("A private, nonempty MCP authentication token is required".to_string());
        }
        *self.auth_token.lock().map_err(|error| error.to_string())? = token;
        Ok(())
    }

    pub fn get_auth_token(&self) -> String {
        self.auth_token.lock().map(|t| t.clone()).unwrap_or_default()
    }

    pub fn complete_request(&self, id: &str, response: String) -> bool {
        if let Ok(mut pending) = self.pending_requests.lock() {
            if let Some(sender) = pending.remove(id) {
                let _ = sender.send(response);
                return true;
            }
        }
        false
    }

    pub fn get_status(&self) -> McpServerStatusDto {
        if let Ok(active_lock) = self.active_server.lock() {
            if let Some(ref s) = *active_lock {
                let is_running = s.running.load(Ordering::SeqCst);
                return McpServerStatusDto {
                    running: is_running,
                    port: s.port,
                    bind_address: s.bind_address.clone(),
                    endpoint: format!("http://{}:{}/mcp", s.bind_address, s.port),
                };
            }
        }
        McpServerStatusDto {
            running: false,
            port: 18280,
            bind_address: "127.0.0.1".to_string(),
            endpoint: "http://127.0.0.1:18280/mcp".to_string(),
        }
    }

    pub fn start_server(
        &'static self,
        app_handle: AppHandle,
        requested_port: Option<u16>,
        port_mode: Option<String>,
        bind_address: Option<String>,
    ) -> Result<McpServerStatusDto, String> {
        if !is_valid_auth_token(&self.get_auth_token()) {
            return Err("Configure a private MCP authentication token before starting HTTP".to_string());
        }
        let bind_addr = bind_address.unwrap_or_else(|| "127.0.0.1".to_string());
        if bind_addr != "127.0.0.1" && bind_addr != "::1" && bind_addr != "localhost" {
            return Err("Security error: Binding to non-localhost addresses (e.g. 0.0.0.0) is strictly prohibited. Only localhost is permitted.".to_string());
        }
        let canonical_bind: String = if bind_addr == "localhost" { "127.0.0.1".to_string() } else { bind_addr };

        let mut active_lock = self.active_server.lock().map_err(|e| e.to_string())?;

        // If already running, check if port matches
        if let Some(ref s) = *active_lock {
            if s.running.load(Ordering::SeqCst) {
                let current_port = s.port;
                if requested_port.is_none() || requested_port == Some(current_port) {
                    return Ok(McpServerStatusDto {
                        running: true,
                        port: current_port,
                        bind_address: s.bind_address.clone(),
                        endpoint: format!("http://{}:{}/mcp", s.bind_address, current_port),
                    });
                }
            }
        }

        // Stop any currently running instance before restarting
        if let Some(mut old_server) = active_lock.take() {
            old_server.running.store(false, Ordering::SeqCst);
            if let Some(h) = old_server.thread_handle.take() {
                let _ = h.join();
            }
        }

        let mode = port_mode.unwrap_or_else(|| "auto".to_string());
        let preferred_port = requested_port.unwrap_or(18280);

        let (listener, actual_port) = if mode == "fixed" {
            let addr = format!("{}:{}", canonical_bind, preferred_port);
            match TcpListener::bind(&addr) {
                Ok(l) => (l, preferred_port),
                Err(e) => {
                    return Err(format!("PortUnavailable: Port {} is already in use ({})", preferred_port, e));
                }
            }
        } else {
            // Auto mode: try preferred port, then 18281..=18299, then port 0 (OS dynamic)
            let preferred_addr = format!("{}:{}", canonical_bind, preferred_port);
            if let Ok(l) = TcpListener::bind(&preferred_addr) {
                let p = l.local_addr().map(|a| a.port()).unwrap_or(preferred_port);
                (l, p)
            } else {
                let mut bound = None;
                for p in 18281..=18299 {
                    if let Ok(l) = TcpListener::bind(&format!("{}:{}", canonical_bind, p)) {
                        let actual = l.local_addr().map(|a| a.port()).unwrap_or(p);
                        bound = Some((l, actual));
                        break;
                    }
                }
                if let Some(pair) = bound {
                    pair
                } else {
                    let l = TcpListener::bind(&format!("{}:0", canonical_bind))
                        .map_err(|e| format!("PortUnavailable: Failed to bind available localhost port: {}", e))?;
                    let actual = l.local_addr().map(|a| a.port()).unwrap_or(0);
                    (l, actual)
                }
            }
        };

        listener.set_nonblocking(true).map_err(|e| e.to_string())?;

        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();
        let bind_addr_owned = canonical_bind.clone();
        let thread_bind_addr = bind_addr_owned.clone();

        let thread_handle = thread::spawn(move || {
            println!("[MCP Native Server] Listening on http://{}:{}/mcp", thread_bind_addr, actual_port);
            while running_clone.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let _ = stream.set_nonblocking(false);
                        let app = app_handle.clone();
                        thread::spawn(move || {
                            let _ = McpServerManager::handle_client(stream, app);
                        });
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(50));
                    }
                    Err(e) => {
                        eprintln!("[MCP Native Server] Accept error: {}", e);
                        thread::sleep(Duration::from_millis(50));
                    }
                }
            }
            println!("[MCP Native Server] Server stopped on port {}", actual_port);
        });

        *active_lock = Some(RunningServer {
            running,
            port: actual_port,
            bind_address: bind_addr_owned.clone(),
            thread_handle: Some(thread_handle),
        });

        Ok(McpServerStatusDto {
            running: true,
            port: actual_port,
            bind_address: bind_addr_owned.clone(),
            endpoint: format!("http://{}:{}/mcp", bind_addr_owned, actual_port),
        })
    }

    pub fn stop_server(&self) -> Result<McpServerStatusDto, String> {
        let mut active_lock = self.active_server.lock().map_err(|e| e.to_string())?;
        if let Some(mut server) = active_lock.take() {
            server.running.store(false, Ordering::SeqCst);
            if let Some(h) = server.thread_handle.take() {
                let _ = h.join();
            }
            return Ok(McpServerStatusDto {
                running: false,
                port: server.port,
                bind_address: server.bind_address.clone(),
                endpoint: format!("http://{}:{}/mcp", server.bind_address, server.port),
            });
        }
        Ok(McpServerStatusDto {
            running: false,
            port: 18280,
            bind_address: "127.0.0.1".to_string(),
            endpoint: "http://127.0.0.1:18280/mcp".to_string(),
        })
    }

    fn handle_client(stream: TcpStream, app: AppHandle) -> Result<(), String> {
        Self::handle_http_request(stream, |payload| app.emit("mcp_request", payload).map_err(|error| error.to_string()))
    }

    fn handle_http_request(mut stream: TcpStream, dispatch: impl Fn(serde_json::Value) -> Result<(), String>) -> Result<(), String> {
        stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|error| error.to_string())?;
        stream.set_write_timeout(Some(Duration::from_secs(5))).map_err(|error| error.to_string())?;
        let local_port = stream.local_addr().map_err(|error| error.to_string())?.port();
        let stream_clone = stream.try_clone().map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(stream_clone);

        let mut request_line = String::new();
        if std::io::Read::take(&mut reader, 8193).read_line(&mut request_line).is_err() || request_line.is_empty() {
            return Ok(());
        }
        if request_line.len() > 8192 { return reject_http(&mut stream, "431 Request Header Fields Too Large"); }

        let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
        if parts.len() < 2 {
            return Ok(());
        }

        let method = parts[0];
        let path = parts[1];

        let mut content_length: usize = 0;
        let mut auth_header: Option<String> = None;
        let mut origin: Option<String> = None;
        let mut header_bytes = request_line.len();

        loop {
            let mut header_line = String::new();
            if std::io::Read::take(&mut reader, (8193 - header_bytes) as u64).read_line(&mut header_line).is_err() {
                return Ok(());
            }
            header_bytes += header_line.len();
            if header_bytes > 8192 { return reject_http(&mut stream, "431 Request Header Fields Too Large"); }
            let trimmed = header_line.trim();
            if trimmed.is_empty() {
                break;
            }

            if let Some((k, v)) = trimmed.split_once(':') {
                let key = k.trim().to_lowercase();
                let val = v.trim().to_string();
                if key == "content-length" {
                    content_length = match val.parse() {
                        Ok(length) => length,
                        Err(_) => return reject_http(&mut stream, "400 Bad Request"),
                    };
                } else if key == "authorization" {
                    auth_header = Some(val);
                } else if key == "origin" {
                    origin = Some(val);
                }
            }
        }

        if let Some(ref browser_origin) = origin {
            let allowed = [format!("http://127.0.0.1:{}", local_port), format!("http://localhost:{}", local_port), format!("http://[::1]:{}", local_port)];
            if !allowed.contains(browser_origin) { return reject_http(&mut stream, "403 Forbidden"); }
        }
        if content_length > 1_048_576 { return reject_http(&mut stream, "413 Payload Too Large"); }
        let cors_header = origin.map(|value| format!("Access-Control-Allow-Origin: {}\r\nVary: Origin\r\n", value)).unwrap_or_default();

        // 1. Handle CORS pre-flight
        if method == "OPTIONS" {
            let resp = format!("HTTP/1.1 204 No Content\r\n{cors_header}Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nConnection: close\r\n\r\n");
            let _ = stream.write_all(resp.as_bytes());
            return Ok(());
        }

        // 2. Handle /health check
        if path == "/health" && method == "GET" {
            let body = r#"{"status":"ok","app":"AI Creative Studio","version":"0.6.0-alpha","transport":"streamable-http"}"#;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{cors_header}Connection: close\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes());
            return Ok(());
        }

        // 3. Handle /mcp JSON-RPC endpoint
        if path == "/mcp" && method == "POST" {
            let manager = McpServerManager::global();
            let configured_token = manager.get_auth_token();

            {
                let valid = auth_header.as_ref().map_or(false, |h| {
                    let token_part = h.strip_prefix("Bearer ").or_else(|| h.strip_prefix("bearer ")).unwrap_or("");
                    is_valid_auth_token(&configured_token) && token_part == configured_token
                });

                if !valid {
                    let err_body = r#"{"jsonrpc":"2.0","error":{"code":-32000,"message":"Unauthorized: Invalid or missing local MCP Auth Token"}}"#;
                    let resp = format!(
                        "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n{cors_header}Connection: close\r\nContent-Length: {}\r\n\r\n{}",
                        err_body.len(),
                        err_body
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    return Ok(());
                }
            }

            let mut body_bytes = vec![0u8; content_length];
            reader.read_exact(&mut body_bytes).map_err(|e| e.to_string())?;
            let body_str = String::from_utf8_lossy(&body_bytes).to_string();

            let req_id = format!(
                "mcp_{}_{}",
                SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis(),
                manager.request_counter.fetch_add(1, Ordering::SeqCst)
            );

            let (tx, rx) = mpsc::channel();
            if let Ok(mut pending) = manager.pending_requests.lock() {
                pending.insert(req_id.clone(), tx);
            }

            // Emit to frontend document engine
            let payload = serde_json::json!({
                "id": req_id,
                "body": body_str
            });

            if let Err(e) = dispatch(payload) {
                if let Ok(mut pending) = manager.pending_requests.lock() {
                    pending.remove(&req_id);
                }
                let err_body = format!(r#"{{"jsonrpc":"2.0","error":{{"code":-32603,"message":"Failed to dispatch to document engine: {}"}}}}"#, e);
                let resp = format!(
                    "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\n{cors_header}Connection: close\r\nContent-Length: {}\r\n\r\n{}",
                    err_body.len(),
                    err_body
                );
                let _ = stream.write_all(resp.as_bytes());
                return Ok(());
            }

            // Wait for response from frontend (with 30s timeout)
            match rx.recv_timeout(Duration::from_secs(30)) {
                Ok(response_body) => {
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{cors_header}Connection: close\r\nContent-Length: {}\r\n\r\n{}",
                        response_body.len(),
                        response_body
                    );
                    let _ = stream.write_all(resp.as_bytes());
                }
                Err(_) => {
                    if let Ok(mut pending) = manager.pending_requests.lock() {
                        pending.remove(&req_id);
                    }
                    let err_body = r#"{"jsonrpc":"2.0","error":{"code":-32001,"message":"Timeout waiting for studio document engine"}}"#;
                    let resp = format!(
                        "HTTP/1.1 504 Gateway Timeout\r\nContent-Type: application/json\r\n{cors_header}Connection: close\r\nContent-Length: {}\r\n\r\n{}",
                        err_body.len(),
                        err_body
                    );
                    let _ = stream.write_all(resp.as_bytes());
                }
            }

            return Ok(());
        }

        // 4. Default 404
        let not_found = r#"{"error":"Endpoint not found"}"#;
        let resp = format!(
            "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n{cors_header}Connection: close\r\nContent-Length: {}\r\n\r\n{}",
            not_found.len(),
            not_found
        );
        let _ = stream.write_all(resp.as_bytes());
        Ok(())
    }
}
