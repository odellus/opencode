use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub description: String,
    pub status: TaskStatus,
    pub retry_count: u32,
    pub session_id: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskStatus {
    Pending,
    Active,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectState {
    pub project_description: String,
    pub tasks: Vec<Task>,
    pub current_task_index: usize,
    pub completed_work: Vec<String>,
    pub anti_patterns: Vec<AntiPatternDetection>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AntiPatternDetection {
    pub pattern_type: AntiPatternType,
    pub task_id: String,
    pub session_id: String,
    pub timestamp: i64,
    pub evidence: String,
    pub intervention: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AntiPatternType {
    MockCascade,
    InfiniteLoop,
    PrintlessTesting,
    RewardHacking,
    AnalysisParalysis,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkAnalysis {
    pub quality: u8,
    pub has_changes: bool,
    pub tests_pass: bool,
    pub anti_patterns: Vec<AntiPatternDetection>,
    pub recommendation: Recommendation,
    pub feedback: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Recommendation {
    Approve,
    Retry,
    Escalate,
}

// OpenCode API types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub title: Option<String>,
    pub time: SessionTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTime {
    pub created: i64,
    pub updated: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    #[serde(rename = "sessionID")]
    pub session_id: String,
    pub role: String,
    pub parts: Vec<MessagePart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum MessagePart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool")]
    Tool {
        #[serde(rename = "callID")]
        call_id: String,
        tool: String,
        state: ToolState,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum ToolState {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "completed")]
    Completed { output: String },
    #[serde(rename = "error")]
    Error { error: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileStatus {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSessionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptRequest {
    pub parts: Vec<PromptPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PromptPart {
    #[serde(rename = "text")]
    Text { text: String },
}
