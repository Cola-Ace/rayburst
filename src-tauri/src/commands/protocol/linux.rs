//! Linux associations use the installed desktop identity and GIO's XDG implementation.

use crate::error::AppError;
use gio::{glib, prelude::*, AppInfo};
use std::path::{Path, PathBuf};

pub const DESKTOP_ID: &str = "Rayburst.desktop";
pub const PROTOCOLS: [&str; 2] = ["thunder", "rayburst"];

fn failure(context: &str, error: impl std::fmt::Display) -> AppError {
    AppError::Protocol(format!("{context}: {error}"))
}

pub struct Associations {
    executable: PathBuf,
}

impl Associations {
    pub fn new(executable: &Path) -> Result<Self, AppError> {
        let executable = executable
            .canonicalize()
            .map_err(|error| failure("resolve application executable", error))?;
        Ok(Self { executable })
    }

    fn owns(&self, info: &AppInfo) -> bool {
        // AppInfo::executable does not reliably unquote Exec. Use GLib's parser,
        // as DesktopAppInfo does, without executing the command or matching names.
        info.commandline()
            .and_then(|command| glib::shell_parse_argv(command).ok())
            .and_then(|arguments| arguments.into_iter().next())
            .and_then(glib::find_program_in_path)
            .and_then(|path| path.canonicalize().ok())
            .is_some_and(|path| path == self.executable)
    }

    pub fn status(&self, protocol: &str) -> Result<(&'static str, Option<String>), AppError> {
        validate(protocol)?;
        let handler = default_handler(protocol);
        let state = match &handler {
            None => "unassigned",
            Some(info) if self.owns(info) => "current",
            Some(_) => "other",
        };
        Ok((
            state,
            handler.and_then(|info| info.id()).map(|id| id.to_string()),
        ))
    }

    pub fn diagnostics(&self) -> serde_json::Value {
        let protocols: Vec<_> = PROTOCOLS
            .iter()
            .map(|protocol| {
                let handler = default_handler(protocol);
                serde_json::json!({
                    "scheme": protocol,
                    "is_default": handler.as_ref().is_some_and(|info| self.owns(info)),
                    "handler": handler.and_then(|info| info.id()).map(|id| id.to_string()),
                })
            })
            .collect();
        serde_json::json!({
            "desktop_id": DESKTOP_ID,
            "executable": self.executable,
            "current_desktop": std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default(),
            "config_directory": glib::user_config_dir(),
            "data_directory": glib::user_data_dir(),
            "protocols": protocols,
        })
    }
}

fn default_handler(protocol: &str) -> Option<AppInfo> {
    AppInfo::default_for_uri_scheme(protocol)
}

fn validate(protocol: &str) -> Result<(), AppError> {
    if PROTOCOLS.contains(&protocol) {
        Ok(())
    } else {
        Err(failure("unsupported protocol", protocol))
    }
}
