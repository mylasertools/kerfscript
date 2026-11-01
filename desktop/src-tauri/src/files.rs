// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

//! The files the page can reach. It never names a path: designs come from the
//! open and save dialogs or from the app's start (a double-clicked file),
//! exports go where the user picks in a save dialog, and libraries are read
//! from the open design's folder and the folders below it, or from its
//! project's kerf_libraries folder. Every read is of a regular .kerf file and
//! has a size limit.

use serde::Serialize;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Window};
use tauri_plugin_dialog::{DialogExt, FilePath, MessageDialogButtons, MessageDialogKind};

/// Largest design or library file, in bytes: the playground's 1,000,000
/// characters at up to 3 bytes each in UTF-8
pub const MAX_FILE: u64 = 3_000_000;
/// Licence files shipped with the app, readable from the About window
const LEGAL: [&str; 5] = [
    "LICENSE",
    "COMMERCIAL-LICENSE.md",
    "THIRD-PARTY-NOTICES.md",
    "THIRD-PARTY-LICENSES.md",
    "OFL.txt",
];

#[derive(Default)]
pub struct Session {
    /// The open design
    design: Option<PathBuf>,
    /// The file the system last asked the app to open, not opened yet. The
    /// window shows one design, so a newer request replaces an older one.
    pending: Option<PathBuf>,
}

pub type State = Mutex<Session>;

pub fn session(pending: Option<PathBuf>) -> State {
    Mutex::new(Session {
        design: None,
        pending,
    })
}

/// A file the system asked the app to open (macOS sends these as events).
#[cfg(target_os = "macos")]
pub fn add_pending(app: &AppHandle, path: PathBuf) {
    app.state::<State>().lock().unwrap().pending = Some(path);
}

#[derive(Serialize)]
pub struct Design {
    /// File name without .kerf, for the title and export names
    name: String,
    text: String,
}

fn name_of(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn too_large(shown: &std::path::Display, max: u64) -> String {
    format!("{shown} is larger than {} MB", max as f64 / 1e6)
}

/// Reads a regular file of at most `max` bytes as UTF-8 text.
pub fn read_bounded(path: &Path, max: u64) -> Result<String, String> {
    let shown = path.display();
    let meta = std::fs::metadata(path).map_err(|e| format!("{shown}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{shown} is not a file"));
    }
    if meta.len() > max {
        return Err(too_large(&shown, max));
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|f| f.take(max + 1).read_to_end(&mut bytes))
        .map_err(|e| format!("{shown}: {e}"))?;
    if bytes.len() as u64 > max {
        return Err(too_large(&shown, max));
    }
    String::from_utf8(bytes).map_err(|_| format!("{shown} is not UTF-8 text"))
}

/// The project a design's folder belongs to, as `kerf render` finds it: the
/// nearest folder at or above it with a kerf.json, and the name kerf.json
/// gives the project
fn project(dir: &Path) -> Option<(PathBuf, Option<String>)> {
    let here = dir.ancestors().find(|d| d.join("kerf.json").is_file())?;
    let name = read_bounded(&here.join("kerf.json"), 1 << 20)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|v| v.get("name")?.as_str().map(str::to_owned));
    Some((here.to_path_buf(), name))
}

