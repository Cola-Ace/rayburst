//! Task lifecycle persistence and active-state monitoring.
//!
//! Aria2 Next WebSocket events drive terminal task processing. Each pump
//! snapshot is observed for aggregate state, missing
//! files and the shutdown-when-complete policy.
//!
//! Persists history records to the Rust-side `Database` directly,
//! ensuring task completion data survives even when the WebView is
//! destroyed in lightweight mode (issue #194).
//!
//! Sends native system notifications from Rust so lightweight mode still
//! notifies when the WebView is destroyed. Also emits Tauri events to the
//! frontend when it is available so the UI can show in-app toasts and run
//! file actions.
//!

use super::notification::send_task_notification;
use crate::aria2::types::Aria2Task;
use crate::database::DatabaseState;
use crate::error::AppError;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::Manager;

/// File presence is checked on disk, so it runs less often than the pump.
const FILE_CHECK_INTERVAL: Duration = Duration::from_secs(2);

static COMPLETION_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Events emitted to the frontend.
pub mod events {
    pub const TASK_ERROR: &str = "task-monitor:error";
    pub const TASK_COMPLETE: &str = "task-monitor:complete";
}

/// Snapshot of a single file within a TaskEvent.
///
/// Mirrors the frontend's `HistoryFileSnapshot` type, enabling correct
/// multi-file deletion and folder-opening after history round-trip.
#[derive(Debug, Clone, serde::Serialize)]
pub struct TaskEventFile {
    pub index: String,
    pub completed_length: String,
    pub path: String,
    pub length: String,
    pub selected: String,
    pub uris: Vec<String>,
}

/// Payload for task lifecycle events.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub media: Option<crate::aria2::types::Aria2Media>,
    pub gid: String,
    pub name: String,
    pub status: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub dir: String,
    pub total_length: String,
    pub completed_length: String,
    /// Full file list snapshot — required for correct multi-file
    /// history records (deletion, open-folder, stale detection).
    #[serde(skip_serializing)]
    pub files: Vec<TaskEventFile>,
}

impl TaskEvent {
    pub(crate) fn from_aria2(task: &Aria2Task) -> Self {
        let name = Self::extract_name(task);
        let files: Vec<TaskEventFile> = task
            .files
            .iter()
            .map(|f| TaskEventFile {
                index: f.index.clone(),
                completed_length: f.completed_length.clone(),
                path: f.path.clone(),
                length: f.length.clone(),
                selected: f.selected.clone(),
                uris: f.uris.iter().map(|u| u.uri.clone()).collect(),
            })
            .collect();

        Self {
            media: task.media.clone(),
            gid: task.gid.clone(),
            name,
            status: task.status.clone(),
            error_code: task.error_code.clone(),
            error_message: task.error_message.clone(),
            dir: task.dir.clone(),
            total_length: task.total_length.clone(),
            completed_length: task.completed_length.clone(),
            files,
        }
    }

    /// The downloaded file, or the folder of a multi-file task.
    pub(crate) fn output_path(&self) -> std::path::PathBuf {
        let selected: Vec<_> = self
            .files
            .iter()
            .filter(|file| !file.path.is_empty() && file.selected != "false")
            .collect();
        match selected.as_slice() {
            [file] => std::path::PathBuf::from(&file.path),
            _ if (self.files.len() > 1) && self.name != "Unknown" => {
                std::path::Path::new(&self.dir).join(&self.name)
            }
            _ => std::path::PathBuf::from(&self.dir),
        }
    }

    /// Best-effort task name extraction matching the TS `getTaskName()`.
    pub(crate) fn extract_name(task: &Aria2Task) -> String {
        Self::known_name(task).unwrap_or_else(|| "Unknown".to_string())
    }

    /// The task's name once the engine has decided it. An HTTP task has none
    /// until its response arrives and the engine picks the output file.
    pub(crate) fn known_name(task: &Aria2Task) -> Option<String> {
        // Fallback: first file's path basename
        let path = &task.files.first()?.path;
        if path.is_empty() {
            return None;
        }
        let sep = path.rfind('/').or_else(|| path.rfind('\\'));
        Some(
            sep.map_or(path.as_str(), |idx| &path[idx + 1..])
                .to_string(),
        )
    }
}

