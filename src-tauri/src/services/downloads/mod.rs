//! Browser download handoff and native task creation.
pub mod category;
pub mod contracts;
mod handoff;
mod native;
pub(crate) mod preferences;
mod unreachable;

use crate::aria2::types::Aria2Probe;
use crate::{
    error::AppError,
    services::tasks::{TaskService, TaskServiceState},
};
use contracts::{Ack, AddRequest, AddResponse, FallbackReason};
pub use handoff::Handoffs;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// How long a confirmation dialog may hold a browser download. After that
/// the browser keeps the download and the dialog drops it.
const CONFIRMATION_TIMEOUT: Duration = Duration::from_secs(120);
/// The browser keeps its download while the engine checks it, and Chromium
/// names a download after 15 s whatever the extension says: an answer must
/// come well before.
const VERIFY_TIMEOUT: Duration = Duration::from_secs(8);

/// The desktop filename field never grants permission to select a directory.
pub fn validate_filename(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Ok(());
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if name == "."
        || name == ".."
        || reserved
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|ch| ch.is_control() || "\\/:<>\"|?*".contains(ch))
    {
        return Err(AppError::InvalidInput(
            "Enter a filename without a path or reserved characters".into(),
        ));
    }
    Ok(())
}

pub async fn dispatch(app: &AppHandle, mut request: AddRequest) -> Result<AddResponse, AppError> {
    let url = request.url.as_str();
    let parsed = url::Url::parse(url).ok();
    validate_uris(std::slice::from_ref(&request.url))?;
    let prefs = preferences::load(app)?;
    crate::commands::database_initialize(app.clone()).await?;
    let mut options = preferences::options(&prefs, &request)?;
    preferences::apply_system_proxy(&prefs, std::slice::from_ref(&request.url), &mut options);
    // Shown in the add dialog next to the free space of the chosen folder.
    let mut size = request
        .size
        .and_then(|size| u64::try_from(size).ok())
        .filter(|size| *size > 0);
    if request.verify
        && parsed
            .as_ref()
            .is_some_and(|url| matches!(url.scheme(), "http" | "https"))
    {
        let engine = app.state::<TaskServiceState>().0.clone();
        let mut checked = check(&engine, &request.url, options.clone(), &request).await?;
        // A link the engine cannot fetch itself, such as one behind a CDN
        // challenge the browser got through (rayburst-connect#104) or one
        // that refuses a second request (#790), is fetched from the address
        // the browser's download landed on.
        if let (Err(_), Some(landed)) = (&checked, landed(&request)) {
            let landed = landed.to_owned();
            let options = for_landed(&request.url, &landed, options.clone());
            if let Ok(probe) = check(&engine, &landed, options, &request).await? {
                log::info!(
                    "downloads: the engine takes the download from where the browser landed"
                );
                request.url = landed;
                checked = Ok(probe);
            }
        }
        let probe = match checked {
            Ok(probe) => probe,
            Err(reason) => {
                log::info!("downloads: browser keeps the download ({reason:?})");
                if reason == FallbackReason::Unreachable {
                    unreachable::tell(app, &request.url, preferences::proxy_on(&prefs));
                }
                return Ok(AddResponse::fallback(reason));
            }
        };
        size = probe
            .total_length
            .as_deref()
            .and_then(|length| length.parse().ok())
            .filter(|size| *size > 0)
            .or(size);
        log::info!(
            "downloads: engine verified the download: status={} size={:?} resumable={} redirected={}",
            probe.status,
            probe.total_length,
            probe.resumable,
            probe.final_url != request.url
        );
    }
    if prefs.extension_download_behavior == preferences::ExtensionDownloadBehavior::Confirm {
        return confirm(app, &request, size).await;
    }
    let gid = submit(app, vec![request.url.clone()], options, None).await?;
    if prefs.extension_download_behavior == preferences::ExtensionDownloadBehavior::Show {
        super::frontend_action::dispatch_frontend_action(
            app,
            super::frontend_action::FrontendActionChannel::TrayMenuAction,
            super::frontend_action::FrontendActionKind::ShowDownloads,
            "http-api",
        );
    }
    Ok(AddResponse::added(gid))
}

fn page(mime: &str) -> bool {
    let essence = mime.split(';').next().unwrap_or_default().trim();
    essence.eq_ignore_ascii_case("text/html")
        || essence.eq_ignore_ascii_case("application/xhtml+xml")
}

/// What a download from a URL would receive, as the add dialog shows it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// Bytes the download would write; unknown for pages and stream playlists,
    /// which the engine does not save as they come.
    pub size: Option<u64>,
    /// The name the engine would give the file.
    pub filename: String,
}

