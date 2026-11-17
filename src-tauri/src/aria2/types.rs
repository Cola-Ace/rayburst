//! Aria2 JSON-RPC data transfer objects.
//!
//! All fields use `String` to match the aria2 JSON-RPC protocol where every
//! numeric value is represented as a string.  `#[serde(rename_all = "camelCase")]`
//! maps Rust snake_case fields to the camelCase keys emitted by aria2.

use serde::{Deserialize, Serialize};

/// URI entry within an aria2 file descriptor.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Aria2FileUri {
    pub uri: String,
    pub status: String,
}

/// Single file within an aria2 download task.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Aria2File {
    pub index: String,
    pub path: String,
    pub length: String,
    pub completed_length: String,
    pub selected: String,
    #[serde(default)]
    pub uris: Vec<Aria2FileUri>,
}

/// Native media counters use milliseconds, bytes, and decimal strings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Aria2Media {
    pub state: String,
    pub protocol: String,
    pub live: String,
    pub duration: String,
    pub completed_duration: String,
    pub downloaded_length: String,
    pub length_known: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<String>,
    pub error: String,
    pub tracks: Vec<Aria2MediaTrack>,
    #[serde(default)]
    pub error_code: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Aria2MediaTrack {
    pub id: String,
    pub r#type: String,
    pub language: String,
    pub codec: String,
    pub width: String,
    pub height: String,
    pub bandwidth: String,
    #[serde(default, rename = "frameRate")]
    pub frame_rate: String,
    pub selected: String,
}

/// Complete aria2 task object returned by tellStatus, tellActive,
/// tellWaiting, or tellStopped.
///
/// All numeric values are strings per the aria2 JSON-RPC protocol.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Aria2Task {
    #[serde(default)]
    pub selection_managed: bool,
    #[serde(default)]
    pub bitfield: Option<String>,
    #[serde(default)]
    pub num_pieces: Option<String>,
    #[serde(default)]
    pub piece_length: Option<String>,
    pub gid: String,
    pub status: String,
    pub total_length: String,
    pub completed_length: String,
    pub download_speed: String,
    pub connections: String,
    pub dir: String,
    #[serde(default)]
    pub files: Vec<Aria2File>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<Aria2Media>,
    #[serde(default)]
    pub error_code: Option<String>,
    #[serde(default)]
    pub error_message: Option<String>,
    #[serde(default)]
    pub verified_length: Option<String>,
    #[serde(default)]
    pub verify_integrity_pending: Option<String>,
    #[serde(default)]
    pub followed_by: Option<Vec<String>>,
    #[serde(default)]
    pub following: Option<String>,
    #[serde(default)]
    pub belongs_to: Option<String>,
    /// Set when the WebView snapshot carries only some of the files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files_total: Option<usize>,
}

/// What a download of an HTTP(S) URL would receive (`aria2.probe`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Aria2Probe {
    /// Final HTTP status; "0" when no response arrived.
    pub status: String,
    pub final_url: String,
    #[serde(default)]
    pub content_type: String,
    pub total_length: Option<String>,
    /// The name Content-Disposition gives, when it gives one.
    #[serde(default)]
    pub filename: Option<String>,
    pub resumable: String,
    pub error: Option<String>,
}

/// Raw global statistics as returned by aria2 RPC (all values are strings).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Aria2GlobalStat {
    pub download_speed: String,
    pub num_active: String,
    pub num_waiting: String,
    pub num_stopped: String,
    pub num_stopped_total: String,
}

// ── Internal JSON-RPC protocol types ────────────────────────────────

/// JSON-RPC 2.0 request envelope.
#[derive(Debug, Serialize)]
pub(crate) struct JsonRpcRequest {
    pub jsonrpc: &'static str,
    pub id: String,
    pub method: String,
    pub params: Vec<serde_json::Value>,
}

/// JSON-RPC 2.0 response envelope.
#[derive(Debug, Deserialize)]
pub(crate) struct JsonRpcResponse<T> {
    pub result: Option<T>,
    pub error: Option<JsonRpcError>,
}

