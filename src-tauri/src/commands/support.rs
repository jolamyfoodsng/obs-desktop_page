use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::time::Duration;

const DEFAULT_SUPPORT_API_BASE_URL: &str = "https://obs-desktop-page.vercel.app";

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
        .unwrap_or_else(|| DEFAULT_SUPPORT_API_BASE_URL.to_string());
    let configured = configured.trim_end_matches('/');

    format!("{configured}/api/support")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportSubmissionRequest {
    pub kind: String,
    pub email: String,
    pub subject: Option<String>,
    pub message: String,
    pub plugin_url: Option<String>,
    pub obs_version: Option<String>,
    pub app_version: String,
    pub install_id: String,
    pub platform: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupportSubmissionErrorPayload {
    message: Option<String>,
    field: Option<String>,
    fallback_email: Option<String>,
    fallback_mailto: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SupportSubmissionResponse {
    ok: bool,
    message: Option<String>,
    error: Option<SupportSubmissionErrorPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportSubmissionSuccess {
    pub ok: bool,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSupportSubmissionError {
    message: String,
    field: Option<String>,
    fallback_email: Option<String>,
    fallback_mailto: Option<String>,
}

fn support_api_url() -> String {
    resolve_support_api_url(
        std::env::var("SUPPORT_API_BASE_URL").ok().as_deref(),
        option_env!("VITE_SUPPORT_API_BASE_URL"),
        std::env::var("TAURI_UPDATE_BASE_URL").ok().as_deref(),
        option_env!("TAURI_UPDATE_BASE_URL"),
    )
}

fn trim_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn serialize_submission_error(
    message: String,
    field: Option<String>,
    fallback_email: Option<String>,
    fallback_mailto: Option<String>,
) -> String {
    serde_json::to_string(&DesktopSupportSubmissionError {
        message: message.clone(),
        field,
        fallback_email,
        fallback_mailto,
    })
    .unwrap_or(message)
}

#[tauri::command]
pub async fn submit_support_request(
    request: SupportSubmissionRequest,
) -> Result<SupportSubmissionSuccess, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Could not build support client: {error}"))?;

    let mut payload = Map::new();
    payload.insert(
        "kind".to_string(),
        Value::String(request.kind.trim().to_string()),
    );
    payload.insert(
        "email".to_string(),
        Value::String(request.email.trim().to_string()),
    );
    payload.insert(
        "message".to_string(),
        Value::String(request.message.trim().to_string()),
    );
    payload.insert(
        "appVersion".to_string(),
        Value::String(request.app_version.trim().to_string()),
    );
    payload.insert(
        "installId".to_string(),
        Value::String(request.install_id.trim().to_string()),
    );
    payload.insert(
        "platform".to_string(),
        Value::String(request.platform.trim().to_string()),
    );

    if let Some(subject) = trim_optional(request.subject) {
        payload.insert("subject".to_string(), Value::String(subject));
    }

    if let Some(plugin_url) = trim_optional(request.plugin_url) {
        payload.insert("pluginUrl".to_string(), Value::String(plugin_url));
    }

    if let Some(obs_version) = trim_optional(request.obs_version) {
        payload.insert("obsVersion".to_string(), Value::String(obs_version));
    }

    let support_api_url = support_api_url();
    let response = client
        .post(&support_api_url)
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|error| {
            serialize_submission_error(
                format!(
                    "Support submission could not reach {support_api_url}. {error}. This is usually a network or support server configuration issue."
                ),
                None,
                None,
                None,
            )
        })?;

    let status = response.status();
    let payload = response.json::<SupportSubmissionResponse>().await.ok();

    if !status.is_success() {
        let message = payload
            .as_ref()
            .and_then(|body| body.error.as_ref())
            .and_then(|error| error.message.clone())
            .or_else(|| payload.as_ref().and_then(|body| body.message.clone()))
            .unwrap_or_else(|| format!("Support request failed with status {status}."));
        let field = payload
            .as_ref()
            .and_then(|body| body.error.as_ref())
            .and_then(|error| error.field.clone());
        let fallback_email = payload
            .as_ref()
            .and_then(|body| body.error.as_ref())
            .and_then(|error| error.fallback_email.clone());
        let fallback_mailto = payload
            .as_ref()
            .and_then(|body| body.error.as_ref())
            .and_then(|error| error.fallback_mailto.clone());

        return Err(serialize_submission_error(
            message,
            field.filter(|value| !value.trim().is_empty()),
            fallback_email,
            fallback_mailto,
        ));
    }

    match payload {
        Some(body) if body.ok => Ok(SupportSubmissionSuccess {
            ok: true,
            message: body.message,
        }),
        Some(body) => {
            let message = body
                .error
                .as_ref()
                .and_then(|error| error.message.clone())
                .or(body.message)
                .unwrap_or_else(|| {
                    "Support request did not return a valid success response.".to_string()
                });
            let field = body
                .error
                .as_ref()
                .and_then(|error| error.field.clone())
                .filter(|value| !value.trim().is_empty());
            let fallback_email = body
                .error
                .as_ref()
                .and_then(|error| error.fallback_email.clone());
            let fallback_mailto = body
                .error
                .as_ref()
                .and_then(|error| error.fallback_mailto.clone());

            Err(serialize_submission_error(
                message,
                field,
                fallback_email,
                fallback_mailto,
            ))
        }
        None => Ok(SupportSubmissionSuccess {
            ok: true,
            message: None,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::resolve_support_api_url;

    #[test]
    fn prefers_runtime_support_api_base_url() {
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
    fn falls_back_to_build_support_api_base_url() {
        assert_eq!(
            resolve_support_api_url(
                Some("   "),
                Some("https://build-support.example.com/"),
                Some("https://runtime-update.example.com"),
                Some("https://build-update.example.com"),
            ),
            "https://build-support.example.com/api/support"
        );
    }

    #[test]
    fn falls_back_to_update_base_urls_before_default() {
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
    fn falls_back_to_default_support_url() {
        assert_eq!(
            resolve_support_api_url(None, None, None, None),
            "https://obs-desktop-page.vercel.app/api/support"
        );
    }
}