/// The file a `use <path>` or `include <path>` names, with or without .kerf,
/// found as `kerf render` finds it: `<name/...>` is a file of the project
/// when the project's kerf.json has that name, or of the installed library in
/// kerf_libraries/name; any other path is in the design's folder or below
/// it. Only .kerf files are read, so a design cannot read other files that
/// happen to be in those folders.
pub fn library_path(design: &Path, path: &str) -> Result<PathBuf, String> {
    let wanted = Path::new(path);
    if wanted
        .components()
        .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(format!(
            "<{path}>: libraries are read from the design's folder and the folders below it"
        ));
    }
    let folder = design
        .parent()
        .ok_or("The design has no folder")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let (root, inside) = match (path.split_once('/'), project(&folder)) {
        (Some((first, rest)), Some((proj, name))) if name.as_deref() == Some(first) => {
            (proj, PathBuf::from(rest))
        }
        (Some((first, _)), Some((proj, _))) if proj.join("kerf_libraries").join(first).is_dir() => {
            (proj.join("kerf_libraries"), wanted.to_path_buf())
        }
        _ => (folder, wanted.to_path_buf()),
    };
    let full = with_extension(root.join(inside), "kerf");
    if !full.is_file() {
        return Err(format!("<{path}> was not found"));
    }
    // A link may point outside the folder, or to a file that is not .kerf
    let real = full.canonicalize().map_err(|e| e.to_string())?;
    if !real.starts_with(&root) {
        return Err(format!("<{path}> is outside the folder it is read from"));
    }
    if !has_extension(&real, "kerf") {
        return Err(format!("<{path}> is not a .kerf file"));
    }
    Ok(real)
}

fn has_extension(path: &Path, ext: &str) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// A file name that ends in `.ext`. Some save dialogs (GTK on Linux) return
/// the name as typed, so the extension is added after it: "box" becomes
/// "box.kerf" and "box.v2" becomes "box.v2.kerf".
fn with_extension(path: PathBuf, ext: &str) -> PathBuf {
    if has_extension(&path, ext) {
        return path;
    }
    let mut name = path.into_os_string();
    name.push(".");
    name.push(ext);
    PathBuf::from(name)
}

fn picked(path: Option<FilePath>) -> Option<PathBuf> {
    path.and_then(|p| p.into_path().ok())
}

fn open(app: &AppHandle, path: PathBuf) -> Result<Design, String> {
    let text = read_bounded(&path, MAX_FILE)?;
    let name = name_of(&path);
    app.state::<State>().lock().unwrap().design = Some(path);
    Ok(Design { name, text })
}

fn design_dir(app: &AppHandle) -> Option<PathBuf> {
    let state = app.state::<State>();
    let design = state.lock().unwrap().design.clone();
    design.and_then(|d| d.parent().map(Path::to_path_buf))
}

/// Runs a function that shows a dialog off the main thread.
async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(app))
        .await
        .map_err(|e| e.to_string())?
}

/// Opens the file the system asked for, if any.
#[tauri::command]
pub fn open_pending(app: AppHandle) -> Result<Option<Design>, String> {
    let next = app.state::<State>().lock().unwrap().pending.take();
    next.map(|path| open(&app, path)).transpose()
}

/// The user kept the open design instead of the file the system asked for.
#[tauri::command]
pub fn clear_pending(app: AppHandle) {
    app.state::<State>().lock().unwrap().pending = None;
}

/// Shows the open dialog and opens the chosen design.
#[tauri::command]
pub async fn open_design(app: AppHandle, window: Window) -> Result<Option<Design>, String> {
    blocking(app, move |app| {
        let mut dialog = app
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("KerfScript", &["kerf"]);
        if let Some(dir) = design_dir(&app) {
            dialog = dialog.set_directory(dir);
        }
        picked(dialog.blocking_pick_file())
            .map(|path| open(&app, path))
            .transpose()
    })
    .await
}

/// Saves the design to its file, or with a save dialog for a new design or
/// Save as. Returns the file's name, or nothing when the dialog was cancelled.
#[tauri::command]
pub async fn save_design(
    app: AppHandle,
    window: Window,
    text: String,
    save_as: bool,
    name: String,
) -> Result<Option<String>, String> {
    blocking(app, move |app| {
        let current = app.state::<State>().lock().unwrap().design.clone();
        let path = match current {
            Some(path) if !save_as => path,
            _ => {
                let mut dialog = app
                    .dialog()
                    .file()
                    .set_parent(&window)
                    .add_filter("KerfScript", &["kerf"])
                    .set_file_name(format!("{name}.kerf"));
                if let Some(dir) = design_dir(&app) {
                    dialog = dialog.set_directory(dir);
                }
                let Some(chosen) = picked(dialog.blocking_save_file()) else {
                    return Ok(None);
                };
                let path = with_extension(chosen.clone(), "kerf");
                // The dialog asked before replacing the file it was given, not
                // one whose name gained .kerf after it closed
                if path != chosen && path.exists() && !replace(&app, &window, &path) {
                    return Ok(None);
                }
                path
            }
        };
        write_whole(&path, text.as_bytes())?;
        let saved = name_of(&path);
        app.state::<State>().lock().unwrap().design = Some(path);
        Ok(Some(saved))
    })
    .await
}

