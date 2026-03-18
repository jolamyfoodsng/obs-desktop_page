use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Archive error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("Path resolution failed")]
    TauriPath(#[from] tauri::Error),
    #[error("{message}")]
    Canceled { message: String },
}

impl AppError {
    pub fn message(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }

    pub fn invalid_path(path: impl Into<PathBuf>, reason: impl Into<String>) -> Self {
        let path = path.into();
        Self::Message(format!(
            "{} is not a valid OBS location: {}",
            path.display(),
            reason.into()
        ))
    }

    pub fn canceled(message: impl Into<String>) -> Self {
        Self::Canceled {
            message: message.into(),
        }
    }

    pub fn is_canceled(&self) -> bool {
        matches!(self, Self::Canceled { .. })
    }
}