/// Preserves file snapshots, terminal progress and media options for history.
fn build_history_meta_json(event: &TaskEvent) -> String {
    let mut meta = serde_json::Map::new();
    if let Some(media) = &event.media {
        meta.insert("media".into(), serde_json::json!(media));
    }

    meta.insert(
        "completedLength".into(),
        event.completed_length.clone().into(),
    );
    if let Some(value) = &event.error_code {
        meta.insert("errorCode".into(), value.clone().into());
    }
    if let Some(value) = &event.error_message {
        meta.insert("errorMessage".into(), value.clone().into());
    }
    if !event.files.is_empty() {
        let files: Vec<serde_json::Value> = event
            .files
            .iter()
            .map(|f| {
                serde_json::json!({
                    "index": f.index,
                    "completedLength": f.completed_length,
                    "path": f.path,
                    "length": f.length,
                    "selected": f.selected,
                    "uris": f.uris,
                })
            })
            .collect();
        meta.insert("files".to_string(), serde_json::Value::Array(files));
    }

    serde_json::Value::Object(meta).to_string()
}

/// Converts a [`TaskEvent`] into a [`HistoryRecord`] for Rust-side DB persistence.
///
/// This enables the task monitor to write history records directly to the database,
/// bypassing the frontend. Critical for lightweight mode where the WebView is
/// destroyed — without this, task completions during headless operation would
/// be silently lost (issue #194 follow-up).
///
/// The resulting record uses `ON CONFLICT(gid) DO UPDATE` when inserted.
#[cfg(test)]
fn build_history_record(event: &TaskEvent, event_name: &str) -> crate::database::HistoryRecord {
    build_history_record_with_added_at(event, event_name, None)
}

pub fn build_history_record_with_added_at(
    event: &TaskEvent,
    event_name: &str,
    added_at: Option<String>,
) -> crate::database::HistoryRecord {
    let status = match event_name {
        events::TASK_COMPLETE => "complete",
        events::TASK_ERROR => "error",
        _ => "unknown",
    };

    let task_type = if event.media.is_some() {
        Some("media".to_string())
    } else {
        Some("uri".to_string())
    };

    let total_length = event.total_length.parse::<i64>().ok();
    let now = chrono::Utc::now().to_rfc3339();
    let added_at = added_at.unwrap_or_else(|| now.clone());

    // This ensures historyRecordToTask() can reconstruct multi-file tasks
    // for deletion, open-folder, and deduplication.
    let meta = Some(build_history_meta_json(event));

    let uri = event
        .files
        .first()
        .and_then(|file| file.uris.first())
        .filter(|uri| !uri.is_empty())
        .cloned();

    crate::database::HistoryRecord {
        id: None,
        gid: event.gid.clone(),
        name: event.name.clone(),
        uri,
        dir: Some(event.dir.clone()),
        total_length,
        status: status.to_string(),
        task_type,
        added_at: Some(added_at),
        created_at: None,
        completed_at: Some(now),
        meta,
    }
}

async fn persist_lifecycle_event(
    app: &tauri::AppHandle,
    event_name: &str,
    payload: &TaskEvent,
) -> Result<(), AppError> {
    let Some(db_state) = app.try_state::<DatabaseState>() else {
        return Err(AppError::Store(
            "History database is unavailable during lifecycle processing".into(),
        ));
    };
    let db = db_state.0.clone();
    if !db.is_ready().await {
        return Ok(());
    }
    let existing_added_at = db.get_task_birth(&payload.gid).await?;
    let mut record = build_history_record_with_added_at(payload, event_name, existing_added_at);
    if payload.media.is_some() {
        if let Some(aria2) = app.try_state::<crate::services::tasks::TaskServiceState>() {
            match aria2.0.get_option(&payload.gid).await {
                Ok(options) => {
                    let media_options: serde_json::Map<String, serde_json::Value> = options
                        .as_object()
                        .into_iter()
                        .flatten()
                        .filter(|(key, _)| {
                            super::media::contracts::HISTORY_OPTIONS.contains(&key.as_str())
                        })
                        .map(|(key, value)| (key.clone(), value.clone()))
                        .collect();
                    let mut meta: serde_json::Value =
                        serde_json::from_str(record.meta.as_deref().unwrap_or("{}"))
                            .map_err(|error| AppError::Aria2(error.to_string()))?;
                    meta["mediaOptions"] = media_options.into();
                    record.meta = Some(meta.to_string());
                }
                Err(error) => log::warn!(
                    "media: options unavailable for history gid={} error={error}",
                    payload.gid
                ),
            }
        }
    }

    if let Some(added_at) = record.added_at.as_deref() {
        db.record_task_birth(&record.gid, added_at).await?;
    }
    db.add_record(&record).await
}

