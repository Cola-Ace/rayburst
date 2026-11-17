# Release configuration

This checkout builds Rayburst locally. It does not create a store listing, publish a
website, change Git remotes or submit a signing request during development.

## Desktop updates

Install new versions from GitHub Releases. The desktop has no update check,
download or installation service.

Fork releases are published at `https://github.com/Cola-Ace/rayburst/releases`.
The release workflow uses `tauri.conf.json`, where updater artifacts are disabled.
It publishes one Windows x64 NSIS installer and requires no signing secrets.

The new application identifier uses separate settings, task state and history.
There is no data import or installer migration layer. Native installation may
replace the app in place or leave both products installed, depending on the package
type. Existing filenames and shortcuts can retain the previous name. Recommend a
fresh installation in the README and website migration notices.

## Bundled engine

Release builds use the six platform engine binaries committed under
`src-tauri/binaries`. Update those files from a published aria2-next release before
the desktop release, then review their SHA-256 values. The checkout is the single
source used by local and release builds; CI does not download or replace the
engine during packaging.

## Browser identities

`src-tauri/native-messaging/identity.json` owns the allowed Chromium IDs and Firefox
ID. Native Messaging is activation-only. Chrome and Edge retain their published
store identities; Firefox uses the new Rayburst Connect identity.

When an identity changes, update this allowlist and the extension configuration in
the same delivery. Regenerate packaged manifests with `pnpm build:native-launcher`
and distribute the rebuilt app before the extension. No wildcard origins are allowed.

## Native activation and associations

The browser host activates its paired desktop installation, independently of URL
protocol defaults: Windows uses ShellExecuteEx with the sibling executable, macOS
opens the containing application bundle, and Linux starts the sibling executable.
The host never launches a path supplied by an extension or searches for other
installations. AppImage startup does not copy or register a persistent browser host.

The desktop queries `rayburst` association status without changing
defaults. Installers and runtime do not register URL schemes, default-app candidates
or Native Messaging hosts. Start Rayburst manually before connecting the extension.
Native Messaging permissions remain activation-only for externally configured hosts.

Before release, verify that installation and startup preserve existing defaults and
browser host registrations on Windows x64. Check extension handoff after
manually starting the desktop, read-only association queries and uninstall ownership.

## Platform distribution

Windows installers do not advertise Default Apps capabilities.
Installer maintenance removes owned or orphaned historical candidates; it never
rewrites protected UserChoice values or removes another live installation.

The Release workflow builds only `x86_64-pc-windows-msvc` with `--bundles nsis`.
Publishing a GitHub Release uploads `Rayburst_<version>_x64-setup.exe` to that
release. A manual workflow run stores the same installer as an Actions artifact.
Fork installers are unsigned. The fork does not publish updater manifests,
updater signatures or Homebrew packages.

Keep the application version equal to the upstream version used by the fork.
`src-tauri/Cargo.toml` is the source of truth and `package.json` must match it.
Use `scripts/bump-version.sh <upstream-version>` when adopting a new upstream
version; keep the version unchanged for fork-only changes. Tag a release as
`v<version>` on the fork commit, and describe fork changes in its release notes.
The workflow checks both version files and the release tag before building.

## Website

Upstream Cloudflare Pages serves `https://rayburst.pages.dev` from the upstream `main`
branch. Use the `website` root directory, `pnpm build` build command, `dist` output
directory and no framework preset.

Include only `website/*` in build watch paths, leave exclusions empty, and disable
preview branch deployments. Cloudflare bypasses path filtering for pushes with no
changed files, at least 3,000 changed files, or at least 20 commits. The website uses
native Pages caching and `404.html`; it has no separate deployment workflow.
