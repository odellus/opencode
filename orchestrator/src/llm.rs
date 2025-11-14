use anyhow::Result;
use async_openai::{
    config::OpenAIConfig,
    types::{
        ChatCompletionRequestMessage, ChatCompletionRequestUserMessageArgs,
        CreateChatCompletionRequestArgs,
    },
    Client,
};
use tracing::{debug, info};

pub struct LLMClient {
    client: Client<OpenAIConfig>,
    model: String,
}

impl LLMClient {
    /// Create client for OpenRouter (free models)
    pub fn new_openrouter(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        let config = OpenAIConfig::new()
            .with_api_key(api_key)
            .with_api_base("https://openrouter.ai/api/v1");

        Self {
            client: Client::with_config(config),
            model: model.into(),
        }
    }

    /// Create client for local llama-server
    pub fn new_local(base_url: impl Into<String>, model: impl Into<String>) -> Self {
        let config = OpenAIConfig::new()
            .with_api_key("dummy") // llama-server doesn't need key
            .with_api_base(base_url);

        Self {
            client: Client::with_config(config),
            model: model.into(),
        }
    }

    pub async fn generate(&self, prompt: impl Into<String>) -> Result<String> {
        let prompt = prompt.into();
        debug!("Generating response for prompt: {}", prompt);

        let request = CreateChatCompletionRequestArgs::default()
            .model(&self.model)
            .messages(vec![ChatCompletionRequestMessage::User(
                ChatCompletionRequestUserMessageArgs::default()
                    .content(prompt)
                    .build()?,
            )])
            .build()?;

        let response = self.client.chat().create(request).await?;

        let content = response
            .choices
            .first()
            .and_then(|choice| choice.message.content.clone())
            .unwrap_or_default();

        info!("Generated response: {}", content);

        Ok(content)
    }

    /// Break project into tasks
    pub async fn break_into_tasks(&self, project_description: &str) -> Result<Vec<String>> {
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
        &self,
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
    pub async fn score_quality(&self, task_description: &str, work_summary: &str) -> Result<u8> {
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
