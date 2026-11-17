# Download ownership and handoff

The desktop, browser extension and engine are independent projects. Each owns its
source, dependencies, artifacts and tests. Their parent directory is only a local
workspace. No shared runtime package or cross-repository test harness is required.

## Responsibilities

| Owner             | Responsibility                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Browser extension | Intercept browser intent, capture observed names and request context, hold the browser download until the desktop answers. |
| Rust desktop      | Apply application preferences, verify handoffs with the engine, hold confirmations, create/control tasks, persist history. |
| Vue desktop       | Edit user intent, present native task state, select content and invoke named commands.                                     |
| Aria2 Next        | Resolve final output names and paths, handle conflicts and recovery, transfer data and publish completed media.            |

`aria2/rpc.rs` owns HTTP JSON-RPC framing, authentication and structured errors.
`services/tasks/` owns task queries, controls and visibility policy.
`services/downloads/` owns ordinary submission, including manual URI
creation. `services/media/` owns media inspection and selection. Policy does not
belong in the RPC transport. OS deep-link parsing still feeds the desktop dialog;
browser HTTP submissions run in Rust without requiring a mounted WebView.

## Output names

The editable name is one basename: native submission rejects paths, separators,
reserved names and control characters. The save directory remains a separate input.
The dialog displays browser metadata or the URL name without making it an explicit
override. For HTTP downloads whose size the browser did not report, the dialog asks
the engine's `aria2.probe` for the first byte, as the download would request it with
its site rules and saved credentials, and shows the size and the name the engine
would give; it waits for typing to settle, reads four at a time, at most the first
50, and cancels reads the user moved past. Pages and stream playlists show no size.
The lookup button reads the single download again and takes its name over the
browser's; no read creates a task.

Completed, inactive single files can be renamed from task details. Native exclusive
rename preserves existing destination files. A SQLite intent records filesystem work
before it starts and reconciles an interrupted history update at startup. Active
tasks retain engine ownership and cannot be renamed through this operation.

For a new ordinary HTTP task, the engine applies this precedence:

1. An explicit user `out` or an already persisted output path.
2. A browser-resolved `filename-hint` with source `browser`.
3. The final payload response's `Content-Disposition` (`filename*` before `filename`).
4. A `suggested` filename hint, then the final URL basename, then the engine default.

Hints are decoded text, not paths. The engine applies its path rules. URL components
are decoded once; literal percent sequences in names, passwords and restored paths
remain literal. The desktop makes no separate HEAD/GET request to guess a name.

For media, `filename-hint-source=title` preserves dots in a page title and appends
the selected container extension. Filename hints and explicit `out` values have
their extension replaced by the selected container. The engine owns publication
and collision handling. Vue never rewrites the native output name on selection.
Directory classification uses the native `services/downloads/category.rs` policy
for browser submissions and frontend previews/submissions. Rules declare a
`directoryMode` of `relative` (under the current default directory) or `absolute`
(a fixed directory). Built-in rules store relative subdirectories. An explicit
per-task directory bypasses classification. File sets must resolve to one directory;
mixed or unclassified content keeps its base directory. Classification uses the
available URL or filename hint, without a separate naming request.
Completed files are never moved by the WebView, and native output paths remain
authoritative. Rules without the current directory mode must be configured again.

