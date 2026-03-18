fn normalize_env_value(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn resolve_support_api_url(
    runtime_support_api_base_url: Option<&str>,
    build_support_api_base_url: Option<&str>,
    runtime_update_base_url: Option<&str>,
    build_update_base_url: Option<&str>,
) -> String {
    let configured = normalize_env_value(runtime_support_api_base_url)
        .or_else(|| normalize_env_value(build_support_api_base_url))
        .or_else(|| normalize_env_value(runtime_update_base_url))
        .or_else(|| normalize_env_value(build_update_base_url))
        .unwrap_or_else(|| "https://obs-desktop-page.vercel.app".to_string());
    let configured = configured.trim_end_matches('/');

    format!("{configured}/api/support")
}

#[test]
fn prefers_runtime_support_url() {
    assert_eq!(
        resolve_support_api_url(
            Some(" https://runtime-support.example.com/ "),
            Some("https://build-support.example.com"),
            Some("https://runtime-update.example.com"),
            Some("https://build-update.example.com"),
        ),
        "https://runtime-support.example.com/api/support"
    );
}

#[test]
fn falls_back_through_expected_precedence() {
    assert_eq!(
        resolve_support_api_url(
            Some("   "),
            Some("https://build-support.example.com/"),
            Some("https://runtime-update.example.com"),
            Some("https://build-update.example.com"),
        ),
        "https://build-support.example.com/api/support"
    );

    assert_eq!(
        resolve_support_api_url(
            None,
            None,
            Some("https://runtime-update.example.com/"),
            None
        ),
        "https://runtime-update.example.com/api/support"
    );

    assert_eq!(
        resolve_support_api_url(
            None,
            None,
            Some("   "),
            Some("https://build-update.example.com")
        ),
        "https://build-update.example.com/api/support"
    );
}

#[test]
fn falls_back_to_default_url() {
    assert_eq!(
        resolve_support_api_url(None, None, None, None),
        "https://obs-desktop-page.vercel.app/api/support"
    );
}