/// The size a successful probe promises, if the download would be that body.
fn previewed_size(probe: &Aria2Probe) -> Option<u64> {
    let essence = probe
        .content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if page(&essence) || essence.ends_with("mpegurl") || essence == "application/dash+xml" {
        return None;
    }
    probe.total_length.as_deref()?.parse().ok()
}

/// Requests the first byte of `url` the way a task with `options` would,
/// after the site rules and saved credentials that task would get.
pub async fn preview(
    app: &AppHandle,
    url: &str,
    mut options: serde_json::Value,
) -> Result<Preview, AppError> {
    let prefs = preferences::load(app)?;
    let uris = [url.to_owned()];
    preferences::apply_system_proxy(&prefs, &uris, &mut options);
    preferences::apply_site_rules(&prefs, &uris, &mut options);
    native::apply_saved_credentials(
        &app.state::<crate::database::DatabaseState>().0,
        &uris,
        &mut options,
    )
    .await?;
    let engine = app.state::<TaskServiceState>().0.clone();
    let probe = engine.probe(url, options).await?;
    if !probe.status.starts_with('2') || probe.error.is_some() {
        return Err(AppError::Io(match (probe.status.as_str(), &probe.error) {
            ("0", Some(error)) => format!("No response: {error}"),
            ("0", None) => "No response".into(),
            (status, _) => format!("The server answered HTTP {status}"),
        }));
    }
    let disposition = probe
        .filename
        .as_deref()
        .map(|name| format!("attachment; filename*=UTF-8''{}", urlencoding::encode(name)))
        .unwrap_or_default();
    let filename = engine
        .resolve_filename(&probe.final_url, disposition.into_bytes())
        .await?;
    Ok(Preview {
        size: previewed_size(&probe),
        filename,
    })
}

/// Why the engine must not take over what the browser is downloading.
/// Requests the first byte of `url` the way the task would, or names why the
/// browser should keep the download.
async fn check(
    engine: &TaskService,
    url: &str,
    options: serde_json::Value,
    request: &AddRequest,
) -> Result<Result<Aria2Probe, FallbackReason>, AppError> {
    let Ok(probe) = tokio::time::timeout(VERIFY_TIMEOUT, engine.probe(url, options)).await else {
        log::info!("downloads: the engine check took too long");
        return Ok(Err(FallbackReason::Unreachable));
    };
    let probe = probe?;
    Ok(match refusal(&probe, request) {
        None => Ok(probe),
        Some(reason) => {
            log::info!(
                "downloads: the engine check failed ({reason:?}): status={} type={:?} size={:?} error={:?}",
                probe.status,
                probe.content_type,
                probe.total_length,
                probe.error
            );
            Err(reason)
        }
    })
}

/// The web address the browser's download ended at, when it is not the link.
fn landed(request: &AddRequest) -> Option<&str> {
    request.final_url.as_deref().filter(|landed| {
        *landed != request.url
            && url::Url::parse(landed).is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
    })
}

/// Options for fetching `landed` directly: the cookie the browser read for the
/// link's site is not sent to another site.
fn for_landed(link: &str, landed: &str, mut options: serde_json::Value) -> serde_json::Value {
    let host = |url: &str| url::Url::parse(url).ok()?.host_str().map(str::to_owned);
    if host(link) != host(landed) {
        if let Some(headers) = options["header"].as_array_mut() {
            headers.retain(|header| {
                !header.as_str().is_some_and(|header| {
                    header
                        .split_once(':')
                        .is_some_and(|(name, _)| name.trim().eq_ignore_ascii_case("cookie"))
                })
            });
        }
    }
    options
}

fn refusal(probe: &Aria2Probe, request: &AddRequest) -> Option<FallbackReason> {
    if probe.status == "0" {
        return Some(FallbackReason::Unreachable);
    }
    if probe.error.is_some() || !probe.status.starts_with('2') {
        return Some(FallbackReason::Rejected);
    }
    if page(&probe.content_type) && !request.mime.as_deref().is_some_and(page) {
        return Some(FallbackReason::WebPage);
    }
    let size = probe
        .total_length
        .as_deref()
        .and_then(|length| length.parse::<i64>().ok());
    match (request.size.filter(|size| *size > 0), size) {
        (Some(expected), Some(actual)) if expected != actual => Some(FallbackReason::SizeMismatch),
        _ => None,
    }
}

