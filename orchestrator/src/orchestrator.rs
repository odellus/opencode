use anyhow::{Context, Result};
use chrono::Utc;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};

use crate::{
    detector::AntiPatternDetector,
    llm::LLMClient,
    opencode::OpencodeClient,
    types::*,
};

pub struct Orchestrator {
    opencode: OpencodeClient,
    llm: LLMClient,
    state: ProjectState,
    max_retries: u32,
    poll_interval: Duration,
}

impl Orchestrator {
    pub fn new(
        opencode_url: impl Into<String>,
        llm: LLMClient,
        project_description: impl Into<String>,
    ) -> Result<Self> {
        let opencode = OpencodeClient::new(opencode_url)?;

        let state = ProjectState {
            project_description: project_description.into(),
            tasks: Vec::new(),
            current_task_index: 0,
            completed_work: Vec::new(),
            anti_patterns: Vec::new(),
            created_at: Utc::now().timestamp(),
            updated_at: Utc::now().timestamp(),
        };

        Ok(Self {
            opencode,
            llm,
            state,
            max_retries: 3,
            poll_interval: Duration::from_secs(5),
        })
    }

    pub async fn run(&mut self) -> Result<()> {
        info!("Starting orchestrator for: {}", self.state.project_description);

        // Break project into tasks
        info!("Breaking project into tasks...");
        let task_descriptions = self
            .llm
            .break_into_tasks(&self.state.project_description)
            .await?;

        self.state.tasks = task_descriptions
            .iter()
            .enumerate()
            .map(|(i, desc)| Task {
                id: format!("task_{}", i),
                description: desc.clone(),
                status: TaskStatus::Pending,
                retry_count: 0,
                session_id: None,
                start_time: None,
                end_time: None,
                error: None,
            })
            .collect();

        info!("Created {} tasks", self.state.tasks.len());

        // Execute tasks sequentially
        while self.state.current_task_index < self.state.tasks.len() {
            let task_index = self.state.current_task_index;
            let task_id = self.state.tasks[task_index].id.clone();
            let task_desc = self.state.tasks[task_index].description.clone();

            info!("Starting task {}: {}", task_id, task_desc);

            match self.execute_task(task_index).await {
                Ok(_) => {
                    info!("Task {} completed successfully", task_id);
                    self.state.tasks[task_index].status = TaskStatus::Done;
                    self.state.tasks[task_index].end_time = Some(Utc::now().timestamp());
                    self.state.current_task_index += 1;
                }
                Err(e) => {
                    error!("Task {} failed: {}", task_id, e);
                    self.state.tasks[task_index].retry_count += 1;

                    if self.state.tasks[task_index].retry_count >= self.max_retries {
                        error!("Task {} failed {} times, escalating to human", task_id, self.max_retries);
                        self.state.tasks[task_index].status = TaskStatus::Failed;
                        self.state.tasks[task_index].error = Some(format!("Max retries exceeded: {}", e));
                        break;
                    } else {
                        warn!("Retrying task {} (attempt {}/{})", task_id, self.state.tasks[task_index].retry_count + 1, self.max_retries);
                    }
                }
            }
        }

        info!("Orchestrator finished. Completed {}/{} tasks",
            self.state.tasks.iter().filter(|t| t.status == TaskStatus::Done).count(),
            self.state.tasks.len()
        );

        Ok(())
    }

