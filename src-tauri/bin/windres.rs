use std::process::Command;
use std::{env, path::PathBuf};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut filtered = Vec::new();
    let mut skip_next = false;
    for arg in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if arg == "--include-dir" {
            skip_next = true;
            continue;
        }
        filtered.push(arg);
    }
    let own_path = env::current_exe().expect("Cannot locate windres helper");
    let real = env::var_os("LUMISEQ_REAL_WINDRES").map(PathBuf::from).or_else(|| {
        env::split_paths(&env::var_os("PATH")?).map(|dir| dir.join("windres.exe"))
            .find(|file| file.is_file() && file.canonicalize().ok() != own_path.canonicalize().ok())
    }).expect("Install MinGW windres in PATH or set LUMISEQ_REAL_WINDRES.");
    let status = Command::new(real)
        .args(&filtered)
        .status()
        .expect("failed to execute the MinGW windres tool");
    std::process::exit(status.code().unwrap_or(1));
}
