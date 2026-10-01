// Release builds are Windows GUI applications and never allocate a console.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lumiseq_lib::run()
}