/// Holds the browser download while the user decides in the add dialog, or,
/// with an early acknowledgement, hands it to the dialog at once.
async fn confirm(
    app: &AppHandle,
    request: &AddRequest,
    size: Option<u64>,
) -> Result<AddResponse, AppError> {
    if request.ack == Ack::Early {
        show_confirmation(app, request, None, size);
        return Ok(AddResponse::accepted());
    }
    let handoffs = app.state::<Handoffs>();
    let emitter = app.clone();
    let pending = handoffs.open(Box::new(move |id| {
        let _ = emitter.emit(handoff::EXPIRED_EVENT, serde_json::json!({ "id": id }));
    }));
    show_confirmation(app, request, Some(pending.id()), size);
    Ok(match pending.wait(CONFIRMATION_TIMEOUT).await {
        Some(handoff::Outcome::Added(gid)) => AddResponse::added(gid),
        Some(handoff::Outcome::Cancelled) => AddResponse::cancelled(),
        None => AddResponse::fallback(FallbackReason::Unconfirmed),
    })
}

pub fn validate_uris(uris: &[String]) -> Result<(), AppError> {
    if uris.is_empty() {
        return Err(AppError::InvalidInput("Enter a download URL".into()));
    }
    for uri in uris {
        let parsed = url::Url::parse(uri)
            .map_err(|_| AppError::InvalidInput("Invalid download URL".into()))?;
        if !matches!(parsed.scheme(), "http" | "https" | "ftp" | "sftp") {
            return Err(AppError::InvalidInput("Unsupported download URL".into()));
        }
    }
    Ok(())
}

async fn create_task(
    engine: &crate::services::tasks::TaskService,
    uris: Vec<String>,
    mut options: serde_json::Value,
) -> Result<String, AppError> {
    let options_map = options
        .as_object_mut()
        .ok_or_else(|| AppError::InvalidInput("Download options must be an object".into()))?;
    let gid = options_map
        .entry("gid")
        .or_insert_with(|| {
            uuid::Uuid::new_v4().simple().to_string()[..16]
                .to_string()
                .into()
        })
        .as_str()
        .ok_or_else(|| AppError::InvalidInput("Invalid task ID".into()))?
        .to_owned();
    engine.tasks.expect_start(&gid).await;
    let result = engine.add_uri(uris, options).await;
    if matches!(
        result,
        Err(AppError::Rpc { .. } | AppError::InvalidInput(_))
    ) {
        engine.tasks.take_start(&gid).await;
    }
    result
}

/// Creates a task. `request_id` names the browser download the add dialog
/// confirms; it answers that download once the task exists.
pub async fn submit(
    app: &AppHandle,
    uris: Vec<String>,
    mut options: serde_json::Value,
    request_id: Option<&str>,
) -> Result<String, AppError> {
    let engine = app.state::<TaskServiceState>().0.clone();
    let handoffs = app.state::<Handoffs>();
    let claim = request_id.map(|id| handoffs.claim(id)).transpose()?;
    preferences::validate_save_location(app, &options)?;
    let prefs = preferences::load(app)?;
    validate_uris(&uris)?;
    preferences::apply_system_proxy(&prefs, &uris, &mut options);
    preferences::apply_site_rules(&prefs, &uris, &mut options);
    let automatic = native::prepare(app, &engine, &uris, &mut options).await?;
    let generation = engine.generation();
    let _mutation = engine.mutation.lock().await;
    let result = create_task(&engine, uris, options).await;
    if let Ok(gid) = &result {
        if let Some(claim) = claim {
            claim.finish(gid.clone());
        }
        super::pump::wake(app);
    }
    drop(_mutation);
    native::finish(app.clone(), engine, automatic, generation).await;
    result
}

/// Shows the download in the add dialog; `id` holds it for the browser
/// until the dialog decides.
fn show_confirmation(app: &AppHandle, request: &AddRequest, id: Option<&str>, size: Option<u64>) {
    let input = crate::services::external_input::ExternalDownloadInput {
        request_id: id.map(str::to_owned),
        filename_source: Some(request.filename_source),
        url: request.url.clone(),
        final_url: request.final_url.clone(),
        referer: request.referer.clone(),
        cookie: request.cookie.clone(),
        filename: request.filename.clone(),
        user_agent: request.user_agent.clone(),
        request_headers: request.request_headers.clone(),
        source: Some("http-api".into()),
        size,
    };
    crate::services::external_input::route_external_inputs(app, vec![input], "http-api", false);
}

/// The user declined a browser download in the add dialog.
pub fn cancel(app: &AppHandle, id: &str) {
    app.state::<Handoffs>().cancel(id);
}

#[cfg(test)]
mod tests;