/// Writes a file so that it is never left half written: the data goes to a
/// file next to it, which then takes its place.
fn write_whole(path: &Path, data: &[u8]) -> Result<(), String> {
    let shown = path.display();
    let name = path
        .file_name()
        .ok_or(format!("{shown} is not a file name"))?;
    let mut temp_name = std::ffi::OsString::from(".");
    temp_name.push(name);
    temp_name.push(format!(".{}.tmp", std::process::id()));
    let temp = path.with_file_name(temp_name);
    let written = std::fs::write(&temp, data).and_then(|_| std::fs::rename(&temp, path));
    if written.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    written.map_err(|e| format!("{shown}: {e}"))
}

fn replace(app: &AppHandle, window: &Window, path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    app.dialog()
        .message(format!("{name} already exists. Replace it?"))
        .parent(window)
        .title("Save as")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Replace".into(),
            "Cancel".into(),
        ))
        .blocking_show()
}

/// Saves an export (SVG, DXF or ZIP) where the user picks, starting in the
/// design's folder. Returns false when the dialog was cancelled.
#[tauri::command]
pub async fn export_file(
    app: AppHandle,
    window: Window,
    name: String,
    text: Option<String>,
    bytes: Option<Vec<u8>>,
) -> Result<bool, String> {
    blocking(app, move |app| {
        let ext = Path::new(&name)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let mut dialog = app.dialog().file().set_parent(&window).set_file_name(&name);
        if !ext.is_empty() {
            dialog = dialog.add_filter(ext.to_uppercase(), &[ext.as_str()]);
        }
        if let Some(dir) = design_dir(&app) {
            dialog = dialog.set_directory(dir);
        }
        let Some(chosen) = picked(dialog.blocking_save_file()) else {
            return Ok(false);
        };
        let path = if ext.is_empty() {
            chosen.clone()
        } else {
            with_extension(chosen.clone(), &ext)
        };
        if path != chosen && path.exists() && !replace(&app, &window, &path) {
            return Ok(false);
        }
        let data = bytes.unwrap_or_else(|| text.unwrap_or_default().into_bytes());
        write_whole(&path, &data)?;
        Ok(true)
    })
    .await
}

/// The design is no longer a file on disk (an example was loaded instead).
#[tauri::command]
pub fn forget_design(app: AppHandle) {
    app.state::<State>().lock().unwrap().design = None;
}

/// Reads a library the open design uses.
#[tauri::command]
pub fn read_library(app: AppHandle, path: String) -> Result<String, String> {
    let design = app.state::<State>().lock().unwrap().design.clone();
    let design = design.ok_or("Save the design to use libraries next to it")?;
    read_bounded(&library_path(&design, &path)?, MAX_FILE)
}