pub async fn process_lifecycle_task(
    app: &tauri::AppHandle,
    event_name: &str,
    task: &Aria2Task,
    notify: bool,
) -> Result<(), AppError> {
    if super::media::owns(app, &task.gid).await {
        return Ok(());
    }

    if let Some(engine) = app.try_state::<super::tasks::TaskServiceState>() {
        super::notification::notify_started_tasks(app, &engine.0, std::slice::from_ref(task)).await;
    }
    let engine_state = app.try_state::<super::tasks::TaskServiceState>();
    let _mutation = if let Some(engine) = &engine_state {
        Some(engine.0.mutation.lock().await)
    } else {
        None
    };
    if engine_state
        .as_ref()
        .is_some_and(|engine| engine.0.tasks.is_deleted(&task.gid))
    {
        return Ok(());
    }
    let payload = TaskEvent::from_aria2(task);
    if let Err(error) = persist_lifecycle_event(app, event_name, &payload).await {
        log::error!(
            "task_lifecycle:persist-failed gid={} error={error}",
            payload.gid
        );
    }

    if !notify {
        forget_if_unkept(app, event_name, &payload.gid).await;
        return Ok(());
    }

    if matches!(event_name, events::TASK_COMPLETE) {
        COMPLETION_GENERATION.fetch_add(1, Ordering::Relaxed);
    }

    let runtime_config = match app.try_state::<super::config::RuntimeConfigState>() {
        Some(state) => state.snapshot().await,
        None => {
            log::warn!("notification:runtime-config-unavailable fallback=defaults");
            super::config::RuntimeConfig::default()
        }
    };
    let webview_alive = app.get_webview_window("main").is_some();
    log::info!(
        target: "task_lifecycle",
        event = event_name,
        gid = payload.gid.as_str(),
        task_name:% = payload.name,
        webview_alive;
        "task_lifecycle_event"
    );
    if let Err(error) = app.emit(event_name, &payload) {
        log::warn!("task_lifecycle: failed to emit {event_name}: {error}");
    }
    send_task_notification(app, event_name, &payload, &runtime_config).await;
    if matches!(event_name, events::TASK_COMPLETE) {
        super::post_download::run(&runtime_config, &payload);
    }
    forget_if_unkept(app, event_name, &payload.gid).await;
    Ok(())
}

/// With "keep completed records" off, a finished download leaves the list
/// once it has been recorded and announced; its files stay (#722). A task
/// retains its transfer state until completion.
async fn forget_if_unkept(app: &tauri::AppHandle, event_name: &str, gid: &str) {
    if event_name != events::TASK_COMPLETE {
        return;
    }
    let keep = match app.try_state::<super::config::RuntimeConfigState>() {
        Some(state) => !state.snapshot().await.remove_completed_records,
        None => true,
    };
    if keep {
        return;
    }
    if let Err(error) = app
        .state::<DatabaseState>()
        .0
        .remove_task_records(gid)
        .await
    {
        log::warn!("task_lifecycle:forget-failed gid={gid} error={error}");
        return;
    }
    if let Some(engine) = app.try_state::<super::tasks::TaskServiceState>() {
        if let Err(error) = engine.0.remove_download_result(gid).await {
            log::debug!("task_lifecycle:forget-result-failed gid={gid} error={error}");
        }
    }
    log::info!("task_lifecycle:forgotten gid={gid}");
}

