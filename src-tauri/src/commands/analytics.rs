use reqwest::Client;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::time::Duration;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsEventRequest {
    pub api_key: String,
    pub api_host: String,
    pub event_name: String,
    pub distinct_id: String,
    pub timestamp: Option<String>,
    pub person_profiles: Option<String>,
    #[serde(default)]
    pub properties: Value,
}

fn sanitize_api_host(host: &str) -> Option<String> {
    let trimmed = host.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn sanitize_api_key(key: &str) -> Option<String> {
    let trimmed = key.trim();
    if trimmed.is_empty() || trimmed == "POSTHOG_PROJECT_KEY" {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[tauri::command]
pub async fn capture_analytics_event(request: AnalyticsEventRequest) -> Result<(), String> {
    let Some(api_key) = sanitize_api_key(&request.api_key) else {
        return Ok(());
    };

    let Some(api_host) = sanitize_api_host(&request.api_host) else {
        return Ok(());
    };

    let event_name = request.event_name.trim().to_string();
    let distinct_id = request.distinct_id.trim().to_string();
    if event_name.is_empty() || distinct_id.is_empty() {
        return Ok(());
    }

    let mut properties = match request.properties {
        Value::Object(map) => map,
        _ => Map::new(),
    };

    properties
        .entry("distinct_id".to_string())
        .or_insert_with(|| Value::String(distinct_id.clone()));

    let mut payload = Map::new();
    payload.insert("api_key".to_string(), Value::String(api_key));
    payload.insert("event".to_string(), Value::String(event_name));
    payload.insert("distinct_id".to_string(), Value::String(distinct_id));
    if let Some(person_profiles) = request
        .person_profiles
        .filter(|value| !value.trim().is_empty())
    {
        payload.insert(
            "person_profiles".to_string(),
            Value::String(person_profiles),
        );
    }
    payload.insert("properties".to_string(), Value::Object(properties));
    if let Some(timestamp) = request.timestamp.filter(|value| !value.trim().is_empty()) {
        payload.insert("timestamp".to_string(), Value::String(timestamp));
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| {
            let message = format!("Could not build PostHog client: {}", error);
            eprintln!("[analytics] {}", message);
            message
        })?;

    let url = format!("{}/capture/", api_host);
    match client.post(url).json(&payload).send().await {
        Ok(response) if response.status().is_success() => Ok(()),
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let message = format!("PostHog rejected event with status {}: {}", status, body);
            eprintln!("[analytics] {}", message);
            Err(message)
        }
        Err(error) => {
            let message = format!("Could not send analytics event: {}", error);
            eprintln!("[analytics] {}", message);
            Err(message)
        }
    }
}
