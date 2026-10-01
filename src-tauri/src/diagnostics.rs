//! Startup errors must remain visible in the console-free release application.
use std::io::Write;

pub fn report_fatal(message: &str) {
    let log_path = std::env::var_os("LOCALAPPDATA").map(|base| {
        std::path::PathBuf::from(base)
            .join("AI-Creative-Studio")
            .join("logs")
            .join("startup.log")
    });
    let logged = log_path.as_ref().is_some_and(|path| {
        let Some(parent) = path.parent() else { return false };
        if std::fs::create_dir_all(parent).is_err() { return false; }
        // Bound the startup log so repeated launch failures cannot grow it forever.
        if std::fs::metadata(path).is_ok_and(|meta| meta.len() > 1_048_576) {
            let _ = std::fs::rename(path, path.with_extension("previous.log"));
        }
        std::fs::OpenOptions::new().create(true).append(true).open(path)
            .and_then(|mut file| writeln!(file, "{:?} {message}", std::time::SystemTime::now()))
            .is_ok()
    });
    eprintln!("{message}");
    let details = if logged {
        format!("影序 Studio 未能正常启动。\n\n请尝试重新打开应用。错误详情已写入：\n{}", log_path.unwrap().display())
    } else {
        format!("影序 Studio 未能正常启动。\n\n{message}")
    };
    show_error(&details);
}

#[cfg(windows)]
fn show_error(message: &str) {
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(window: *mut std::ffi::c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
    }
    let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = "影序 Studio".encode_utf16().chain(Some(0)).collect();
    // Both strings are null-terminated and remain alive throughout the synchronous call.
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), 0x10); }
}

#[cfg(not(windows))]
fn show_error(_message: &str) {}
