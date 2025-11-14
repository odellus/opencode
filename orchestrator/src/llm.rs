use anyhow::{Context, Result};
use tokio::time::{sleep, Duration};
use tracing::{debug, info};

use crate::{opencode::OpencodeClient, types::MessagePart};

pub struct LLMClient {
    opencode: OpencodeClient,
    session_id: Option<String>,
}

impl LLMClient {
    /// Create client that uses OpenCode's built-in model
    pub fn new(opencode_url: impl Into<String>) -> Result<Self> {
        let opencode = OpencodeClient::new(opencode_url)?;
        Ok(Self {
            opencode,
            session_id: None,
        })
    }

    /// Ensure we have a session for orchestrator's own LLM calls
    async fn ensure_session(&mut self) -> Result<String> {
        if let Some(ref session_id) = self.session_id {
            return Ok(session_id.clone());
        }

        let session = self.opencode.create_session(None).await?;
        info!("Created orchestrator LLM session: {}", session.id);
        self.session_id = Some(session.id.clone());
        Ok(session.id)
    }

    pub async fn generate(&mut self, prompt: impl Into<String>) -> Result<String> {
        let prompt = prompt.into();
        debug!("Generating response for prompt: {}", prompt);

        let session_id = self.ensure_session().await?;

        // Send prompt to OpenCode
        self.opencode.send_message(&session_id, prompt).await?;

        // Poll until we get a response
        loop {
            sleep(Duration::from_secs(2)).await;

            let is_idle = self.opencode.is_doer_idle(&session_id).await?;
            if !is_idle {
                continue;
            }

            // Get the response
            let messages = self.opencode.get_messages(&session_id).await?;
            let last_msg = messages.last().context("No messages in LLM session")?;

            if last_msg.info.role == "assistant" {
                // Extract text from message parts
                let text = Self::extract_text(&last_msg.parts);
                info!("Generated response: {}", text);
                return Ok(text);
            }
        }
    }

    fn extract_text(parts: &[MessagePart]) -> String {
        parts
            .iter()
            .filter_map(|part| {
                if let MessagePart::Text { text } = part {
                    Some(text.as_str())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Break project into tasks
    pub async fn break_into_tasks(&mut self, project_description: &str) -> Result<Vec<String>> {
        let prompt = format!(
            r#"Break this project into 3-5 concrete, ordered tasks:

{}

Respond with ONLY a JSON array of task descriptions, like:
["Task 1", "Task 2", "Task 3"]

No other text."#,
            project_description
        );

        let response = self.generate(prompt).await?;

        // Parse JSON array
        let tasks: Vec<String> = serde_json::from_str(&response)?;

        Ok(tasks)
    }

    /// Answer doer's question
    pub async fn answer_question(
        &mut self,
        task_description: &str,
        question: &str,
    ) -> Result<String> {
        let prompt = format!(
            r#"You are supervising an AI agent working on: {}

The agent asks: {}

Provide a helpful, concise answer that keeps work flowing. Don't do the work for them - guide them.
Be direct and practical."#,
            task_description, question
        );

        self.generate(prompt).await
    }

    /// Score quality of work
    pub async fn score_quality(&mut self, task_description: &str, work_summary: &str) -> Result<u8> {
        let prompt = format!(
            r#"Task: {}

Work done:
{}

Score this work from 0-100 based on:
- Does it address the task?
- Is the implementation correct?
- Are edge cases handled?
- Is the code quality good?

Respond with ONLY a number 0-100. No other text."#,
            task_description, work_summary
        );

        let response = self.generate(prompt).await?;
        let score = response.trim().parse::<u8>().unwrap_or(0).min(100);

        Ok(score)
    }
}
