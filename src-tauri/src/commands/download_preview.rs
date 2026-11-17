//! Read the name and size a download would receive.
use crate::error::AppError;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

/// At most this many downloads are looked at together.
const MAX_PREVIEWS: usize = 4;

#[derive(Default)]
pub struct DownloadPreviewState(Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>);

#[tauri::command]
pub fn cancel_download_preview(
    state: tauri::State<'_, DownloadPreviewState>,
    id: String,
) -> Result<(), AppError> {
    if let Some(cancel) = state
        .0
        .lock()
        .map_err(|error| AppError::Io(error.to_string()))?
        .remove(&id)
    {
        let _ = cancel.send(());
    }
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPreviewRequest {
    id: String,
    url: String,
    /// The engine options the download would be created with.
    options: serde_json::Value,
}

/// The size and name a download would get, read from its first byte; the
/// engine makes the request, so it goes out as the download's would.
#[tauri::command]
pub async fn preview_download(
    app: tauri::AppHandle,
    request: DownloadPreviewRequest,
) -> Result<crate::services::downloads::Preview, AppError> {
    let DownloadPreviewRequest { id, url, options } = request;
    let parsed =
        url::Url::parse(&url).map_err(|error| AppError::InvalidInput(error.to_string()))?;
    if !matches!(parsed.scheme(), "http" | "https" | "thunder") || !options.is_object() {
        return Err(AppError::InvalidInput(
            "A download preview takes an HTTP or Thunder URL and its options".into(),
        ));
    }
    let state = app.state::<DownloadPreviewState>();
    let (cancel, cancelled) = tokio::sync::oneshot::channel();
    {
        let mut previews = state
            .0
            .lock()
            .map_err(|error| AppError::Io(error.to_string()))?;
        if previews.len() >= MAX_PREVIEWS || previews.contains_key(&id) {
            return Err(AppError::Conflict(
                "Too many download previews are running".into(),
            ));
        }
        previews.insert(id.clone(), cancel);
    }
    let result = tokio::select! {
        value = crate::services::downloads::preview(&app, &url, options) => value,
        _ = cancelled => Err(AppError::Conflict("Download preview cancelled".into())),
    };
    state
        .0
        .lock()
        .map_err(|error| AppError::Io(error.to_string()))?
        .remove(&id);
    result
}

pub(crate) fn summarize_url_for_log(value: &str) -> String {
    let lower = value.to_lowercase();
    if lower.starts_with("thunder://") {
        return format!("scheme=thunder length={}", value.len());
    }

    match url::Url::parse(value) {
        Ok(parsed) => {
            let scheme = parsed.scheme();
            let host = parsed.host_str().unwrap_or("none");
            let ext = parsed
                .path_segments()
                .and_then(|mut segments| segments.next_back())
                .and_then(|name| name.rsplit_once('.').map(|(_, ext)| ext))
                .filter(|ext| !ext.is_empty() && ext.len() <= 16)
                .unwrap_or("none");
            format!(
                "scheme={scheme} host={host} ext={} has_query={} length={}",
                ext.to_ascii_lowercase(),
                parsed.query().is_some(),
                value.len()
            )
        }
        Err(_) => format!("parseable=false length={}", value.len()),
    }
}
