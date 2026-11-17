//! Tauri commands exposing aria2 RPC operations to the frontend.
//!
//! These commands serve as the invoke() transport layer. Each command maps
//! to one or more aria2 RPC methods.

use crate::aria2::types::{Aria2File, Aria2Task};
use crate::database::{Database, DatabaseState};
use crate::error::AppError;
use crate::services::tasks::{TaskService, TaskServiceState};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

/// Fetch task list by type.
#[tauri::command]
pub async fn aria2_fetch_task_list(
    state: State<'_, TaskServiceState>,
    r#type: String,
    limit: Option<i64>,
) -> Result<Vec<Aria2Task>, AppError> {
    let tasks = match r#type.as_str() {
        "all" => state.0.tell_task_snapshot(true).await,
        "active" => state.0.tell_task_snapshot(false).await,
        "waiting" => state.0.tell_waiting(0, limit.unwrap_or(1000)).await,
        _ => state.0.tell_stopped(0, limit.unwrap_or(1000)).await,
    }?;
    Ok(state.0.tasks.visible_tasks(tasks).await)
}

/// Returns a snapshot read after this call; the same snapshot is published
/// as `tasks:snapshot`.
#[tauri::command]
pub async fn tasks_refresh(
    pump: State<'_, std::sync::Arc<crate::services::pump::Pump>>,
) -> Result<crate::services::pump::Snapshot, AppError> {
    Ok((*pump.refresh().await?).clone())
}

/// Keeps the whole file list of the task whose details are open in snapshots.
#[tauri::command]
pub fn tasks_set_detailed(
    pump: State<'_, std::sync::Arc<crate::services::pump::Pump>>,
    gid: Option<String>,
) {
    pump.set_detailed(gid);
}

/// Fetch only active tasks (no waiting).
#[tauri::command]
pub async fn aria2_fetch_active_task_list(
    state: State<'_, TaskServiceState>,
) -> Result<Vec<Aria2Task>, AppError> {
    state.0.tell_active().await
}

/// Fetch a single task's full status by GID.
#[tauri::command]
pub async fn aria2_fetch_task_item(
    state: State<'_, TaskServiceState>,
    gid: String,
) -> Result<Aria2Task, AppError> {
    state.0.tell_status(&gid).await
}

/// Get aria2 engine version and enabled features.
#[tauri::command]
pub async fn aria2_get_version(
    state: State<'_, TaskServiceState>,
) -> Result<serde_json::Value, AppError> {
    state.0.get_version().await
}

/// Get global download statistics.
#[tauri::command]
pub async fn aria2_get_global_stat(
    state: State<'_, TaskServiceState>,
) -> Result<serde_json::Value, AppError> {
    let stat = state.0.get_global_stat().await?;
    serde_json::to_value(&stat).map_err(|e| AppError::Aria2(format!("serialize stat: {e}")))
}

/// Change global aria2 options at runtime.
#[tauri::command]
pub async fn aria2_change_global_option(
    state: State<'_, TaskServiceState>,
    options: serde_json::Map<String, serde_json::Value>,
) -> Result<String, AppError> {
    state.0.change_global_option(options).await
}

/// Get per-task options.
#[tauri::command]
pub async fn aria2_get_option(
    state: State<'_, TaskServiceState>,
    gid: String,
) -> Result<serde_json::Value, AppError> {
    state.0.get_option(&gid).await
}

/// Change per-task options.
#[tauri::command]
pub async fn aria2_change_option(
    state: State<'_, TaskServiceState>,
    gid: String,
    options: serde_json::Value,
) -> Result<String, AppError> {
    let changes_media = options.as_object().is_some_and(|values| {
        values
            .keys()
            .any(|key| key == "media" || key.starts_with("media-"))
    });
    if changes_media {
        let task = state.0.tell_status(&gid).await?;
        if task.media.is_some() && task.status != "paused" {
            return Err(AppError::Aria2(
                "Pause media before changing its selection".into(),
            ));
        }
    }
    state.0.change_option(&gid, options).await
}

/// Get file list for a task.
#[tauri::command]
pub async fn aria2_get_files(
    state: State<'_, TaskServiceState>,
    gid: String,
) -> Result<Vec<Aria2File>, AppError> {
    state.0.get_files(&gid).await
}

