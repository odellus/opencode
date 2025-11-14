use anyhow::Result;
use reqwest::Client;
use serde_json::json;
use tracing::{debug, info};

use crate::types::*;

pub struct OpencodeClient {
    client: Client,
    base_url: String,
}

impl OpencodeClient {
    pub fn new(base_url: impl Into<String>) -> Result<Self> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(3600)) // 1 hour timeout for local LLMs
            .build()?;

        Ok(Self {
            client,
            base_url: base_url.into(),
        })
    }

    pub async fn create_session(&self, agent: Option<String>) -> Result<Session> {
        let url = format!("{}/session", self.base_url);
        let body = CreateSessionRequest { agent };

        info!("Creating session at {}", url);

        let response = self.client.post(&url).json(&body).send().await?;

        let session: Session = response.json().await?;
        debug!("Created session: {:?}", session);

        Ok(session)
    }

    pub async fn send_message(&self, session_id: &str, text: impl Into<String>) -> Result<()> {
        let url = format!("{}/session/{}/message", self.base_url, session_id);
        let text = text.into();

        info!("Sending message to session {}: {}", session_id, text);

        let body = PromptRequest {
            parts: vec![PromptPart::Text { text }],
        };

        self.client.post(&url).json(&body).send().await?;

        Ok(())
    }

    pub async fn get_messages(&self, session_id: &str) -> Result<Vec<Message>> {
        let url = format!("{}/session/{}/message", self.base_url, session_id);

        debug!("Fetching messages from {}", url);

        let response = self.client.get(&url).send().await?;
        let messages: Vec<Message> = response.json().await?;

        Ok(messages)
    }

    pub async fn get_file_status(&self) -> Result<Vec<FileStatus>> {
        let url = format!("{}/file/status", self.base_url);

        debug!("Fetching file status from {}", url);

        let response = self.client.get(&url).send().await?;
        let status: Vec<FileStatus> = response.json().await?;

        Ok(status)
    }

    pub async fn abort_session(&self, session_id: &str) -> Result<()> {
        let url = format!("{}/session/{}/abort", self.base_url, session_id);

        info!("Aborting session {}", session_id);

        self.client.post(&url).send().await?;

        Ok(())
    }

    pub async fn list_sessions(&self) -> Result<Vec<Session>> {
        let url = format!("{}/session", self.base_url);

        debug!("Listing sessions from {}", url);

        let response = self.client.get(&url).send().await?;
        let sessions: Vec<Session> = response.json().await?;

        Ok(sessions)
    }

    /// Check if doer is idle (last message is assistant with no pending tools)
    pub async fn is_doer_idle(&self, session_id: &str) -> Result<bool> {
        let messages = self.get_messages(session_id).await?;

        if messages.is_empty() {
            return Ok(false);
        }

        let last_msg = &messages[messages.len() - 1];

        if last_msg.role != "assistant" {
            return Ok(false);
        }

        // Check if any tools are still pending/running
        let has_pending_tools = last_msg.parts.iter().any(|part| match part {
            MessagePart::Tool { state, .. } => matches!(
                state,
                ToolState::Pending | ToolState::Running
            ),
            _ => false,
        });

        Ok(!has_pending_tools)
    }
}
