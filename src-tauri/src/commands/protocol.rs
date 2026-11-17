//! Read-only native protocol association status and diagnostics.
use crate::error::AppError;
use tauri::AppHandle;

// ── macOS native implementation ─────────────────────────────────────

#[cfg(target_os = "macos")]
mod macos;

// Query the effective Shell association, not an application-owned registry key.
#[cfg(windows)]
mod windows;

// ── Linux native associations ──────────────────────────────────────

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "linux")]
async fn with_linux_associations<T: Send + 'static>(
    app: &AppHandle,
    operation: impl FnOnce(&linux::Associations) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    use tauri::Manager;

    let executable = match app.env().appimage {
        Some(path) => std::path::PathBuf::from(path),
        None => tauri::utils::platform::current_exe()?,
    };
    tokio::task::spawn_blocking(move || {
        // GIO objects stay on this worker.
        operation(&linux::Associations::new(&executable)?)
    })
    .await
    .map_err(|error| AppError::Protocol(error.to_string()))?
}

#[cfg(target_os = "linux")]
pub(crate) async fn protocol_diagnostics(app: &AppHandle) -> serde_json::Value {
    match with_linux_associations(app, |associations| Ok(associations.diagnostics())).await {
        Ok(snapshot) => snapshot,
        Err(error) => serde_json::json!({ "error": error.to_string() }),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssociationStatus {
    state: &'static str,
    handler: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn get_association_status(
    app: AppHandle,
    protocol: String,
) -> Result<AssociationStatus, AppError> {
    validate_protocol(&protocol)?;
    #[cfg(windows)]
    let result = windows::handler(&protocol).map(|handler| {
        let current = std::env::current_exe().ok();
        let state = match &handler.path {
            None if handler.unavailable => "unavailable",
            None => "unassigned",
            Some(path) if !path.is_file() => "unavailable",
            Some(path)
                if current.as_ref().is_some_and(|expected| {
                    dunce::simplified(path)
                        .to_string_lossy()
                        .eq_ignore_ascii_case(&dunce::simplified(expected).to_string_lossy())
                }) =>
            {
                "current"
            }
            Some(_) => "other",
        };
        (
            state,
            handler.path.map(|path| path.to_string_lossy().into_owned()),
        )
    });
    #[cfg(target_os = "macos")]
    let result = Ok::<_, AppError>(match macos::get_default_handler_bundle_id(&protocol) {
        Some(handler) => (
            if handler == app.config().identifier {
                "current"
            } else {
                "other"
            },
            Some(handler),
        ),
        None => ("unassigned", None),
    });
    #[cfg(target_os = "linux")]
    let result =
        with_linux_associations(&app, move |associations| associations.status(&protocol)).await;
    let _ = app;
    Ok(match result {
        Ok((state, handler)) => AssociationStatus {
            state,
            handler,
            error: None,
        },
        Err(error) => AssociationStatus {
            state: "error",
            handler: None,
            error: Some(error.to_string()),
        },
    })
}

fn validate_protocol(protocol: &str) -> Result<(), AppError> {
    if matches!(protocol, "rayburst" | "thunder") {
        Ok(())
    } else {
        Err(AppError::Protocol("Unsupported protocol".into()))
    }
}

#[cfg(windows)]
pub(crate) async fn protocol_diagnostics(_app: &AppHandle) -> serde_json::Value {
    let mut protocols = serde_json::Map::new();
    for scheme in ["rayburst", "thunder"] {
        let snapshot = match windows::handler(scheme) {
            Ok(handler) => serde_json::json!({
                "handler": handler.path,
                "unavailable": handler.unavailable,
                "currentApplication": windows::is_default(scheme).ok(),
            }),
            Err(error) => serde_json::json!({ "error": error.to_string() }),
        };
        protocols.insert(scheme.into(), snapshot);
    }
    serde_json::Value::Object(protocols)
}

#[cfg(target_os = "macos")]
pub(crate) async fn protocol_diagnostics(app: &AppHandle) -> serde_json::Value {
    let mut associations = serde_json::Map::new();
    for scheme in ["rayburst", "thunder"] {
        let snapshot = match get_association_status(app.clone(), scheme.into()).await {
            Ok(status) => serde_json::json!(status),
            Err(error) => serde_json::json!({ "error": error.to_string() }),
        };
        associations.insert(scheme.into(), snapshot);
    }
    serde_json::Value::Object(associations)
}
