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

    // Create LLM client using OpenCode's built-in model
    tracing::info!("Using OpenCode server at {} for LLM calls", args.opencode_url);
    let llm = llm::LLMClient::new(&args.opencode_url)?;

    // Create and run orchestrator
    let mut orchestrator = Orchestrator::new(&args.opencode_url, llm, &args.task)?;

    orchestrator.run().await?;

    Ok(())
}

