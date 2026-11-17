//! macOS file and URL associations through LaunchServices.
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{NSBundle, NSString, NSURL};

/// Returns the bundle identifier of the app registered as the default
/// handler for the given URL scheme, or `None` if no handler is set.
pub fn get_default_handler_bundle_id(protocol: &str) -> Option<String> {
    let workspace = NSWorkspace::sharedWorkspace();
    let url_str = format!("{protocol}://test");
    let ns_url_str = NSString::from_str(&url_str);
    let test_url = NSURL::URLWithString(&ns_url_str)?;
    let handler_url = workspace.URLForApplicationToOpenURL(&test_url)?;
    let handler_bundle = NSBundle::bundleWithURL(&handler_url)?;
    let bundle_id = handler_bundle.bundleIdentifier()?;
    Some(bundle_id.to_string())
}