/// JSON-RPC 2.0 error object.
#[derive(Debug, Deserialize)]
pub(crate) struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Aria2Task deserialization ────────────────────────────────────

    #[test]
    fn deserialize_minimal_task_from_aria2_json() {
        let json = serde_json::json!({
            "gid": "abc123",
            "status": "active",
            "totalLength": "1024",
            "completedLength": "512",
            "downloadSpeed": "100",
            "connections": "5",
            "dir": "/tmp"
        });
        let task: Aria2Task = serde_json::from_value(json).expect("deserialize");
        assert_eq!(task.gid, "abc123");
        assert_eq!(task.status, "active");
        assert_eq!(task.total_length, "1024");
        assert_eq!(task.completed_length, "512");
        assert!(task.files.is_empty());
        assert!(task.error_code.is_none());
    }

    #[test]
    fn deserialize_task_with_error_fields() {
        let json = serde_json::json!({
            "gid": "err001",
            "status": "error",
            "totalLength": "0",
            "completedLength": "0",
            "downloadSpeed": "0",
            "connections": "0",
            "dir": "/tmp",
            "errorCode": "1",
            "errorMessage": "unknown error"
        });
        let task: Aria2Task = serde_json::from_value(json).expect("deserialize");
        assert_eq!(task.error_code.as_deref(), Some("1"));
        assert_eq!(task.error_message.as_deref(), Some("unknown error"));
    }

    #[test]
    fn deserialize_task_with_followed_by() {
        let json = serde_json::json!({
            "gid": "meta001",
            "status": "complete",
            "totalLength": "100",
            "completedLength": "100",
            "downloadSpeed": "0",
            "connections": "0",
            "dir": "/tmp",
            "followedBy": ["child001", "child002"],
            "following": "parent001",
            "belongsTo": "parent001"
        });
        let task: Aria2Task = serde_json::from_value(json).expect("deserialize");
        assert_eq!(
            task.followed_by.as_deref(),
            Some(&["child001".to_string(), "child002".to_string()][..])
        );
        assert_eq!(task.following.as_deref(), Some("parent001"));
        assert_eq!(task.belongs_to.as_deref(), Some("parent001"));
    }

    // ── Aria2GlobalStat deserialization ──────────────────────────────

    #[test]
    fn deserialize_global_stat() {
        let json = serde_json::json!({
            "downloadSpeed": "1048576",
            "numActive": "3",
            "numWaiting": "1",
            "numStopped": "10",
            "numStoppedTotal": "100"
        });
        let stat: Aria2GlobalStat = serde_json::from_value(json).expect("deserialize");
        assert_eq!(stat.download_speed, "1048576");
        assert_eq!(stat.num_active, "3");
        assert_eq!(stat.num_stopped_total, "100");
    }

    // ── Aria2File deserialization ────────────────────────────────────

    #[test]
    fn deserialize_file_with_uris() {
        let json = serde_json::json!({
            "index": "1",
            "path": "/tmp/file.zip",
            "length": "1000",
            "completedLength": "500",
            "selected": "true",
            "uris": [
                { "uri": "http://example.com/file.zip", "status": "used" }
            ]
        });
        let file: Aria2File = serde_json::from_value(json).expect("deserialize");
        assert_eq!(file.index, "1");
        assert_eq!(file.path, "/tmp/file.zip");
        assert_eq!(file.uris.len(), 1);
        assert_eq!(file.uris[0].status, "used");
    }

    // ── JsonRpcRequest serialization ────────────────────────────────

    #[test]
    fn jsonrpc_request_serializes_correctly() {
        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id: "rayburst".to_string(),
            method: "aria2.getGlobalStat".to_string(),
            params: vec![serde_json::Value::String("token:secret123".to_string())],
        };
        let json = serde_json::to_value(&req).expect("serialize");
        assert_eq!(json["jsonrpc"], "2.0");
        assert_eq!(json["id"], "rayburst");
        assert_eq!(json["method"], "aria2.getGlobalStat");
        assert_eq!(json["params"][0], "token:secret123");
    }

    // ── JsonRpcResponse deserialization ──────────────────────────────

    #[test]
    fn jsonrpc_response_with_result() {
        let json = serde_json::json!({
            "id": "rayburst",
            "jsonrpc": "2.0",
            "result": "OK"
        });
        let resp: JsonRpcResponse<String> = serde_json::from_value(json).expect("deserialize");
        assert_eq!(resp.result.as_deref(), Some("OK"));
        assert!(resp.error.is_none());
    }

    #[test]
    fn jsonrpc_response_with_error() {
        let json = serde_json::json!({
            "id": "rayburst",
            "jsonrpc": "2.0",
            "error": { "code": -32600, "message": "Invalid Request" }
        });
        let resp: JsonRpcResponse<String> = serde_json::from_value(json).expect("deserialize");
        assert!(resp.result.is_none());
        let err = resp.error.unwrap();
        assert_eq!(err.code, -32600);
        assert_eq!(err.message, "Invalid Request");
    }
    #[test]
    fn media_survives_task_serialization_without_fabricating_live_progress() {
        let task = Aria2Task {
            media: Some(Aria2Media {
                live: "true".into(),
                state: "recording".into(),
                completed_duration: "12000".into(),
                downloaded_length: "1024".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let value = serde_json::to_value(&task).unwrap();
        assert_eq!(value["media"]["completedDuration"], "12000");
        assert!(value["media"].get("progress").is_none());
        let restored: Aria2Task = serde_json::from_value(value).unwrap();
        assert_eq!(restored.media.unwrap().live, "true");
    }
}