pub async fn reconcile_stopped_tasks(
    app: &tauri::AppHandle,
    aria2: &crate::services::tasks::TaskService,
) -> Result<usize, AppError> {
    let Some(db_state) = app.try_state::<DatabaseState>() else {
        return Err(AppError::Store(
            "History database is unavailable during lifecycle reconciliation".into(),
        ));
    };
    let db = db_state.0.clone();
    if !db.is_ready().await {
        return Ok(0);
    }
    let mut reconciled = 0;

    for task in aria2.tell_all_stopped().await? {
        let event_name = match task.status.as_str() {
            "complete" => events::TASK_COMPLETE,
            "error" if task.error_code.as_deref() != Some("0") => events::TASK_ERROR,
            _ => continue,
        };
        if db.contains_record(&task.gid).await? {
            continue;
        }
        process_lifecycle_task(app, event_name, &task, false).await?;
        reconciled += 1;
    }

    Ok(reconciled)
}

/// Lifecycle policy applied to every pump snapshot.
pub struct Monitor {
    completion_generation: u64,
    /// Whether downloads existed during this engine run, so an empty queue
    /// at launch does not count as "all downloads complete".
    had_active_downloads: bool,
    shutdown_triggered: bool,
    file_states: std::collections::HashMap<String, super::tasks::files::FileState>,
    files_checked_at: Option<Instant>,
    /// Queued tasks of the previous snapshot; a gid outside it is a new task,
    /// whoever added it (the desktop, a browser extension or an RPC client).
    queued: std::collections::HashSet<String>,
}

impl Monitor {
    /// `initial` seeds the set of tasks already present at startup.
    pub fn new(initial: &[Aria2Task]) -> Self {
        Self {
            completion_generation: COMPLETION_GENERATION.load(Ordering::Relaxed),
            had_active_downloads: false,
            shutdown_triggered: false,
            file_states: std::collections::HashMap::new(),
            files_checked_at: None,
            queued: initial.iter().map(|task| task.gid.clone()).collect(),
        }
    }

    /// `tasks` holds the active and waiting tasks of one snapshot.
    pub async fn observe(
        &mut self,
        app: &tauri::AppHandle,
        aria2: &crate::services::tasks::TaskService,
        tasks: &[Aria2Task],
    ) {
        for task in tasks {
            if !self.queued.contains(&task.gid) {
                aria2.tasks.expect_start(&task.gid).await;
            }
        }
        self.queued = tasks.iter().map(|task| task.gid.clone()).collect();
        if self
            .files_checked_at
            .is_none_or(|at| at.elapsed() >= FILE_CHECK_INTERVAL)
        {
            self.files_checked_at = Some(Instant::now());
            self.check_files(app, aria2, tasks).await;
        }

        let active: Vec<_> = tasks
            .iter()
            .filter(|task| task.status == "active")
            .cloned()
            .collect();
        super::notification::notify_started_tasks(app, aria2, &active).await;
        let waiting = tasks.iter().filter(|task| task.status == "waiting").count();
        self.check_shutdown(app, count_active_downloads(&active), waiting);
    }

    /// Publishes missing-file changes through `task-files:changed`.
    async fn check_files(
        &mut self,
        app: &tauri::AppHandle,
        aria2: &crate::services::tasks::TaskService,
        tasks: &[Aria2Task],
    ) {
        let states = match super::tasks::files::inspect(aria2, tasks.to_vec(), false).await {
            Ok(states) => states,
            Err(error) => {
                log::warn!("task_files: inspection failed: {error}");
                return;
            }
        };
        if states != self.file_states {
            let _ = app.emit("task-files:changed", &states);
            self.file_states = states;
        }
    }

