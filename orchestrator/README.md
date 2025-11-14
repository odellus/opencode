# OpenCode Orchestrator 🦀

A Rust-based orchestrator that supervises OpenCode sessions using **role inversion** to break cooperative dynamics.

## What It Does

This orchestrator acts as a **project manager agent** that:
- Breaks projects into concrete tasks
- Monitors an OpenCode "doer" agent via HTTP API
- **Inverts message roles** - doer's outputs become user inputs to force critical analysis
- Detects when the doer is stuck or doing dumb shit
- Injects corrections to keep work flowing
- Uses OpenCode's built-in model (no separate LLM needed!)

## Key Innovation: Role Inversion 🔄

**The Problem**: Traditional multi-agent systems cooperate too much. Agents avoid criticizing each other's work, leading to mediocre outcomes.

**Our Solution**: **Invert message roles** between sessions:

```
Doer Session:
  user: "Create hello.txt"
  assistant: "I'll create that now..." ← cooperative
  tool: Write(hello.txt)

Orchestrator Session (INVERTED):
  user: "Here's what the agent did:"
  user: "I'll create that now..."      ← was assistant, now user input
  user: "Tool: Write(hello.txt)"       ← formatted as observation
  assistant: "This is incomplete..."   ← forced to critique
```

By converting doer's `assistant` messages to `user` messages, the orchestrator sees them as **claims to verify**, not **teammate suggestions to support**.

### How It Works

1. **Doer executes task** in standard OpenCode session
2. **Markdown intermediary**: Session written to `/tmp/doer-session-{task_id}.md` with inverted roles
3. **Orchestrator reads markdown** using custom `orchestrator` agent (`.opencode/agent/orchestrator.md`)
4. **Custom agent has limited tools**: Read/Grep only (no Write/Edit/Bash)
5. **Structured critique**: SCORE / ISSUES / RECOMMENDATION / FEEDBACK

## Features

- **Role Inversion via Markdown**: Clean separation, forces adversarial review
- **Uses OpenCode's Model**: No separate LLM needed - orchestrator calls same OpenCode server
- **5 Anti-Pattern Detectors:**
  - Mock Cascade - stops excessive mocking
  - Infinite Loop - catches repeated commands
  - Printless Testing - enforces debug output
  - Reward Hacking - detects fake completion
  - Analysis Paralysis - stops endless planning

- **Quality Scoring:** Critical review with structured output
- **Smart Monitoring:** Detects when doer is idle and needs input

## Quick Start

### 1. Start OpenCode Server

```bash
cd /path/to/your/project
opencode server start --port 4096
```

### 2. Run Orchestrator

```bash
cargo run --release -- --task "Create a web server with health check endpoint"
```

That's it! The orchestrator uses OpenCode's built-in model for both doer and orchestrator sessions.

## CLI Options

```
-t, --task <TASK>              Project description or task (required)
-o, --opencode-url <URL>       OpenCode server URL [default: http://localhost:4096]
```

## How It Works

```
1. Orchestrator breaks project into 3-5 tasks (uses OpenCode session for this)
2. Creates doer session for first task
3. Injects task description as user message
4. Polls every 5s to check if doer is idle
5. When idle:
   - Checks for anti-patterns (Rust detectors)
   - If question: orchestrator answers it
   - If claims done: ROLE INVERSION REVIEW
     a. Write doer's session to /tmp/doer-session-{task_id}.md with inverted roles
     b. Create orchestrator session with "orchestrator" agent
     c. Orchestrator reads markdown and critiques critically
     d. Parse structured response: SCORE / ISSUES / RECOMMENDATION
   - If APPROVE: move to next task
   - If RETRY: inject feedback to doer
   - If ESCALATE: human intervention needed
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
- `reqwest` - HTTP client (1 hour timeout)
- `serde` - JSON serialization
- `clap` - CLI parsing
- `tracing` - Logging

### Debugging

```bash
# See inverted markdown files
cat /tmp/doer-session-*.md

# Run with verbose logging
RUST_LOG=debug cargo run --release -- --task "Your task"

# Check OpenCode sessions
curl http://localhost:4096/session | jq .
```

## Future Plans

- SSE event streaming (instead of polling)
- SQLite persistence
- Dioxus TUI/GUI interface
- Retry strategies
- Learning from past anti-patterns
- Multi-project support

## License

MIT
