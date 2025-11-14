# OpenCode Orchestrator 🦀

A Rust-based orchestrator that supervises OpenCode sessions, detects anti-patterns, and keeps AI agents on track.

## What It Does

This orchestrator acts as a **project manager agent** that:
- Breaks projects into concrete tasks
- Monitors an OpenCode "doer" agent via HTTP API
- Detects when the doer is stuck or doing dumb shit
- Injects corrections to keep work flowing
- Uses LLM to score quality and provide feedback

## Features

- **5 Anti-Pattern Detectors:**
  - Mock Cascade - stops excessive mocking
  - Infinite Loop - catches repeated commands
  - Printless Testing - enforces debug output
  - Reward Hacking - detects fake completion
  - Analysis Paralysis - stops endless planning

- **Quality Scoring:** Uses LLM to analyze work
- **Smart Monitoring:** Detects when doer is idle and needs input
- **Local LLM Support:** Works with llama-server or OpenRouter

## Quick Start

### 1. Start OpenCode Server

```bash
cd /path/to/your/project
opencode --server --port 4096
```

### 2. Run Orchestrator

With OpenRouter (free model):
```bash
export OPENROUTER_API_KEY=your_key
cargo run -- --task "Create a simple TODO app in Rust"
```

With local LLM:
```bash
cargo run -- \
  --task "Create a simple TODO app" \
  --local-llm \
  --local-llm-url http://192.168.1.175:1234/v1
```

## CLI Options

```
-t, --task <TASK>                    Project description or task
-o, --opencode-url <URL>             OpenCode server URL [default: http://localhost:4096]
-m, --model <MODEL>                  Model to use [default: google/gemini-2.0-flash-exp:free]
    --local-llm                      Use local LLM instead of OpenRouter
    --local-llm-url <URL>            Local LLM base URL [default: http://192.168.1.175:1234/v1]
    --openrouter-api-key <KEY>       OpenRouter API key (or set OPENROUTER_API_KEY env var)
```

## How It Works

```
1. Orchestrator breaks project into 3-5 tasks using LLM
2. Creates OpenCode session for first task
3. Injects task description as user message
4. Polls every 5s to check if doer is idle
5. When idle:
   - Checks for anti-patterns
   - If question: answers it
   - If claims done: reviews work
   - If good: moves to next task
   - If bad: injects correction
6. Repeat until all tasks done or escalation needed
```

## Example Session

```
[Orchestrator] Breaking project into tasks...
[Orchestrator] Created 3 tasks
[Orchestrator] Starting task task_0: Implement user authentication
[Orchestrator] Created session sess_abc123
[Doer] *uses Read, Edit, Bash tools*
[Doer] Should I use JWT or sessions?
[Orchestrator] Use JWT - it's stateless and scales better
[Doer] *implements JWT, runs tests 6 times*
[Orchestrator] You're running tests repeatedly. They passed. Move on.
[Doer] Done with authentication
[Orchestrator] Reviewing work... Quality: 85/100 ✓
[Orchestrator] Work approved!
[Orchestrator] Starting task task_1: Add password reset endpoint
...
```

## Development

Built with:
- `tokio` - Async runtime
- `reqwest` - HTTP client (1 hour timeout for local LLMs)
- `async-openai` - OpenAI-compatible API client
- `serde` - JSON serialization
- `clap` - CLI parsing
- `tracing` - Logging

## Future Plans

- SSE event streaming (instead of polling)
- SQLite persistence
- Dioxus TUI/GUI interface
- Retry strategies
- Learning from past anti-patterns
- Multi-project support

## License

MIT
