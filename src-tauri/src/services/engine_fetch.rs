//! Removes hidden fetch tasks and cache files left by earlier application runs.
use crate::engine::EngineState;
use crate::error::AppError;
use crate::services::tasks::{TaskService, TaskServiceState};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const CACHE_DIR: &str = "engine-fetch";

fn running_engine(app: &AppHandle) -> Option<std::sync::Arc<TaskService>> {
    let running = app
        .try_state::<EngineState>()
        .is_some_and(|state| state.is_running());
    if !running {
        return None;
    }
    app.try_state::<TaskServiceState>()
        .map(|state| state.0.clone())
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join(CACHE_DIR))
        .map_err(|error| AppError::Io(format!("Failed to resolve cache directory: {error}")))
}

/// Removes fetches left behind by an earlier run: the engine restores a task
/// that was still running when the application quit, and its directory stays.
pub async fn purge_stale(app: &AppHandle) {
    let (Some(engine), Ok(root)) = (running_engine(app), cache_root(app)) else {
        return;
    };
    let prefix = crate::engine::path_to_safe_string(&root);
    match engine.tell_task_snapshot(true).await {
        Ok(tasks) => {
            for task in tasks.iter().filter(|task| is_under(&task.dir, &prefix)) {
                let _ = engine.force_remove(&task.gid).await;
                let _ = engine.remove_download_result(&task.gid).await;
                log::info!("engine_fetch: removed stale task gid={}", task.gid);
            }
        }
        Err(error) => log::debug!("engine_fetch: stale task scan failed: {error}"),
    }
    let Ok(entries) = std::fs::read_dir(&root) else {
        return;
    };
    let live = engine.tasks.internal_ids().await;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if live.contains(&name) {
            continue;
        }
        if let Err(error) = std::fs::remove_dir_all(entry.path()) {
            log::debug!("engine_fetch: stale directory {name} kept: {error}");
        }
    }
}

fn is_under(dir: &str, root: &str) -> bool {
    let normalize = |value: &str| {
        value
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_lowercase()
    };
    let (dir, root) = (normalize(dir), normalize(root));
    dir == root || dir.starts_with(&format!("{root}/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_tasks_are_matched_by_their_directory() {
        let root = "C:\\Users\\me\\AppData\\Local\\app\\engine-fetch";
        assert!(is_under(
            "C:/Users/me/AppData/Local/app/engine-fetch/0123",
            root
        ));
        assert!(!is_under("C:/Users/me/Downloads", root));
        assert!(!is_under(
            "C:/Users/me/AppData/Local/app/engine-fetch-other",
            root
        ));
    }
}