The header rules follow [RFC 6266](https://www.rfc-editor.org/rfc/rfc6266.html).
The existing aria2 header parser and libcurl handle protocol decoding. A bounded
encoded-word adapter is confined to HTTP header values from nonconforming servers;
it is not a general charset detector or a second pass over browser names.

## Ordinary browser API, protocol 3

The desktop owns the contract in `services/downloads/contracts.rs`. The extension
validates the fields it consumes in its own repository. Both endpoints use the
configured Extension API authentication and origin policy; the body limit is 256 KiB.

`GET /downloads/capabilities` answers `{ "product": "rayburst", "protocolVersion": 3 }`
once the engine responds. A client checks it before each handoff; there is no legacy
fallback protocol.

`POST /add` accepts this shape (optional fields may be omitted):

```json
{
  "url": "https://example.com/download",
  "filename": "report%20.pdf",
  "filenameSource": "browser",
  "requestHeaders": [],
  "verify": true,
  "mime": "application/pdf",
  "size": 1048576
}
```

Optional fields are `finalUrl`, `referer`, `cookie`, `userAgent`, `filename`,
`filenameSource` (`browser` or `suggested`, default `suggested`), `requestHeaders`
(`{name,value}` pairs) and, for downloads the browser holds, `verify` with the MIME
type and size the browser received, and `ack` (`final`, the default, or `early`).
Supported inputs are HTTP(S), FTP and SFTP.

The browser keeps holding its download until the answer, and only the answer
decides who downloads it:

- `{ "action": "added", "gid": … }`: the engine owns the download.
- `{ "action": "accepted" }` (only with `ack: "early"`): the add dialog shows the
  download and owns it from now on; the browser drops its copy.
- `{ "action": "cancelled" }`: the user declined it in the add dialog.
- `{ "action": "fallback", "reason": … }`: the browser continues. Reasons are
  `unreachable` (no response), `rejected` (HTTP error), `web-page` (the engine got
  HTML where the browser got a file, typically a missing session), `size-mismatch`
  and `unconfirmed` (the dialog was not answered within 120 s).

With `verify`, the engine requests the first byte of the URL with the browser's
request context (`aria2.probe`) before anything is created; a check that takes
longer than 8 s answers `unreachable`. Chromium names a held download after 15 s
whatever the extension does, so the answer has to come before. With the confirm
behavior, `ack: "early"` is answered `accepted` once the
add dialog shows the download: the dialog has no time limit, several downloads can
gather in it, and closing it discards them, as in other download managers. With
`ack: "final"` the request stays open while the dialog shows the download; closing
the dialog answers `cancelled`, and a request that times out or whose extension
disconnects is withdrawn from the dialog. The dialog shows the
size the engine's check (or else the browser) reported, with the free space of the
chosen folder, and warns when it does not fit. Nothing is persisted:
an error or a lost answer leaves the download to the browser, so no download is
lost. Invalid input returns 400; an unavailable engine returns 503.

`GET /tasks` lists unfinished tasks in queue order and the ten latest finished
ones with the global statistics; `POST /tasks/{gid}/pause` and `…/resume` control
one task, and `…/reveal` shows its file, or its folder, on the desktop. These serve
the extension popup.

## Native storage and recovery

`database/` is the single connection owner for `history.db`: history, birth records,
HTTP credentials and rename journal. `schema.sql` defines the current
schema; `PRAGMA user_version` records it. Initialization runs from Rust startup.
Frontend stores expose named IPC operations and never execute SQL. Media
operations live in memory; their hidden engine task is the durable part.

SQLite transactions serialize history page/count queries.
History snapshots are unordered; the task store owns presentation sorting and reuses
the snapshot during periodic live refreshes. Only explicit invalidation reloads history.
Database browsing uses indexed default ordering with an ID tie-breaker for stable pages.
The current database layout is retained when opening existing data; unsupported
layouts fail explicitly. Data from a newer release is kept for it, and the app asks
for an update instead of offering a reset. There is no legacy migration runner or
automatic reset.
Only the user's explicit reset removes the database.

Saved HTTP passwords remain plaintext local data as before and are never URL decoded.

## Save locations and task files

Save locations use the current explicit choice, then the remembered explicit
choice (when enabled), then classification, then the default directory. Remembering
a location is opt-in and updates only after a successful user submission. Silent
browser submissions read the same preferences without changing the remembered path.

Task deletion resolves individual files from native snapshots and persisted history.
Other GIDs referencing the same path protect that file. No task operation infers
ownership of a whole directory or removes another record by content hash. A failed
file deletion retains its history record for retry.

After deleting files, native cleanup removes empty parent directories below the
task's save directory, deepest first. Download roots, category directories, shared
paths and nonempty directories remain. Cleanup does not traverse directory links;
permission failures retain the task record so cleanup can be retried.

`services/tasks/files.rs` watches selected completed files through `notify` and
checks them periodically when native filesystem events are unavailable. Cards consume one shared availability
stream. A double-click opens completed content and ignores controls, drag handles
and selected text.

Start notifications belong to the native task lifecycle and honor `notifyOnStart`.
Submitting metadata or displaying an in-app toast never duplicates an OS notification.
Authenticated readiness endpoints return `engine_starting` or `engine_unavailable`
when the desktop is reachable but cannot provide engine services. Connect retains
the desktop version and offers recovery instead of repeatedly activating the app.

## Submission policy

`services::downloads::submit` is the single entry for dialog and browser tasks.
Site rules cap `max-connection-per-server` for matching hosts there: a plain
pattern names a domain and its subdomains, `*` matches any characters, and the
lowest matching limit wins over a larger requested value. The dialog's speed
limit and checksum become `max-download-limit` and `checksum`; a checksum names
one file, so it applies to a single URI, and a mismatch fails the task.

Before submitting, the dialog asks the desktop for duplicates: live tasks with the
same source URI (ignoring fragments) and completed history records whose file still
exists. The user skips them, adds them anyway or returns to the form. Independently,
the engine never lets two unfinished tasks write one output path; the later task
takes a numbered name, or fails without `auto-file-renaming`.

An unfinished task's source can be replaced from task details. The desktop swaps
the URIs of single-file HTTP, FTP or SFTP tasks through `changeUri`, keeping the
downloaded data. A failed task is resubmitted with the new source instead.

Every new download is confirmed in the standalone add-task window
(`services/add_window.rs`); the main window has no add dialog and, while the engine
starts, forwards what it receives once the engine runs. The add window is
built hidden as soon as the main window is up; closing it only hides it, so it
appears without loading a webview. When lightweight mode releases the main
window into the tray, every webview goes with it: the hidden add window and
the floating orb, so no webview stays behind (#735). A download arriving then
builds the add window, and closing it destroys it again; the orb returns with
the main window. It receives later
handoffs while open and is put away after submission without raising the main
window. Auto-submitted downloads use it invisibly and put it away when the engine
accepted them. If it fails to open, its inputs wait for the next request.

The floating window (`services/float_window.rs`, preference `floatWindow`)
keeps the overall speed and progress on top of other windows. Its mode shows it
always, only while files download (not while paused), or never; the
settings, the orb's menu and the tray menu switch it. The pump opens and
closes it with the mode and sends it each snapshot's queue; while downloading
only, it lingers a moment after the last download to show its check. The orb
fills from the bottom with the overall progress, under the received speed
while downloading; otherwise its sign
tells what the queue waits for: servers, its turn or the user. The Rayburst
mark rests in it, and only a download of unknown size moves its fill. It can
be dragged anywhere. A click opens a panel centered beside it, a window of its
own built hidden with the orb, to pause or resume each download; dragging the
panel's header takes the orb along. Links dropped on the orb open in the add window.

Submissions accept only supported download protocols. Metainfo fetched over HTTP
is saved as an ordinary file.

When a task completes, the optional post-download program runs detached with the
configured arguments. Arguments split at unquoted whitespace, double quotes group,
and `{file}`, `{dir}` and `{name}` are replaced after splitting, so paths with
spaces stay one argument. Its exit status is only logged.

## Snapshots and API limits

The pump's WebView snapshot carries at most 64 files per task, selected files
first, and sets `filesTotal` when it trimmed the list; the task whose details are
open (`tasks_set_detailed`) keeps every file. Native consumers read the whole
list. Tasks first seen after the initial snapshot get a start notification
whoever added them, including RPC clients and other extensions.

The extension API bounds work per client class: 64 reads and 512 writes in flight
(held confirmations keep an `/add` open), and a write budget of a 256-request
burst refilled at 32 per second. Excess requests get `429` with `Retry-After: 1`;
the extension then leaves the download to the browser.

## Verification and packaging

Use `pnpm test --maxWorkers=4`, `pnpm build`, `pnpm lint`, `pnpm check:repo`,
`pnpm format:check`, and `cargo test --workspace --all-targets`.
Native tests cover real SQLite transactions and local HTTP JSON-RPC responses,
including lost creation replies, structured errors, invalid UTF-8 and removal order.
Frontend tests cover transformations and visible state rather than forwarding wrappers.
The engine repository owns executable transfer tests; the extension owns browser API
and worker replay fixtures. Manual acceptance uses the three separately built apps.

Every packaged platform needs a matching engine artifact. In addition to the media
contract described in [MEDIA.md](MEDIA.md), it must advertise `filename-hints`.
Updating one platform's binary does not update the other bundled targets. Do not
publish a multi-platform desktop release with unmatched sidecars.

Prefer the established native APIs and maintained stable dependencies. Choose LTS
when that dependency provides a useful support window; do not invent an LTS version
for community libraries. File length is a review signal, not a reason to split one
cohesive algorithm. Comments explain ownership, units and non-obvious constraints;
tests protect behavior, data integrity and recovery rather than implementation shape.

## Product identity

The desktop advertises `product: "rayburst"` in `/ping`, download capabilities and
media capabilities. Rayburst Connect validates that field and sends
`X-Rayburst-Client: rayburst-connect` on authenticated requests. Browser-origin
requests without that header are rejected. Native clients without an Origin header
continue to authenticate with the Extension API secret.

The `rayburst://` scheme activates the desktop only. It never creates a download or
transports cookies. Downloads use the authenticated HTTP handoff.

## Activation and installation

Installation and startup do not register URL handlers, default-app candidates or
browser Native Messaging hosts. Protocol settings and diagnostics only query existing
associations. Start the desktop manually before submitting downloads from the extension.

All native wake requests use one serialized background window creation path.
WebView readiness controls delivery of pending UI actions; creating a window never
blocks a browser handoff answer. Non-silent automatic submissions honor the
Open Downloads preference.

The engine receives `stop-with-process` for the desktop PID. Windows installer hooks
run a temporary copy of the new executable in maintenance mode before replacing
files. The hooks replace Tauri's basename-only process check. Maintenance verifies
full process paths, stops this installation's supervisor before
its sidecars, and waits for native process handles to signal exit. It does not kill
other installations by executable name. Normal application exit still saves the
session through the existing supervisor.

Before restoring the queue, the desktop retains only HTTP, HTTPS, FTP and SFTP
downloads. When it excludes unsupported entries, it keeps the
original queue in a `download-session-*.bak` file beside `download.session`.
Downloaded metadata files are saved as ordinary files.

Proxy bypass entries are validated and normalized once in Rust for runtime config,
global option updates and task options. libcurl performs host/IP/CIDR matching.
Aria2 Next resolves domain globs such as `*.example.com` and `dlinks.*` against each
request host before passing the result to libcurl. Redirects reevaluate that policy.
Newlines, commas and system-list semicolons separate entries. Trailing numeric
IPv4 wildcards become CIDR networks. System import reports unsupported expressions
for review before saving; `<local>` is not treated as an alias for localhost.

## Extension behavior

`extensionDownloadBehavior` defaults to `confirm`, allowing users to choose a
download directory. Explicit `background` and `show` preferences remain available. Native
dispatch applies that one policy; manual-task navigation stays independent. Closing
a confirmation finalizes every owned request ID, including URLs removed from the form.

## Platform integration

The bundled Native Messaging launcher can activate its paired executable when a host
has been configured externally. The desktop and installer do not register it.
Startup does not rewrite login items or register a Windows notification identity;
login registration changes only when the user saves that setting.

Windows are transparent and the page draws what it shows; Windows 11 and macOS add
the main window's corners and shadow. Linux uses a native StatusNotifierItem tray with
direct activation, speed tooltips and watcher reconnection. WebKitGTK always
composites, handing frames over in shared memory (`WEBKIT_FORCE_DMABUF_RENDERER`,
`WEBKIT_DMABUF_RENDERER_FORCE_SHM`); without compositing, WebKitGTK 2.50 leaves
translucent shadows on screen. It paints on the CPU with Mesa's software GL by default,
as the GPU path freezes or blanks windows on many drivers and virtual GPUs;
`hardwareRendering` (GPU acceleration) in Advanced turns the GPU on after a restart.
Every webview disables WebKitGTK's damage-based compositing, so frames repaint in full.
With the floating orb on, a Wayland session runs the app under XWayland, the only way
the orb can place itself and stay on top. Diagnostics report the WebKitGTK version,
whether GPU acceleration is on, and the display backend.
The tray icon carries a green dot while downloads run (macOS keeps its template image
and the menu bar speedometer) and shows both speeds in its tooltip. Hiding the tray icon
turns minimize-to-tray into a plain minimize, so the window always stays reachable.
Interface size is WebView zoom shared by every window; `Ctrl`/`⌘` with `+`, `-` or `0`
steps through the same values. Sizes are base 1024 and can be written with IEC units.
Update policies are Stable and Beta (stable plus prerelease candidates). Only a
higher SemVer precedence is eligible; switching channels never offers a downgrade.
A later check supersedes an earlier pending result. Updates retain Tauri's selected Update object and verified bytes. Cancellation can
retry that selection, and installation needs no second metadata request.
