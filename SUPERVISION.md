# Autonomous Agent Supervision System

## Overview

OpenCode now includes a comprehensive 3-tier autonomous agent hierarchy with real-time supervision and conversation continuation capabilities.

## Architecture

### Agent Hierarchy

```
Architect (Top Tier)
    ↓ delegates to
Supervisor (Middle Tier)
    ↓ delegates to
Build (Bottom Tier - executes tasks)
```

### Agent Modes

1. **Architect** (`packages/opencode/src/agent/architect.txt`)
   - Top-level autonomous agent
   - Reads project specifications from user
   - Breaks work into sequential phases
   - Delegates each phase to a Supervisor agent
   - Monitors progress and adapts strategy
   - Mode: `primary` (available in TUI)

2. **Supervisor** (`packages/opencode/src/agent/supervisor.txt`)
   - Middle-tier coordinator
   - Breaks phases into specific tasks
   - Can execute tasks directly OR delegate to Build agent
   - Monitors Build agent in real-time
   - Intervenes when issues detected
   - Runs tests to verify completion
   - Mode: `primary` (available in TUI)

3. **Build** (`packages/opencode/src/agent/agent.ts`)
   - Bottom-tier executor
   - Executes specific tasks (file creation, editing, running commands)
   - Has access to all standard tools (bash, edit, read, write, etc.)
   - Mode: `all` (can be primary OR subagent - critical for delegation)

## Real-Time Supervision

### Event-Driven Monitoring

The orchestrator (`packages/opencode/src/orchestrator/orchestrator.ts`) monitors subagents using the event bus:

1. **Todo Change Detection** (`Todo.Event.Updated`)
   - Detects when todos are added, started, or completed
   - Identifies when all todos are complete
   - Triggers orchestrator review on completion

2. **Message Monitoring** (`MessageV2.Event.Updated`)
   - Monitors when subagent sends messages
   - Detects when conversation stops prematurely (no tool calls)
   - Automatically continues conversation if todos incomplete

3. **Anti-Pattern Detection**
   - Multiple tasks in progress simultaneously
   - Stuck state (many messages, no progress)
   - No recent tool use despite pending tasks

### Conversation Continuation

When a subagent stops without completing all todos:

1. System detects last assistant message has no tool calls
2. Builds comprehensive conversation summary including:
   - Todo status (completed/in-progress/pending)
   - Conversation flow (user/assistant message counts)
   - Tool usage analysis
   - Recent conversation context (last 3 exchanges)
   - Issues detected (anti-patterns, stuck states)
3. Sends feedback message with full context
4. Invokes LLM programmatically via `SessionPrompt.prompt()` to continue

**Key Code**: `buildConversationSummary()` in `orchestrator.ts:407-513`

## Full Conversation Evaluation

The supervision system now analyzes the **entire conversation history**, not just the last message:

- **Todo Status**: Shows progress (X/Y completed, current task, next tasks)
- **Conversation Flow**: Counts user/assistant messages and exchanges
- **Tool Usage**: Tracks which tools were used and how often
- **Recent Context**: Extracts last 3 message exchanges for context
- **Issue Detection**: Identifies anti-patterns and stuck states

This comprehensive analysis allows the supervisor to make informed decisions about when and how to intervene.

## Observability

### Langfuse Integration

OpenCode includes Langfuse instrumentation for full observability of the autonomous agent system.