    fn check_shutdown(&mut self, app: &tauri::AppHandle, active: usize, waiting: usize) {
        let generation = COMPLETION_GENERATION.load(Ordering::Relaxed);
        // A completion means a task went through its whole lifecycle even if
        // no snapshot saw it active (instant downloads).
        let completed = generation != self.completion_generation;
        self.completion_generation = generation;

        if active > 0 || waiting > 0 || completed {
            self.had_active_downloads = true;
            self.shutdown_triggered = false;
        }
        if self.shutdown_triggered || !self.had_active_downloads || active > 0 || waiting > 0 {
            return;
        }
        let should_shutdown = app
            .try_state::<super::config::RuntimeConfigState>()
            .map(|rc| rc.0.try_read().is_ok_and(|cfg| cfg.shutdown_when_complete))
            .unwrap_or(false);
        if !should_shutdown {
            return;
        }
        self.shutdown_triggered = true;
        log::info!("task_monitor: all downloads complete, shutdown requested");

        // A previous cancellation must not suppress this sequence.
        if let Some(cancel) =
            app.try_state::<std::sync::Arc<crate::commands::power::ShutdownCancelState>>()
        {
            cancel.reset();
        }
        // The window shows a 60 s countdown. Without a window (lightweight
        // mode) nothing can cancel or confirm, so shut down after 70 s unless
        // cancelled.
        let _ = app.emit("power:countdown", ());
        let app = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(70)).await;
            let cancelled = app
                .try_state::<std::sync::Arc<crate::commands::power::ShutdownCancelState>>()
                .map(|state| state.is_cancelled())
                .unwrap_or(true);
            if cancelled {
                log::info!("power: shutdown cancelled by user");
                return;
            }
            log::info!("power: lightweight fallback — executing shutdown");
            if let Err(e) = crate::commands::power::do_shutdown_internal() {
                log::error!("power: shutdown failed: {e}");
            }
        });
    }
}

