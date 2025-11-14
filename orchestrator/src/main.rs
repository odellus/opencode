mod detector;
mod llm;
mod opencode;
mod orchestrator;
mod types;

use anyhow::Result;
use clap::Parser;
use orchestrator::Orchestrator;
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(name = "opencode-orchestrator")]
#[command(about = "AI orchestrator that supervises OpenCode sessions")]
struct Args {
    /// Project description or task to complete
    #[arg(short, long)]
    task: String,

    /// OpenCode server URL
    #[arg(short, long, default_value = "http://localhost:4096")]
    opencode_url: String,

    /// OpenRouter API key (or set OPENROUTER_API_KEY env var)
    #[arg(long)]
    openrouter_api_key: Option<String>,

    /// Model to use (default: free grok-beta)
    #[arg(short, long, default_value = "google/gemini-2.0-flash-exp:free")]
    model: String,

    /// Use local LLM instead of OpenRouter
    #[arg(long)]
    local_llm: bool,

    /// Local LLM base URL (e.g., http://192.168.1.175:1234/v1)
    #[arg(long, default_value = "http://192.168.1.175:1234/v1")]
    local_llm_url: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let args = Args::parse();

    // Create LLM client
    let llm = if args.local_llm {
        tracing::info!("Using local LLM at {}", args.local_llm_url);
        llm::LLMClient::new_local(&args.local_llm_url, &args.model)
    } else {
        let api_key = args
            .openrouter_api_key
            .or_else(|| std::env::var("OPENROUTER_API_KEY").ok())
            .expect("OpenRouter API key required (set OPENROUTER_API_KEY or use --openrouter-api-key)");

        tracing::info!("Using OpenRouter with model: {}", args.model);
        llm::LLMClient::new_openrouter(api_key, &args.model)
    };

    // Create and run orchestrator
    let mut orchestrator = Orchestrator::new(&args.opencode_url, llm, &args.task)?;

    orchestrator.run().await?;

    Ok(())
}

