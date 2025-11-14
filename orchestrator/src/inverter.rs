use anyhow::Result;
use std::path::PathBuf;
use tokio::fs;

use crate::types::{Message, MessagePart, ToolState};

/// Invert message roles for adversarial review
/// Converts doer's session into markdown where assistant messages become user messages
pub struct MessageInverter;

impl MessageInverter {
    /// Convert doer session messages to inverted markdown
    pub fn to_inverted_markdown(messages: &[Message], task_description: &str) -> String {
        let mut markdown = String::new();

        // Header
        markdown.push_str("# Doer Session Review\n\n");
        markdown.push_str(&format!("**Task:** {}\n\n", task_description));
        markdown.push_str("---\n\n");
        markdown.push_str("Below is what the doer agent did. Review critically for:\n");
        markdown.push_str("- Correctness\n");
        markdown.push_str("- Completeness\n");
        markdown.push_str("- Anti-patterns (mocks, infinite loops, analysis paralysis)\n");
        markdown.push_str("- Code quality\n\n");
        markdown.push_str("---\n\n");

        // Process messages
        for (idx, msg) in messages.iter().enumerate() {
            let role = &msg.info.role;

            match role.as_str() {
                "user" => {
                    // User messages stay as context
                    markdown.push_str(&format!("## Message {} (User Request)\n\n", idx + 1));
                    markdown.push_str(&Self::format_parts(&msg.parts));
                    markdown.push_str("\n\n");
                }
                "assistant" => {
                    // INVERT: Assistant becomes "what the agent said/did"
                    markdown.push_str(&format!("## Message {} (Agent Response)\n\n", idx + 1));
                    markdown.push_str("The agent responded:\n\n");
                    markdown.push_str(&Self::format_parts_as_observation(&msg.parts));
                    markdown.push_str("\n\n");
                }
                _ => {}
            }
        }

        markdown.push_str("---\n\n");
        markdown.push_str("## Your Task\n\n");
        markdown.push_str("Based on the above session, provide:\n");
        markdown.push_str("1. A quality score (0-100)\n");
        markdown.push_str("2. Specific issues found\n");
        markdown.push_str("3. Whether to APPROVE, RETRY, or ESCALATE\n");

        markdown
    }

    /// Format message parts normally (for user messages)
    fn format_parts(parts: &[MessagePart]) -> String {
        parts
            .iter()
            .map(|part| match part {
                MessagePart::Text { text } => text.clone(),
                MessagePart::Tool { tool, state, .. } => {
                    Self::format_tool_call(tool, state)
                }
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    /// Format message parts as observations (for inverted assistant messages)
    fn format_parts_as_observation(parts: &[MessagePart]) -> String {
        parts
            .iter()
            .map(|part| match part {
                MessagePart::Text { text } => format!("> {}", text.replace('\n', "\n> ")),
                MessagePart::Tool { tool, state, .. } => {
                    format!("**Tool Used:** `{}`\n{}", tool, Self::format_tool_state(state))
                }
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    /// Format tool call
    fn format_tool_call(tool: &str, state: &ToolState) -> String {
        let status = match state {
            ToolState::Pending => "⏳ Pending",
            ToolState::Running => "⚙️ Running",
            ToolState::Completed { .. } => "✓ Completed",
            ToolState::Error { .. } => "✗ Error",
        };

        format!("**Tool:** {} ({})\n{}", tool, status, Self::format_tool_state(state))
    }

    /// Format tool state details
    fn format_tool_state(state: &ToolState) -> String {
        match state {
            ToolState::Completed { output } => {
                format!("```\n{}\n```", output.trim())
            }
            ToolState::Error { error } => {
                format!("**Error:**\n```\n{}\n```", error)
            }
            _ => String::new(),
        }
    }

    /// Write inverted markdown to file
    pub async fn write_session_file(
        messages: &[Message],
        task_description: &str,
        task_id: &str,
    ) -> Result<PathBuf> {
        let markdown = Self::to_inverted_markdown(messages, task_description);

        let filename = format!("doer-session-{}.md", task_id);
        let path = PathBuf::from("/tmp").join(&filename);

        fs::write(&path, markdown).await?;

        Ok(path)
    }

    /// Create a critique prompt that references the markdown file
    pub fn create_critique_prompt(markdown_path: &PathBuf, task_description: &str) -> String {
        format!(
            r#"You are a critical code reviewer examining another AI agent's work.

TASK: {}

The doer agent's full session history has been saved to: {}

Read that file carefully and provide:
1. Quality score (0-100)
2. Specific issues or concerns
3. Recommendation: APPROVE / RETRY / ESCALATE

Be critical. Look for:
- Anti-patterns (mock cascades, infinite loops, analysis paralysis)
- Incomplete implementations
- Missing edge cases
- Poor code quality

Respond in this format:
SCORE: <number>
ISSUES: <bullet points>
RECOMMENDATION: <APPROVE|RETRY|ESCALATE>"#,
            task_description,
            markdown_path.display()
        )
    }
}
