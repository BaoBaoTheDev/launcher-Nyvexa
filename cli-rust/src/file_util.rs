// Atomic file write/copy: write a sibling .tmp, fsync it, then rename over the
// target so a crash/power-loss never leaves a torn destination.

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::Path;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

/// Set FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM on a file so it appears as
/// a "Protected Operating System File" in Explorer (hidden even with "show
/// hidden files" unless "hide protected OS files" is unchecked).
#[cfg(windows)]
pub fn set_protected_os_file(path: &Path) {
    // FILE_ATTRIBUTE_HIDDEN = 0x2, FILE_ATTRIBUTE_SYSTEM = 0x4
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;

    extern "system" {
        fn SetFileAttributesW(lpFileName: *const u16, dwFileAttributes: u32) -> i32;
    }

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        SetFileAttributesW(wide.as_ptr(), FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM);
    }
}

#[cfg(not(windows))]
pub fn set_protected_os_file(_path: &Path) {
    // No-op on non-Windows platforms.
}

fn write_flush_and_publish<F>(path: &Path, writer: F) -> io::Result<()>
where
    F: FnOnce(&mut File) -> io::Result<()>,
{
    let tmp = with_extension_suffix(path, ".tmp");
    let result = (|| {
        {
            let mut f = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&tmp)?;
            writer(&mut f)?;
            // Force data blocks to stable storage before publishing the rename.
            f.sync_all()?;
        }
        // Atomic publish: rename over the target.
        std::fs::rename(&tmp, path)
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

pub fn atomic_write_all_bytes(path: &Path, data: &[u8]) -> io::Result<()> {
    write_flush_and_publish(path, |f| f.write_all(data))?;
    set_protected_os_file(path);
    Ok(())
}

pub fn atomic_copy(source: &Path, dest: &Path) -> io::Result<()> {
    write_flush_and_publish(dest, |f| {
        let mut src = File::open(source)?;
        let mut buf = vec![0u8; 81920];
        loop {
            let n = src.read(&mut buf)?;
            if n == 0 {
                break;
            }
            f.write_all(&buf[..n])?;
        }
        Ok(())
    })?;
    set_protected_os_file(dest);
    Ok(())
}

/// Append a literal suffix (e.g. ".tmp", ".orig", ".bak") to a path's full name.
/// Matches the C# `path + ".tmp"` behavior (not OS extension replacement).
pub fn with_extension_suffix(path: &Path, suffix: &str) -> std::path::PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(suffix);
    std::path::PathBuf::from(s)
}
