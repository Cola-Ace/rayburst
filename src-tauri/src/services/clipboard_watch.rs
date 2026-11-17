//! Offers links copied in other applications while Rayburst stays in the
//! background (#793, #797). The main window otherwise reads the clipboard
//! only when it gains focus. Watching every copy is opt-in, as in other
//! download managers.
//!
//! The add window takes the link: opened for manual entry, it reads the
//! clipboard and applies the same filter as here (`detectResource`).
use super::config::{ClipboardConfig, RuntimeConfigState};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

const TICK: Duration = Duration::from_millis(800);
const MAX_CHARS: usize = 100_000;
const MAX_LINES: usize = 200;
const ALL_TAGS: [&str; 4] = ["http://", "https://", "sftp://", "thunder://"];
const WEB_PAGE_EXTENSIONS: [&str; 13] = [
    "html", "htm", "xhtml", "shtml", "php", "asp", "aspx", "jsp", "jspx", "cfm", "cgi", "do",
    "action",
];

/// A number that changes with every copy, where the system keeps one; reading
/// it is far cheaper than reading the text.
#[cfg(windows)]
fn change_count() -> Option<u64> {
    // SAFETY: takes no arguments and only reads a counter.
    Some(unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() }.into())
}

#[cfg(target_os = "macos")]
fn change_count() -> Option<u64> {
    let board = objc2_app_kit::NSPasteboard::generalPasteboard();
    u64::try_from(board.changeCount()).ok()
}

#[cfg(not(any(windows, target_os = "macos")))]
fn change_count() -> Option<u64> {
    None
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(TICK);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        // What the clipboard held when watching began is not offered (#738).
        let mut watching = false;
        let mut count = None;
        loop {
            interval.tick().await;
            let config = app
                .state::<RuntimeConfigState>()
                .0
                .read()
                .await
                .clipboard
                .clone();
            if !config.enable || !config.background {
                watching = false;
                continue;
            }
            let now = change_count();
            if watching && now.is_some() && now == count {
                continue;
            }
            count = now;
            let Ok(text) = app.clipboard().read_text() else {
                watching = true;
                continue;
            };
            if !watching {
                watching = true;
                crate::commands::clipboard_offer(text);
                continue;
            }
            // A copy inside Rayburst is not a link to download.
            let focused = app
                .webview_windows()
                .values()
                .any(|window| window.is_focused().unwrap_or(false));
            if focused || !detect(&text, &config) || !crate::commands::clipboard_offer(text) {
                continue;
            }
            log::info!("clipboard: a copied link opens the add window");
            super::add_window::route(
                &app,
                super::add_window::AddWindowInputs {
                    manual: true,
                    ..Default::default()
                },
                "clipboard",
            );
        }
    });
}

fn is_file_url(url: &str) -> bool {
    let Ok(url) = url::Url::parse(url) else {
        return false;
    };
    let name = url.path().rsplit('/').next().unwrap_or_default();
    name.rsplit_once('.').is_some_and(|(_, extension)| {
        (1..=8).contains(&extension.len())
            && extension.chars().all(|ch| ch.is_ascii_alphanumeric())
            && !WEB_PAGE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
    })
}

fn allowed_tags(config: &ClipboardConfig) -> Vec<&'static str> {
    [
        (config.http, &["http://", "https://"][..]),
        (config.sftp, &["sftp://"]),
        (config.thunder, &["thunder://"]),
    ]
    .into_iter()
    .filter(|(on, _)| *on)
    .flat_map(|(_, tags)| tags.iter().copied())
    .collect()
}

fn resource(line: &str, tags: &[&str], files_only: bool) -> bool {
    let lower = line.to_ascii_lowercase();
    if files_only
        && (lower.starts_with("http://") || lower.starts_with("https://"))
        && !is_file_url(line)
    {
        return false;
    }
    tags.iter()
        .any(|tag| lower.starts_with(tag) && line.len() > tag.len())
}

/// Whether the text is only links, as `detectResource` decides: one link or
/// hash, or an aria2 input list whose lines are links and indented options.
pub(crate) fn detect(text: &str, config: &ClipboardConfig) -> bool {
    if !config.enable || text.is_empty() || text.chars().count() > MAX_CHARS {
        return false;
    }
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.is_empty() || lines.len() > MAX_LINES {
        return false;
    }
    if let [line] = lines[..] {
        return resource(line, &allowed_tags(config), config.http_files_only);
    }
    let mut entry = false;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let indented = raw.starts_with([' ', '\t']);
        let option = line.split_once('=').is_some_and(|(key, _)| {
            !key.is_empty()
                && key
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
        });
        if indented && option && entry {
            continue;
        }
        let uris: Vec<&str> = line
            .split('\t')
            .map(str::trim)
            .filter(|uri| !uri.is_empty())
            .collect();
        if uris.is_empty()
            || !uris.iter().all(|uri| {
                resource(uri, &ALL_TAGS, false)
                    && (!config.http_files_only
                        || !uri.to_ascii_lowercase().starts_with("http")
                        || is_file_url(uri))
            })
        {
            return false;
        }
        entry = true;
    }
    entry
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ClipboardConfig {
        ClipboardConfig {
            background: true,
            ..ClipboardConfig::default()
        }
    }
    #[test]
    fn copied_links_obey_the_remaining_protocol_filters() {
        let mut settings = config();
        assert!(detect("https://example.test/file.zip", &settings));
        assert!(detect("sftp://example.test/file.zip", &settings));
        assert!(!detect("magnet:?xt=urn:btih:abc", &settings));
        assert!(!detect("ed2k://|file|a.zip|1|abc|/", &settings));
        assert!(!detect(
            "0123456789abcdef0123456789abcdef01234567",
            &settings
        ));
        settings.http = false;
        assert!(!detect("https://example.test/file.zip", &settings));
    }
}
