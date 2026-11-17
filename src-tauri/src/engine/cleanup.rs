use std::path::{Path, PathBuf};

use tauri::Manager;

const DOWNLOAD_SESSION_FILE: &str = "download.session";
const ENGINE_STATE_DIR: &str = "state";

fn engine_runtime_paths(data_dir: &Path) -> [PathBuf; 2] {
    [
        data_dir.join(DOWNLOAD_SESSION_FILE),
        data_dir.join("engine").join(ENGINE_STATE_DIR),
    ]
}

fn remove_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
    .map_err(|error| format!("Failed to remove {}: {error}", path.display()))
}

fn clear_runtime_paths(data_dir: &Path) -> Result<(), String> {
    for path in engine_runtime_paths(data_dir) {
        remove_path(&path)?;
    }
    Ok(())
}

pub(crate) fn clear_engine_runtime_state(app: &tauri::AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to get app data directory: {error}"))?;
    clear_runtime_paths(&data_dir)?;
    log::info!("engine: cleared resumable runtime state");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reset_removes_runtime_state_and_preserves_settings() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::create_dir_all(root.join("engine/state")).unwrap();
        std::fs::write(root.join("engine/state/task"), "progress").unwrap();
        std::fs::write(root.join("download.session"), "tasks").unwrap();
        std::fs::write(root.join("config.json"), "{}").unwrap();
        clear_runtime_paths(root).unwrap();
        assert!(!root.join("engine/state").exists());
        assert!(!root.join("download.session").exists());
        assert!(root.join("config.json").exists());
    }
}