    async fn execute_task(&mut self, task_index: usize) -> Result<()> {
        // Create OpenCode session
        let session = self.opencode.create_session(None).await?;

        let task = &mut self.state.tasks[task_index];
        task.session_id = Some(session.id.clone());
        task.status = TaskStatus::Active;
        task.start_time = Some(Utc::now().timestamp());

        let task_id = task.id.clone();
        let task_desc = task.description.clone();

        info!("Created session {} for task {}", session.id, task_id);

        // Inject task
        let task_prompt = format!(
            "{}\n\nAsk me if you're unsure about anything. I'm here to help keep you on track.",
            task_desc
        );
        self.opencode.send_message(&session.id, task_prompt).await?;

        // Monitor loop
        loop {
            sleep(self.poll_interval).await;

            // Check if doer is idle
            let is_idle = self.opencode.is_doer_idle(&session.id).await?;

            if !is_idle {
                continue;
            }

            info!("Doer is idle in session {}", session.id);

            // Get current state
            let messages = self.opencode.get_messages(&session.id).await?;
            let file_status = self.opencode.get_file_status().await?;

            // Detect anti-patterns
            let anti_patterns = AntiPatternDetector::detect_all(
                &messages,
                &file_status,
                &task_id,
                &session.id,
            );

            // If anti-pattern detected, inject correction
            if let Some(pattern) = anti_patterns.first() {
                warn!("Anti-pattern detected: {:?}", pattern.pattern_type);
                self.state.anti_patterns.push(pattern.clone());

                self.opencode
                    .send_message(&session.id, &pattern.intervention)
                    .await?;

                continue;
            }

            // Check if doer is asking a question or claiming done
            let last_msg = messages.last().context("No messages")?;

            if last_msg.info.role == "assistant" {
                let text = Self::extract_text(&last_msg.parts);

                // Check if asking question
                if text.contains('?') {
                    info!("Doer asked a question: {}", text);
                    let answer = self
                        .llm
                        .answer_question(&task_desc, &text)
                        .await?;

                    self.opencode.send_message(&session.id, answer).await?;
                    continue;
                }

                // Check if claiming done
                if text.to_lowercase().contains("done")
                    || text.to_lowercase().contains("complete")
                {
                    info!("Doer claims task is done, reviewing...");

                    let task = &self.state.tasks[task_index];
                    let task_desc = task.description.clone();
                    let task_id = task.id.clone();
                    let session_id = task.session_id.clone().unwrap();
                    let retry_count = task.retry_count;

                    let analysis = self.analyze_work(&task_desc, &task_id, &session_id, retry_count, &messages, &file_status).await?;

                    match analysis.recommendation {
                        Recommendation::Approve => {
                            info!("Work approved!");
                            return Ok(());
                        }
                        Recommendation::Retry => {
                            let feedback = analysis.feedback.unwrap_or_else(|| {
                                "This doesn't look right. Try again.".to_string()
                            });

                            warn!("Work needs improvement: {}", feedback);

                            self.opencode.send_message(&session.id, feedback).await?;
                            continue;
                        }
                        Recommendation::Escalate => {
                            error!("Escalating to human");
                            return Err(anyhow::anyhow!("Task requires human intervention"));
                        }
                    }
                }
            }
        }
    }

    async fn analyze_work(
        &mut self,
        task_description: &str,
        task_id: &str,
        session_id: &str,
        retry_count: u32,
        messages: &[Message],
        file_status: &[FileStatus],
    ) -> Result<WorkAnalysis> {
        let has_changes = file_status
            .iter()
            .any(|f| f.status == "modified" || f.status == "added");

        // Simplified test check (look for test failures in bash outputs)
        let tests_pass = !messages.iter().any(|msg| {
            msg.parts.iter().any(|part| {
                if let MessagePart::Tool { tool, state, .. } = part {
                    if tool == "Bash" {
                        if let ToolState::Completed { output } = state {
                            return output.contains("FAIL") || output.contains("ERROR");
                        }
                    }
                }
                false
            })
        });

        // Use LLM to score quality
        let work_summary = Self::summarize_messages(messages);
        let quality = self.llm.score_quality(task_description, &work_summary).await?;

        let anti_patterns = AntiPatternDetector::detect_all(
            messages,
            file_status,
            task_id,
            session_id,
        );

        let recommendation = if quality >= 70 && has_changes && tests_pass && anti_patterns.is_empty() {
            Recommendation::Approve
        } else if retry_count >= self.max_retries {
            Recommendation::Escalate
        } else {
            Recommendation::Retry
        };

        let feedback = if recommendation == Recommendation::Retry {
            Some(Self::generate_feedback(quality, has_changes, tests_pass, &anti_patterns))
        } else {
            None
        };

        Ok(WorkAnalysis {
            quality,
            has_changes,
            tests_pass,
            anti_patterns,
            recommendation,
            feedback,
        })
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

    fn summarize_messages(messages: &[Message]) -> String {
        let mut summary = String::new();

        for msg in messages.iter().rev().take(10) {
            summary.push_str(&format!("{}: ", msg.info.role));

            for part in &msg.parts {
                match part {
                    MessagePart::Text { text } => {
                        summary.push_str(&text[..text.len().min(200)]);
                    }
                    MessagePart::Tool { tool, state, .. } => {
                        summary.push_str(&format!("[{} tool: {:?}] ", tool, state));
                    }
                }
            }

            summary.push('\n');
        }

        summary
    }

    fn generate_feedback(
        quality: u8,
        has_changes: bool,
        tests_pass: bool,
        anti_patterns: &[AntiPatternDetection],
    ) -> String {
        let mut feedback = Vec::new();

        if quality < 70 {
            feedback.push(format!("Quality score is too low ({}%). Review the implementation.", quality));
        }

        if !has_changes {
            feedback.push("No file changes detected. Did you actually implement anything?".to_string());
        }

        if !tests_pass {
            feedback.push("Tests are failing. Fix the errors before claiming done.".to_string());
        }

        for pattern in anti_patterns {
            feedback.push(pattern.intervention.clone());
        }

        if feedback.is_empty() {
            "This doesn't look right. Try again.".to_string()
        } else {
            feedback.join(" ")
        }
    }
}
