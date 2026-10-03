use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let git = |args: &[&str]| Command::new("git").args(args).current_dir(&manifest_dir).output().ok().filter(|output| output.status.success()).and_then(|output| String::from_utf8(output.stdout).ok()).map(|text| text.trim().to_owned());
    let commit = git(&["rev-parse", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let dirty = git(&["status", "--porcelain"]).map_or(true, |status| !status.is_empty());
    let tag = git(&["describe", "--tags", "--exact-match", "HEAD"]).unwrap_or_default();
    let version = env::var("CARGO_PKG_VERSION").unwrap();
    let stable = !dirty && env::var("PROFILE").as_deref() == Ok("release") && (tag == version || tag == format!("v{version}"));
    println!("cargo:rustc-env=LUMISEQ_BUILD_COMMIT={commit}");
    println!("cargo:rustc-env=LUMISEQ_BUILD_DIRTY={dirty}");
    println!("cargo:rustc-env=LUMISEQ_BUILD_CHANNEL={}", if stable { "stable" } else { "development" });
    // Recompute identity for every build, including uncommitted source changes.
    println!("cargo:rerun-if-changed=..");
    let native_lib_dir = PathBuf::from(&manifest_dir).join("native/libraw/lib");
    let gpr_dir = PathBuf::from(&manifest_dir).join("native/gpr");
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").unwrap());

    if native_lib_dir.exists() {
        println!("cargo:rustc-link-search=native={}", out_dir.display());
        println!("cargo:rustc-link-search=native={}", native_lib_dir.display());
        println!("cargo:rerun-if-changed={}", native_lib_dir.join("libraw.a").display());
        println!("cargo:rerun-if-changed={}", gpr_dir.display());
        println!("cargo:rustc-link-search=native={}", gpr_dir.join("lib").display());
        let wrapper_source = PathBuf::from(&manifest_dir).join("src/raw/ffi/libraw_wrapper.cpp");
        let wrapper_header = PathBuf::from(&manifest_dir).join("src/raw/ffi/libraw_wrapper.h");
        let wrapper_object = out_dir.join("libraw_wrapper.o");
        let wrapper_archive = out_dir.join("libraw_wrapper.a");
        println!("cargo:rerun-if-changed={}", wrapper_source.display());
        println!("cargo:rerun-if-changed={}", wrapper_header.display());
        let status = Command::new("g++")
            .arg("-std=c++11")
            .arg("-O2")
            .arg("-I").arg(PathBuf::from(&manifest_dir).join("native/libraw"))
            .arg("-I").arg(gpr_dir.join("include"))
            .arg("-c").arg(&wrapper_source)
            .arg("-o").arg(&wrapper_object)
            .status().expect("MinGW g++ is required to compile the LibRaw wrapper");
        assert!(status.success(), "LibRaw wrapper compilation failed");
        let status = Command::new("ar")
            .arg("crs").arg(&wrapper_archive).arg(&wrapper_object)
            .status().expect("MinGW ar is required to archive the LibRaw wrapper");
        assert!(status.success(), "LibRaw wrapper archive failed");
        println!("cargo:rerun-if-env-changed=LUMISEQ_MINGW_LIB_DIR");
        let compiler_lib = env::var_os("LUMISEQ_MINGW_LIB_DIR").map(PathBuf::from).or_else(|| {
            let output = Command::new("g++").arg("-print-file-name=libstdc++.a").output().ok()?;
            if !output.status.success() { return None; }
            let library = PathBuf::from(String::from_utf8(output.stdout).ok()?.trim());
            if !library.is_file() { return None; }
            library.parent().map(|parent| parent.to_path_buf())
        }).expect("Install MinGW g++ in PATH or set LUMISEQ_MINGW_LIB_DIR to its library directory.");
        println!("cargo:rustc-link-search=native={}", compiler_lib.display());
        println!("cargo:rustc-link-lib=static=raw_wrapper");
        println!("cargo:rustc-link-lib=static=raw");
        println!("cargo:rustc-link-lib=static=gpr");
        println!("cargo:rustc-link-lib=static=stdc++");
    }

    println!("cargo:rustc-link-lib=dylib=crypt32");

    // Compile the helper from source; generated executables do not belong in the repository.
    let helper_source = PathBuf::from(&manifest_dir).join("bin/windres.rs");
    println!("cargo:rerun-if-changed={}", helper_source.display());
    let bin_dir = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("windres-helper");
    std::fs::create_dir_all(&bin_dir).expect("Could not create windres helper directory");
    let status = Command::new(env::var_os("RUSTC").unwrap_or_else(|| "rustc".into()))
        .arg(&helper_source).arg("-O").arg("-o").arg(bin_dir.join("windres.exe"))
        .status().expect("Could not compile windres helper");
    assert!(status.success(), "windres helper compilation failed");
    {
        if let Some(path) = env::var_os("PATH") {
            let mut paths = env::split_paths(&path).collect::<Vec<_>>();
            paths.insert(0, bin_dir);
            if let Ok(new_path) = env::join_paths(paths) {
                env::set_var("PATH", new_path);
            }
        }
    }

    tauri_build::build();
    // Tauri attaches its Common Controls v6 manifest to binaries, but not the lib test
    // harness. The harness also imports TaskDialogIndirect through the dialog plugin.
    let resource = out_dir.join("libresource.a");
    let test_archive = out_dir.join("liblumiseq_test_manifest.a");
    let status = Command::new("ar").arg("crs").arg(&test_archive).arg(&resource)
        .status().expect("MinGW ar is required to package the test manifest");
    assert!(status.success(), "Could not package the test manifest");
    println!("cargo:rustc-link-search=native={}", out_dir.display());
}
