use crate::types::*;
use chrono::Utc;

pub struct AntiPatternDetector;

impl AntiPatternDetector {
    pub fn detect_all(
        messages: &[Message],
        file_status: &[FileStatus],
        task_id: &str,
        session_id: &str,
    ) -> Vec<AntiPatternDetection> {
        let mut detections = Vec::new();

        if let Some(detection) = Self::detect_mock_cascade(messages, task_id, session_id) {
            detections.push(detection);
        }

        if let Some(detection) = Self::detect_infinite_loop(messages, task_id, session_id) {
            detections.push(detection);
        }

        if let Some(detection) = Self::detect_printless_testing(messages, task_id, session_id) {
            detections.push(detection);
        }

        if let Some(detection) =
            Self::detect_reward_hacking(messages, file_status, task_id, session_id)
        {
            detections.push(detection);
        }

        if let Some(detection) = Self::detect_analysis_paralysis(messages, task_id, session_id) {
            detections.push(detection);
        }

        detections
    }

    fn detect_mock_cascade(
        messages: &[Message],
        task_id: &str,
        session_id: &str,
    ) -> Option<AntiPatternDetection> {
        // Count recent Edit tool calls that add mocks
        let mut mock_count = 0;

        for msg in messages.iter().rev().take(10) {
            if msg.info.role != "assistant" {
                continue;
            }

            for part in &msg.parts {
                if let MessagePart::Tool { tool, state, .. } = part {
                    if tool == "Edit" {
                        if let ToolState::Completed { output } = state {
                            if output.contains("mock(")
                                || output.contains("stub(")
                                || output.contains("jest.fn(")
                                || output.contains("vi.fn(")
                            {
                                mock_count += 1;
                            }
                        }
                    }
                }
            }
        }

        if mock_count >= 5 {
            return Some(AntiPatternDetection {
                pattern_type: AntiPatternType::MockCascade,
                task_id: task_id.to_string(),
                session_id: session_id.to_string(),
                timestamp: Utc::now().timestamp(),
                evidence: format!("{} consecutive edits adding mocks/stubs", mock_count),
                intervention: "Stop mocking everything. Implement the actual functionality first. Tests should verify real behavior, not mocks.".to_string(),
            });
        }

        None
    }

    fn detect_infinite_loop(
        messages: &[Message],
        task_id: &str,
        session_id: &str,
    ) -> Option<AntiPatternDetection> {
        let mut bash_commands = Vec::new();

        for msg in messages.iter().rev().take(10) {
            if msg.info.role != "assistant" {
                continue;
            }

            for part in &msg.parts {
                if let MessagePart::Tool { tool, state, .. } = part {
                    if tool == "Bash" {
                        if let ToolState::Completed { output } = state {
                            // Extract command from output (simplified)
                            bash_commands.push(output.clone());
                        }
                    }
                }
            }
        }

        if bash_commands.len() >= 5 {
            // Check if all commands are the same
            let first = &bash_commands[0];
            if bash_commands.iter().all(|cmd| cmd == first) {
                return Some(AntiPatternDetection {
                    pattern_type: AntiPatternType::InfiniteLoop,
                    task_id: task_id.to_string(),
                    session_id: session_id.to_string(),
                    timestamp: Utc::now().timestamp(),
                    evidence: format!("Same command run {} times", bash_commands.len()),
                    intervention: "You're running the same command repeatedly. READ THE ERROR MESSAGE. What needs to change in the code?".to_string(),
                });
            }
        }

        None
    }

    fn detect_printless_testing(
        messages: &[Message],
        task_id: &str,
        session_id: &str,
    ) -> Option<AntiPatternDetection> {
        let mut test_edits = 0;
        let mut has_debug_output = false;

        for msg in messages.iter().rev().take(10) {
            if msg.info.role != "assistant" {
                continue;
            }

            for part in &msg.parts {
                if let MessagePart::Tool { tool, state, .. } = part {
                    if tool == "Edit" {
                        if let ToolState::Completed { output } = state {
                            // Check if editing test file
                            if output.contains("test") || output.contains("spec") {
                                test_edits += 1;

                                // Check for debug output
                                if output.contains("console.log")
                                    || output.contains("print(")
                                    || output.contains("println!")
                                    || output.contains("fmt.Println")
                                    || output.contains("Debug.")
                                {
                                    has_debug_output = true;
                                }
                            }
                        }
                    }
                }
            }
        }

        if test_edits > 0 && !has_debug_output {
            return Some(AntiPatternDetection {
                pattern_type: AntiPatternType::PrintlessTesting,
                task_id: task_id.to_string(),
                session_id: session_id.to_string(),
                timestamp: Utc::now().timestamp(),
                evidence: format!("{} test file edits without debug output", test_edits),
                intervention: "Add debug output to see what's actually happening. Don't guess - inspect the data with console.log/print/println.".to_string(),
            });
        }

        None
    }

    fn detect_reward_hacking(
        messages: &[Message],
        file_status: &[FileStatus],
        task_id: &str,
        session_id: &str,
    ) -> Option<AntiPatternDetection> {
        if messages.is_empty() {
            return None;
        }

        let last_msg = &messages[messages.len() - 1];

        if last_msg.info.role != "assistant" {
            return None;
        }

        // Check if claims done
        let claims_done = last_msg.parts.iter().any(|part| {
            if let MessagePart::Text { text } = part {
                text.to_lowercase().contains("done")
                    || text.to_lowercase().contains("complete")
                    || text.to_lowercase().contains("finished")
                    || text.to_lowercase().contains("implemented")
            } else {
                false
            }
        });

        if !claims_done {
            return None;
        }

        // Check for meaningful changes
        let meaningful_changes = file_status
            .iter()
            .filter(|f| f.status == "modified" || f.status == "added")
            .count();

        if meaningful_changes == 0 {
            return Some(AntiPatternDetection {
                pattern_type: AntiPatternType::RewardHacking,
                task_id: task_id.to_string(),
                session_id: session_id.to_string(),
                timestamp: Utc::now().timestamp(),
                evidence: "Claims task complete but no file changes detected".to_string(),
                intervention: "I don't see the changes. Show me what you actually implemented. Run git diff or describe the specific files modified.".to_string(),
            });
        }

        None
    }

    fn detect_analysis_paralysis(
        messages: &[Message],
        task_id: &str,
        session_id: &str,
    ) -> Option<AntiPatternDetection> {
        let recent: Vec<&Message> = messages.iter().rev().take(10).collect();

        let assistant_messages: Vec<&Message> = recent
            .iter()
            .filter(|m| m.info.role == "assistant")
            .copied()
            .collect();

        if assistant_messages.len() < 5 {
            return None;
        }

        // Check if any of them have tool calls
        let has_tool_calls = assistant_messages.iter().any(|msg| {
            msg.parts.iter().any(|part| {
                matches!(part, MessagePart::Tool { .. })
            })
        });

        if !has_tool_calls {
            return Some(AntiPatternDetection {
                pattern_type: AntiPatternType::AnalysisParalysis,
                task_id: task_id.to_string(),
                session_id: session_id.to_string(),
                timestamp: Utc::now().timestamp(),
                evidence: "5+ assistant messages without any tool calls".to_string(),
                intervention:
                    "Enough planning. Write code. Make changes now. Stop thinking and start doing."
                        .to_string(),
            });
        }

        None
    }
}