/// One of the licence files shipped with the app.
#[tauri::command]
pub fn legal_file(app: AppHandle, name: String) -> Result<String, String> {
    if !LEGAL.contains(&name.as_str()) {
        return Err(format!("{name} is not one of the app's licence files"));
    }
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    read_bounded(&dir.join(name), 4 << 20)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("kerfscript-files-{}", std::process::id()))
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("lib")).unwrap();
        std::fs::write(dir.join("box.kerf"), "use <lib/tab>\n").unwrap();
        std::fs::write(dir.join("lib/tab.kerf"), "module tab() rect(5);\n").unwrap();
        dir
    }

    #[test]
    fn libraries_are_read_from_the_design_folder_and_below() {
        let dir = folder("below");
        let design = dir.join("box.kerf");
        let found = library_path(&design, "lib/tab").unwrap();
        assert!(found.ends_with(Path::new("lib").join("tab.kerf")));
        assert!(library_path(&design, "lib/tab.kerf").is_ok());
        assert!(library_path(&design, "lib/none").is_err());
        // Files that are not .kerf are not read, with or without the extension
        std::fs::write(dir.join("notes.txt"), "secret").unwrap();
        assert!(library_path(&design, "notes.txt").is_err());
        assert!(library_path(&design, "notes").is_err());
    }

    #[test]
    fn libraries_outside_the_design_folder_are_refused() {
        let dir = folder("outside");
        std::fs::write(dir.parent().unwrap().join("secret.kerf"), "x").unwrap();
        let design = dir.join("box.kerf");
        for path in [
            "../secret",
            "lib/../../secret",
            "/etc/passwd",
            "C:/Windows/win.ini",
        ] {
            assert!(library_path(&design, path).is_err(), "{path}");
        }
    }

    #[test]
    fn libraries_are_found_as_kerf_render_finds_them() {
        let dir = folder("project");
        std::fs::write(dir.join("kerf.json"), r#"{ "name": "shelf" }"#).unwrap();
        std::fs::create_dir_all(dir.join("kerf_libraries/feet")).unwrap();
        std::fs::write(
            dir.join("kerf_libraries/feet/feet.kerf"),
            "module feet() {}
",
        )
        .unwrap();
        std::fs::create_dir_all(dir.join("designs/feet")).unwrap();
        std::fs::write(dir.join("designs/feet/other.kerf"), "").unwrap();
        let design = dir.join("designs").join("box.kerf");
        let found = library_path(&design, "feet/feet").unwrap();
        assert!(found.ends_with(Path::new("kerf_libraries").join("feet").join("feet.kerf")));
        // The project's own files by its name, from a design in a folder below
        let own = library_path(&design, "shelf/lib/tab").unwrap();
        assert!(own.ends_with(Path::new("lib").join("tab.kerf")));
        // An installed library's name is not looked up next to the design
        assert!(library_path(&design, "feet/other").is_err());
        assert!(library_path(&design, "feet/../../secret").is_err());
    }

    #[test]
    fn saved_designs_end_in_kerf() {
        for (typed, saved) in [
            ("box", "box.kerf"),
            ("box.kerf", "box.kerf"),
            ("box.KERF", "box.KERF"),
            ("box.v2", "box.v2.kerf"),
        ] {
            assert_eq!(
                with_extension(PathBuf::from(typed), "kerf"),
                PathBuf::from(saved)
            );
        }
    }

    #[test]
    fn whole_writes_replace_the_file_and_leave_nothing_behind() {
        let dir = folder("whole");
        let file = dir.join("box.kerf");
        write_whole(&file, b"rect(1);\n").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "rect(1);\n");
        let names: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names.len(), 2, "{names:?}"); // box.kerf and lib
        assert!(write_whole(&dir.join("none/box.kerf"), b"x").is_err());
    }

    #[test]
    fn reads_are_bounded_and_only_of_regular_files() {
        let dir = folder("bounded");
        let big = dir.join("big.kerf");
        std::fs::write(&big, vec![b'a'; 2048]).unwrap();
        assert!(read_bounded(&big, 1024).unwrap_err().contains("larger"));
        assert_eq!(read_bounded(&big, 4096).unwrap().len(), 2048);
        assert!(read_bounded(&dir.join("lib"), 4096)
            .unwrap_err()
            .contains("not a file"));
        let binary = dir.join("bin.kerf");
        std::fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_bounded(&binary, 4096).unwrap_err().contains("UTF-8"));
    }
}
