use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::time::Duration;

const DEFAULT_SUPPORT_API_BASE_URL: &str = "https://obs-desktop-page.vercel.app";

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

fn support_api_url() -> String {
    let configured = option_env!("VITE_SUPPORT_API_BASE_URL")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SUPPORT_API_BASE_URL)
        .trim_end_matches('/');

    format!("{configured}/api/support")
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
            format!(
                "Support submission could not reach {support_api_url}. {error}. This is usually a network or support server configuration issue."
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

        if let Some(field) = field.filter(|value| !value.trim().is_empty()) {
            return Err(format!("FIELD:{field}:{message}"));
        }

        return Err(message);
    }

    match payload {
        Some(body) if body.ok => Ok(SupportSubmissionSuccess {
            ok: true,
            message: body.message,
        }),
        Some(body) => Err(body
            .error
            .and_then(|error| error.message)
            .or(body.message)
            .unwrap_or_else(|| {
                "Support request did not return a valid success response.".to_string()
            })),
        None => Ok(SupportSubmissionSuccess {
            ok: true,
            message: None,
        }),
    }
}