/// Where a task's source leads after redirects, if anywhere else (#730).
#[tauri::command]
pub async fn aria2_get_redirect_target(
    state: State<'_, TaskServiceState>,
    gid: String,
) -> Result<Option<String>, AppError> {
    state.0.redirect_target(&gid).await
}

/// Moves an unfinished download to another directory (#696).
#[tauri::command]
pub async fn aria2_move_download(
    state: State<'_, TaskServiceState>,
    gid: String,
    dir: String,
) -> Result<String, AppError> {
    if !std::path::Path::new(&dir).is_absolute() {
        return Err(AppError::InvalidInput("Choose a folder to move to".into()));
    }
    state.0.move_download(&gid, &dir).await
}

/// A task that already downloads, or downloaded, one of the requested URIs.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateTask {
    uri: String,
    gid: String,
    name: String,
    status: String,
}

fn without_fragment(uri: &str) -> &str {
    let uri = uri.trim();
    uri.split_once('#').map_or(uri, |(base, _)| base)
}

/// Finds tasks for `uris`: unfinished ones and those downloaded before, even
/// when their files have since been moved or deleted (#545).
#[tauri::command]
pub async fn tasks_find_duplicates(
    state: State<'_, TaskServiceState>,
    history: State<'_, DatabaseState>,
    uris: Vec<String>,
) -> Result<Vec<DuplicateTask>, AppError> {
    let wanted: HashMap<&str, &str> = uris
        .iter()
        .map(|uri| (without_fragment(uri), uri.as_str()))
        .collect();
    let mut found = Vec::new();
    let mut reported = HashSet::new();
    let (_, tasks) = state.0.snapshot(false).await?;
    for task in &tasks {
        let source = task
            .files
            .iter()
            .flat_map(|file| &file.uris)
            .find_map(|uri| wanted.get(without_fragment(&uri.uri)));
        if let Some(uri) = source.filter(|uri| reported.insert(**uri)) {
            found.push(DuplicateTask {
                uri: (*uri).to_owned(),
                gid: task.gid.clone(),
                name: crate::services::monitor::TaskEvent::extract_name(task),
                status: task.status.clone(),
            });
        }
    }
    let candidates: Vec<String> = wanted.keys().map(|uri| (*uri).to_owned()).collect();
    for record in history.0.completed_from(&candidates).await? {
        let Some(uri) = record.uri.as_deref().and_then(|uri| wanted.get(uri)) else {
            continue;
        };
        if reported.insert(*uri) {
            found.push(DuplicateTask {
                uri: (*uri).to_owned(),
                gid: record.gid,
                name: record.name,
                status: record.status,
            });
        }
    }
    Ok(found)
}

/// Replaces the source URL of an unfinished single-file download; the
/// downloaded data is kept.
#[tauri::command]
pub async fn aria2_replace_uri(
    app: AppHandle,
    state: State<'_, TaskServiceState>,
    gid: String,
    uri: String,
) -> Result<(), AppError> {
    let parsed = url::Url::parse(uri.trim())
        .map_err(|error| AppError::InvalidInput(format!("Invalid URL: {error}")))?;
    if !matches!(parsed.scheme(), "http" | "https" | "ftp" | "sftp") {
        return Err(AppError::InvalidInput(
            "Only HTTP, FTP and SFTP sources can be replaced".into(),
        ));
    }
    state
        .0
        .replace_uris(&gid, vec![uri.trim().to_owned()])
        .await?;
    log::info!("aria2:replace-uri gid={gid}");
    crate::services::pump::wake(&app);
    Ok(())
}

/// Add URI download(s). Each URI gets its own aria2 task with optional
/// per-URI `out` filename override and file-category directory resolution.
#[tauri::command]
pub async fn aria2_add_uri(
    app: AppHandle,
    uris: Vec<String>,
    options: serde_json::Value,
    request_id: Option<String>,
) -> Result<String, AppError> {
    crate::services::downloads::submit(&app, uris, options, request_id.as_deref()).await
}

/// Forcefully remove a task by GID.
#[tauri::command]
pub async fn aria2_force_remove(
    state: State<'_, TaskServiceState>,
    gid: String,
) -> Result<String, AppError> {
    log::info!("aria2:remove gid={gid}");
    state.0.force_remove(&gid).await
}

