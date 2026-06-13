// Ẩn console window trên Windows ở bản release (không hiện CMD khi chạy app)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nyvexa_launcher_lib::run();
}