/// Counts active downloads for the completion policy.
fn count_active_downloads(tasks: &[Aria2Task]) -> usize {
    tasks.iter().filter(|t| t.status == "active").count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::aria2::types::{Aria2File, Aria2FileUri};

    fn make_task(gid: &str, status: &str) -> Aria2Task {
        Aria2Task {
            gid: gid.to_string(),
            status: status.to_string(),
            total_length: "1024".to_string(),
            completed_length: "1024".to_string(),
            dir: "/tmp".to_string(),
            files: vec![Aria2File {
                index: "1".to_string(),
                path: "/tmp/test.zip".to_string(),
                length: "1024".to_string(),
                completed_length: "1024".to_string(),
                selected: "true".to_string(),
                uris: vec![],
            }],
            ..Aria2Task::default()
        }
    }

    fn make_error_task(gid: &str, code: &str) -> Aria2Task {
        let mut task = make_task(gid, "error");
        task.error_code = Some(code.to_string());
        task.error_message = Some("download failed".to_string());
        task
    }

    // ── TaskEvent extraction ────────────────────────────────────────

    #[test]
    fn task_event_extracts_name_from_file_path() {
        let task = make_task("g1", "complete");
        let event = TaskEvent::from_aria2(&task);
        assert_eq!(event.name, "test.zip");
    }

    #[test]
    fn task_event_preserves_literal_percent_sequences_from_file_path() {
        let mut task = make_task("g1", "complete");
        task.files[0].path = "/tmp/r%C3%A9sum%C3%A9.txt".to_string();

        assert_eq!(TaskEvent::from_aria2(&task).name, "r%C3%A9sum%C3%A9.txt");
    }

    #[test]
    fn task_event_handles_empty_files() {
        let mut task = make_task("g1", "complete");
        task.files = vec![];
        let event = TaskEvent::from_aria2(&task);
        assert_eq!(event.name, "Unknown");
    }

    #[test]
    fn task_has_no_known_name_before_the_engine_picks_its_file() {
        let mut task = make_task("g1", "active");
        task.files[0].path = String::new();
        assert_eq!(TaskEvent::known_name(&task), None);

        task.files[0].path = "C:\\Downloads\\iPhone1,1_3.1.3_7E18_Restore.ipsw".to_string();
        assert_eq!(
            TaskEvent::known_name(&task).as_deref(),
            Some("iPhone1,1_3.1.3_7E18_Restore.ipsw")
        );
    }

    // ── build_history_record unit tests ─────────────────────────────
    //
    // Validates the pure conversion from TaskEvent → HistoryRecord.
    // This function enables Rust-side DB persistence so that history
    // records are written even when the WebView is destroyed in
    // lightweight mode (issue #194 follow-up).

    #[test]
    fn build_history_record_sets_complete_status_for_task_complete() {
        let task = make_task("g1", "complete");
        let event = TaskEvent::from_aria2(&task);
        let record = build_history_record(&event, events::TASK_COMPLETE);

        assert_eq!(record.gid, "g1");
        assert_eq!(record.status, "complete");
        assert_eq!(record.name, "test.zip");
        assert!(record.completed_at.is_some());
    }

    #[test]
    fn build_history_record_with_added_at_uses_persisted_task_birth() {
        let task = make_task("g1", "complete");
        let event = TaskEvent::from_aria2(&task);
        let record = build_history_record_with_added_at(
            &event,
            events::TASK_COMPLETE,
            Some("2025-01-01T00:00:00Z".to_string()),
        );

        assert_eq!(record.added_at.as_deref(), Some("2025-01-01T00:00:00Z"));
        assert_ne!(record.completed_at, record.added_at);
    }

    #[test]
    fn build_history_record_sets_error_status_for_task_error() {
        let task = make_error_task("g3", "5");
        let event = TaskEvent::from_aria2(&task);
        let record = build_history_record(&event, events::TASK_ERROR);

        assert_eq!(record.gid, "g3");
        assert_eq!(record.status, "error");
        assert!(record.completed_at.is_some());
    }

    #[test]
    fn build_history_record_populates_dir_and_total_length() {
        let task = make_task("g1", "complete");
        let event = TaskEvent::from_aria2(&task);
        let record = build_history_record(&event, events::TASK_COMPLETE);

        assert_eq!(record.dir, Some("/tmp".to_string()));
        assert_eq!(record.total_length, Some(1024));
    }

    #[test]
    fn build_history_record_preserves_primary_uri_for_lightweight_mode_restart() {
        let mut task = make_task("g1", "complete");
        task.files[0].path = "/tmp/ИТОГИ ЛДУ 2026.xlsx".to_string();
        task.files[0].uris = vec![Aria2FileUri {
            uri: "https://mail-attachment.googleusercontent.com/attachment/u/0/".to_string(),
            status: "used".to_string(),
        }];
        let event = TaskEvent::from_aria2(&task);
        let record = build_history_record(&event, events::TASK_COMPLETE);

        assert_eq!(
            record.uri.as_deref(),
            Some("https://mail-attachment.googleusercontent.com/attachment/u/0/")
        );
    }

    #[test]
    fn build_history_record_derives_task_type_for_uri() {
        let task = make_task("g1", "complete");
        let event = TaskEvent::from_aria2(&task);
        let record = build_history_record(&event, events::TASK_COMPLETE);

        assert_eq!(record.task_type, Some("uri".to_string()));
    }

    #[test]
    fn build_history_record_id_is_none() {
        let task = make_task("g1", "complete");
        let event = TaskEvent::from_aria2(&task);
        let record = build_history_record(&event, events::TASK_COMPLETE);

        // DB auto-assigns the id via AUTOINCREMENT
        assert!(record.id.is_none());
    }

    // ── JSON meta format validation ─────────────────────────────────
    //
    // These tests validate that build_history_record() produces meta in
    // the correct JSON format expected by the frontend's parseHistoryMeta().

    #[test]
    fn terminal_snapshot_preserves_partial_progress_and_error() {
        let mut task = make_task("g1", "error");
        task.completed_length = "512".into();
        task.files[0].completed_length = "512".into();
        task.error_code = Some("3".into());
        task.error_message = Some("Resource not found".into());
        let event = TaskEvent::from_aria2(&task);
        let record = build_history_record(&event, events::TASK_COMPLETE);

        let meta: serde_json::Value = serde_json::from_str(record.meta.as_ref().unwrap()).unwrap();
        assert_eq!(meta["completedLength"], "512");
        assert_eq!(meta["files"][0]["completedLength"], "512");
        assert_eq!(meta["errorCode"], "3");
        assert_eq!(meta["errorMessage"], "Resource not found");
    }

    // ── count_active_downloads (auto-shutdown) ──────────────────────
    //
    // Validates the pure helper that determines whether any "real"
    // downloads are in progress for the auto-shutdown trigger.

    #[test]
    fn count_active_downloads_ignores_non_active_statuses() {
        let tasks = vec![
            make_task("g1", "complete"),
            make_task("g2", "paused"),
            make_task("g3", "error"),
            make_task("g4", "waiting"),
            make_task("g5", "removed"),
        ];
        assert_eq!(count_active_downloads(&tasks), 0);
    }

    #[test]
    fn count_active_downloads_empty_list_returns_zero() {
        assert_eq!(count_active_downloads(&[]), 0);
    }
}