fn is_terminal_download_status(status: &str) -> bool {
    matches!(status, "complete" | "error" | "removed")
}

async fn remove_engine_task(client: &TaskService, gid: &str) -> Result<(), AppError> {
    let operation = async {
        let mut removal_requested = false;
        loop {
            let tasks = client.tell_task_snapshot(true).await?;
            let Some(task) = tasks.iter().find(|task| task.gid == gid) else {
                return Ok(());
            };
            if is_terminal_download_status(&task.status) {
                match client.remove_download_result(gid).await {
                    Ok(_) => return Ok(()),
                    // Native result publication can trail a terminal snapshot.
                    // Re-read state on application faults; transport failures stay visible.
                    Err(AppError::Rpc { code: 1, .. }) => {}
                    Err(error) => return Err(error),
                }
            } else if !removal_requested {
                client.force_remove(gid).await?;
                removal_requested = true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    };
    tokio::time::timeout(std::time::Duration::from_secs(5), operation)
        .await
        .map_err(|_| AppError::Aria2(format!("Task {gid} did not finish removal")))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchDeleteTaskTarget {
    gid: String,
    delete_mode: Option<crate::commands::fs::FileDeletionMode>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchTaskFailure {
    gid: String,
    message: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchTaskOperationResult {
    succeeded: Vec<String>,
    failed: Vec<BatchTaskFailure>,
}

impl BatchTaskOperationResult {
    fn record(&mut self, gid: String, operation: Result<(), AppError>) {
        match operation {
            Ok(()) => self.succeeded.push(gid),
            Err(error) => {
                log::warn!("aria2:batch-operation-failed gid={gid} error={error}");
                self.failed.push(BatchTaskFailure {
                    gid,
                    message: error.to_string(),
                });
            }
        }
    }
}

async fn delete_task(
    client: &TaskService,
    history: &Database,
    gid: &str,
    delete_mode: Option<crate::commands::fs::FileDeletionMode>,
    protected_roots: &HashSet<PathBuf>,
) -> Result<(), AppError> {
    use crate::services::tasks::files::{
        content_paths, delete_content, history_task, path_identity, with_unfinished_copies,
    };
    let _mutation = client.mutation.lock().await;
    log::info!("aria2:delete gid={gid}");
    let snapshot = client.tell_task_snapshot(true).await?;
    let records = history.get_records(None).await?;
    let task = snapshot
        .iter()
        .find(|task| task.gid == gid)
        .cloned()
        .or_else(|| {
            records
                .iter()
                .find(|record| record.gid == gid)
                .map(history_task)
        });
    let paths = task
        .as_ref()
        .map(|task| with_unfinished_copies(content_paths(&task.files, false)))
        .unwrap_or_default();
    let root = task
        .as_ref()
        .map(|task| PathBuf::from(&task.dir))
        .unwrap_or_default();
    let mut protected_directories: HashSet<_> = snapshot
        .iter()
        .filter(|task| task.gid != gid)
        .map(|task| path_identity(Path::new(&task.dir)))
        .chain(
            records
                .iter()
                .filter(|record| record.gid != gid)
                .filter_map(|record| record.dir.as_deref())
                .map(|dir| path_identity(Path::new(dir))),
        )
        .collect();
    let protected_tasks = snapshot
        .iter()
        .chain(
            records
                .iter()
                .filter(|record| record.gid != gid)
                .map(history_task)
                .collect::<Vec<_>>()
                .iter(),
        )
        .filter(|task| task.gid != gid)
        .flat_map(|task| content_paths(&task.files, false))
        .collect::<Vec<_>>();
    protected_directories.extend(protected_roots.iter().cloned());
    protected_directories.extend(
        protected_tasks
            .iter()
            .filter_map(|path| path.parent())
            .flat_map(Path::ancestors)
            .map(path_identity),
    );
    if delete_mode.is_some() && !records.iter().any(|record| record.gid == gid) {
        if let Some(task) = &task {
            let event = crate::services::monitor::TaskEvent::from_aria2(task);
            let mut record = crate::services::monitor::build_history_record_with_added_at(
                &event,
                crate::services::monitor::events::TASK_ERROR,
                history.get_task_birth(gid).await?,
            );
            record.status = "removed".into();
            history.add_record(&record).await?;
        }
    }
    remove_engine_task(client, gid).await?;
    client.tasks.mark_deleted(gid);
    if let Some(mode) = delete_mode {
        tokio::task::spawn_blocking(move || {
            let protected = protected_tasks
                .iter()
                .map(|path| path_identity(path))
                .collect();
            delete_content(&paths, &protected, &root, &protected_directories, mode)
        })
        .await
        .map_err(|error| AppError::Io(error.to_string()))??;
    }
    history.remove_task_records(gid).await
}

/// Delete a task regardless of whether it is live, transitioning, or stopped.
#[tauri::command]
pub async fn aria2_delete_task(
    app: AppHandle,
    state: State<'_, TaskServiceState>,
    history: State<'_, DatabaseState>,
    gid: String,
    delete_mode: Option<crate::commands::fs::FileDeletionMode>,
) -> Result<(), AppError> {
    let protected = if delete_mode.is_some() {
        protected_download_directories(&app)?
    } else {
        HashSet::new()
    };
    delete_task(&state.0, &history.0, &gid, delete_mode, &protected).await
}

fn protected_download_directories(app: &AppHandle) -> Result<HashSet<PathBuf>, AppError> {
    use crate::services::{
        downloads::{category, preferences},
        tasks::files::path_identity,
    };
    let prefs = preferences::load(app)?;
    let mut roots = HashSet::from([path_identity(Path::new(&prefs.dir))]);
    for entry in &prefs.file_categories {
        roots.insert(path_identity(Path::new(&category::directory(
            &prefs.dir, entry,
        )?)));
    }
    Ok(roots)
}

/// Inspect only engine/database-owned paths, never paths supplied by a card.
#[tauri::command]
pub async fn task_file_states(
    state: State<'_, TaskServiceState>,
    history: State<'_, DatabaseState>,
    gids: Vec<String>,
) -> Result<HashMap<String, crate::services::tasks::files::FileState>, AppError> {
    if gids.len() > 1000 {
        return Err(AppError::InvalidInput("Too many task IDs".into()));
    }
    let ids: HashSet<_> = gids.into_iter().collect();
    let mut tasks: Vec<_> = state
        .0
        .tell_task_snapshot(true)
        .await?
        .into_iter()
        .filter(|task| ids.contains(&task.gid))
        .collect();
    let live: HashSet<_> = tasks.iter().map(|task| task.gid.clone()).collect();
    for record in history.0.get_records(None).await? {
        if ids.contains(&record.gid) && !live.contains(&record.gid) {
            tasks.push(crate::services::tasks::files::history_task(&record));
        }
    }
    crate::services::tasks::files::inspect(&state.0, tasks, true).await
}

/// Delete multiple tasks while preserving per-task history cleanup semantics.
#[tauri::command]
pub async fn aria2_batch_delete_tasks(
    app: AppHandle,
    state: State<'_, TaskServiceState>,
    history: State<'_, DatabaseState>,
    tasks: Vec<BatchDeleteTaskTarget>,
) -> Result<BatchTaskOperationResult, AppError> {
    let mut result = BatchTaskOperationResult::default();
    let protected = if tasks.iter().any(|target| target.delete_mode.is_some()) {
        protected_download_directories(&app)?
    } else {
        HashSet::new()
    };
    for target in tasks {
        let operation = delete_task(
            &state.0,
            &history.0,
            &target.gid,
            target.delete_mode,
            &protected,
        )
        .await;
        result.record(target.gid, operation);
    }
    log::info!(
        "aria2:batch-delete finished={} failed={}",
        result.succeeded.len(),
        result.failed.len()
    );
    Ok(result)
}

/// Forcefully pause a task by GID.
#[tauri::command]
pub async fn aria2_force_pause(
    state: State<'_, TaskServiceState>,
    gid: String,
) -> Result<String, AppError> {
    log::debug!("aria2:force-pause gid={gid}");
    state.0.force_pause(&gid).await
}

/// Gracefully pause a task.
#[tauri::command]
pub async fn aria2_pause(
    state: State<'_, TaskServiceState>,
    gid: String,
) -> Result<String, AppError> {
    log::debug!("aria2:pause gid={gid}");
    state.0.pause(&gid).await
}

/// Resume a paused task.
#[tauri::command]
pub async fn aria2_unpause(
    state: State<'_, TaskServiceState>,
    gid: String,
) -> Result<String, AppError> {
    log::debug!("aria2:resume gid={gid}");
    state.0.resume_task(&gid).await
}

/// Save the current aria2 session to disk.
#[tauri::command]
pub async fn aria2_save_session(state: State<'_, TaskServiceState>) -> Result<String, AppError> {
    state.0.save_session().await
}

/// Remove a completed/errored task record from aria2's download list.
#[tauri::command]
pub async fn aria2_remove_download_result(
    state: State<'_, TaskServiceState>,
    gid: String,
) -> Result<String, AppError> {
    state.0.remove_download_result(&gid).await
}

/// Clear application history and purge completed engine results.
#[tauri::command]
pub async fn aria2_purge_task_records(
    state: State<'_, TaskServiceState>,
    history: State<'_, DatabaseState>,
) -> Result<(), AppError> {
    log::info!("aria2:purge-results");
    history.0.clear_records(None).await?;
    if let Err(error) = state.0.purge_download_result().await {
        log::debug!("aria2:purge-results engine cleanup failed: {error}");
    }
    Ok(())
}

/// Forcefully pause every active engine task through the native RPC.
#[tauri::command]
pub async fn aria2_force_pause_all(state: State<'_, TaskServiceState>) -> Result<String, AppError> {
    const SETTLE_ATTEMPTS: usize = 100;
    const SETTLE_DELAY: std::time::Duration = std::time::Duration::from_millis(50);

    let (active, waiting) = tokio::try_join!(state.0.tell_active(), state.0.tell_waiting(0, 1000))?;
    let targets = active
        .into_iter()
        .chain(waiting)
        .filter(|task| matches!(task.status.as_str(), "active" | "waiting"))
        .map(|task| task.gid)
        .collect::<HashSet<_>>();

    log::info!("aria2:pause-all count={}", targets.len());
    let response = state.0.force_pause_all().await?;
    for _ in 0..SETTLE_ATTEMPTS {
        let (active, waiting) =
            tokio::try_join!(state.0.tell_active(), state.0.tell_waiting(0, 1000))?;
        let unsettled = active.into_iter().chain(waiting).any(|task| {
            targets.contains(&task.gid) && matches!(task.status.as_str(), "active" | "waiting")
        });
        if !unsettled {
            return Ok(response);
        }
        tokio::time::sleep(SETTLE_DELAY).await;
    }

    Err(AppError::Aria2(
        "Timed out while waiting for all tasks to pause".to_string(),
    ))
}

/// Resume paused tasks while keeping unresolved media selections paused.
#[tauri::command]
pub async fn aria2_resume_eligible(
    state: State<'_, TaskServiceState>,
) -> Result<crate::services::tasks::ResumeEligibleResult, AppError> {
    let result = state.0.resume_eligible().await?;
    log::info!(
        "aria2:resume-eligible resumed={} blocked={}",
        result.resumed,
        result.blocked
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::is_terminal_download_status;
    use crate::aria2::types::Aria2Task;

    #[tokio::test]
    async fn deletion_removes_the_visible_native_task_before_its_history() {
        use axum::{extract::State, routing::post, Json, Router};
        use serde_json::{json, Value};
        use std::sync::{
            atomic::{AtomicU8, Ordering},
            Arc,
        };
        async fn rpc(
            State(state): State<Arc<AtomicU8>>,
            Json(request): Json<Value>,
        ) -> Json<Value> {
            let result = match request["method"].as_str().unwrap() {
                "system.multicall" => {
                    let phase = state.load(Ordering::Relaxed);
                    let tasks = if phase == 2 {
                        vec![]
                    } else {
                        vec![Aria2Task {
                            gid: "task".into(),
                            status: if phase == 0 { "active" } else { "removed" }.into(),
                            ..Default::default()
                        }]
                    };
                    let stat = json!({"downloadSpeed":"0","numActive":"0",
                        "numWaiting":"0","numStopped":"0","numStoppedTotal":"0"});
                    json!([[stat], [tasks], [[]], [[]]])
                }
                "aria2.forceRemove" => {
                    state.store(1, Ordering::Relaxed);
                    json!("task")
                }
                "aria2.removeDownloadResult" => {
                    state.store(2, Ordering::Relaxed);
                    json!("OK")
                }
                method => panic!("Unexpected operation: {method}"),
            };
            Json(json!({"jsonrpc":"2.0","id":request["id"],"result":result}))
        }
        let state = Arc::new(AtomicU8::new(0));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client = crate::services::tasks::TaskService::new(
            listener.local_addr().unwrap().port(),
            String::new(),
        );
        let router = Router::new()
            .route("/jsonrpc", post(rpc))
            .with_state(state.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let db = crate::database::Database::open_in_memory().unwrap();
        db.add_record(
            &serde_json::from_value(json!({"gid":"task","name":"file","status":"complete"}))
                .unwrap(),
        )
        .await
        .unwrap();
        super::delete_task(
            &client,
            &db,
            "task",
            None,
            &std::collections::HashSet::new(),
        )
        .await
        .unwrap();
        assert_eq!(state.load(Ordering::Relaxed), 2);
        assert!(db.get_record("task").await.unwrap().is_none());
        server.abort();
    }

    #[test]
    fn deletion_waits_for_a_terminal_download_status() {
        assert!(is_terminal_download_status("complete"));
        assert!(is_terminal_download_status("error"));
        assert!(is_terminal_download_status("removed"));
        assert!(!is_terminal_download_status("active"));
        assert!(!is_terminal_download_status("waiting"));
        assert!(!is_terminal_download_status("paused"));
    }
}

/// Confirm media selection or retry a failed media task with the same GID.
#[tauri::command]
pub async fn aria2_confirm_media(
    state: State<'_, TaskServiceState>,
    gid: String,
    options: serde_json::Value,
) -> Result<String, AppError> {
    let task = state.0.tell_status(&gid).await?;
    crate::services::media::native::start(
        &state.0,
        &task,
        options,
        crate::services::media::native::StartMode::User,
    )
    .await
}

/// Finalize committed live media without deleting its output or recovery state.
#[tauri::command]
pub async fn aria2_finish_media(
    state: State<'_, TaskServiceState>,
    gid: String,
) -> Result<String, AppError> {
    state.0.finish_media(&gid).await
}

/// Retry a failed presentation in its native recovery identity.
#[tauri::command]
pub async fn aria2_retry_media(
    state: State<'_, TaskServiceState>,
    gid: String,
    options: serde_json::Value,
) -> Result<String, AppError> {
    state.0.retry_media(&gid, options).await
}

/// Request publication for each selected recording and retain per-task failures.
#[tauri::command]
pub async fn aria2_batch_finish_media(
    state: State<'_, TaskServiceState>,
    gids: Vec<String>,
) -> Result<BatchTaskOperationResult, AppError> {
    let mut result = BatchTaskOperationResult::default();
    for gid in gids {
        let operation = state.0.finish_media(&gid).await.map(|_| ());
        result.record(gid, operation);
    }
    Ok(result)
}

#[tauri::command]
pub fn cancel_download_request(app: AppHandle, id: String) {
    crate::services::downloads::cancel(&app, &id);
}

/// The connection cap a site rule sets for these URIs, with its host pattern.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteConnectionCap {
    max_connection_per_server: u32,
    host_pattern: String,
}

#[tauri::command]
pub fn preview_site_rules(
    app: AppHandle,
    uris: Vec<String>,
) -> Result<Option<SiteConnectionCap>, AppError> {
    let prefs = crate::services::downloads::preferences::load(&app)?;
    Ok(
        crate::services::downloads::preferences::site_connection_cap(&prefs, &uris).map(
            |(max_connection_per_server, host_pattern)| SiteConnectionCap {
                max_connection_per_server,
                host_pattern,
            },
        ),
    )
}

#[tauri::command]
pub fn resolve_file_category(
    candidates: Vec<crate::services::downloads::category::Candidate>,
    categories: Vec<crate::services::downloads::category::Category>,
    base_dir: String,
) -> Result<Option<crate::services::downloads::category::Category>, AppError> {
    crate::services::downloads::category::resolve(&candidates, &categories, &base_dir)
}

#[tauri::command]
pub fn validate_file_categories(
    categories: Vec<crate::services::downloads::category::Category>,
    base_dir: String,
) -> Result<(), AppError> {
    crate::services::downloads::category::validate(&categories, &base_dir)
}