**Setup** (`packages/opencode/src/observability/langfuse.ts`):
- OpenTelemetry integration via `@langfuse/otel`
- LangfuseSpanProcessor for automatic trace collection
- Local Langfuse instance support (default: http://localhost:3044)

**Configuration** (`.env.local`):
```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=http://localhost:3044
```

**Initialization**: Automatically started when server starts (`src/server/server.ts:listen()`)

## Testing

### Test Structure

1. **Unit Tests** (`test/orchestrator/conversation-summary.test.ts`)
   - Test conversation summary logic
   - Test anti-pattern detection
   - Test todo status analysis
   - ✅ All passing (11/11)

2. **Integration Tests** (`test/orchestrator/integration-supervision.test.ts`)
   - Test real-time event monitoring
   - Test todo change detection
   - Test supervision lifecycle
   - ✅ All passing (8/8)

3. **End-to-End Tests** (`test/orchestrator/e2e-full-system.test.ts`)
   - Test full HTTP API with real LLM
   - Test supervisor → build delegation
   - Test architect → supervisor → build hierarchy
   - Test conversation continuation
   - Verify file creation and task completion

4. **Demo Scripts**
   - `src/orchestrator/demo-delegation.ts` - Basic delegation proof
   - `src/orchestrator/demo-full-system.ts` - Full hierarchy demo

### Running Tests

```bash
# Unit tests
bun test test/orchestrator/conversation-summary.test.ts

# Integration tests
bun test test/orchestrator/integration-supervision.test.ts

# Run server for E2E tests
bun dev
# Then run E2E tests in another terminal
bun test test/orchestrator/e2e-full-system.test.ts
```

## Key Implementation Details

### Tool Access

Both Supervisor and Build agents have access to the same tools:
- `bash` - Execute shell commands (including running tests)
- `edit` - Edit existing files
- `read` - Read file contents
- `write` - Create new files
- `grep` - Search code
- `glob` - Find files by pattern
- All other standard tools

This allows the Supervisor to run tests directly instead of delegating to Build.

### Delegation Mechanism

Delegation uses the `Task` tool which:
1. Creates a child session with `parentID` set to parent session
2. Runs the specified agent in the child session
3. Parent can monitor child via session hierarchy
4. Orchestrator automatically supervises all parent-child relationships

### Sequential vs Parallel Execution

The Architect agent enforces **sequential execution only**:
- Work on ONE phase at a time
- Complete it fully before moving to next
- No parallel supervisor agents
- This ensures focused, manageable progress

## Configuration

### LM Studio Setup

For local development with LM Studio (`.opencode/opencode.json`):

```json
{
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": {
        "baseURL": "http://192.168.1.175:1234/v1",
        "apiKey": "lm-studio"
      },
      "models": {
        "glm-4.5-air@q4_k_m": {
          "name": "GLM 4.5 Air Q4",
          "options": {
            "extra_body": {
              "cache_prompt": true
            }
          }
        }
      }
    }
  }
}
```

## Usage Examples

### Using Supervisor in TUI

```bash
# Start OpenCode
opencode

# In TUI, select "supervisor" agent
# Give it a task:
"Create a TypeScript project with tests. Set up package.json, tsconfig.json, 
create src/index.ts with a function, and test/index.test.ts with tests. 
Run the tests to verify everything works."

# Supervisor will:
# 1. Create todos for each step
# 2. Either execute directly or delegate to build agent
# 3. Monitor progress in real-time
# 4. Run tests itself to verify
# 5. Continue conversation if agent stops early
```

### Using Architect for Multi-Phase Projects

```bash
# In TUI, select "architect" agent
# Give it a complex project:
"Build a REST API with user authentication. 
Phase 1: Set up TypeScript project with Express
Phase 2: Implement user registration and login
Phase 3: Add JWT authentication middleware
Phase 4: Create protected routes with tests"

# Architect will:
# 1. Break into phases
# 2. Delegate each phase to a supervisor agent (sequential)
# 3. Monitor each supervisor's progress
# 4. Move to next phase only when current completes
```

## Future Enhancements

Potential improvements to the supervision system:

1. **Adaptive Intervention** - Adjust intervention frequency based on subagent performance
2. **Learning from Past Sessions** - Use conversation history to improve supervision strategies
3. **Multi-Level Supervision** - Support arbitrary depth of delegation (not just 3 tiers)
4. **Resource Budgeting** - Track LLM token usage and cost across hierarchy
5. **Parallel Execution** - Optional parallel phase execution with proper synchronization
6. **Human-in-the-Loop** - Allow user approval for critical decisions

## Troubleshooting

### Common Issues

**Issue**: Subagent stops without completing todos
- **Cause**: LLM may think task is complete or asking for clarification
- **Solution**: Conversation continuation automatically kicks in
- **Check**: Look for "invoking LLM to continue subagent conversation" in logs

**Issue**: Multiple todos stuck in "in_progress"
- **Cause**: Anti-pattern - trying to do too much at once
- **Solution**: Orchestrator sends feedback to focus on one task
- **Check**: Look for "Multiple tasks in progress" warning

**Issue**: Many messages but no progress
- **Cause**: Stuck state - agent may be confused or looping
- **Solution**: Orchestrator detects this and provides guidance
- **Check**: Review conversation summary for "Many messages but no completed tasks"

### Debugging

Enable detailed logging:
```typescript
const log = Log.create({ service: "orchestrator" })
log.setLevel("debug")
```

View Langfuse traces:
- Open http://localhost:3044
- Navigate to traces
- Filter by session ID
- Review full conversation flow and timings

## Credits

This autonomous agent system implements concepts from:
- Hierarchical task decomposition
- Real-time supervision and intervention
- Conversation continuation for agent reliability
- Full-context evaluation for better decision making

Built for OpenCode to enable truly autonomous multi-step project execution with minimal user intervention.
