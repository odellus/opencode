# Orchestrator Integration - Design Doc

## Overview

Integrate orchestrator supervision directly into OpenCode as a built-in agent type that monitors child sessions via the event bus and todo state.

## Key Insights from OpenCode Architecture

### 1. Agent System (`src/agent/agent.ts`)
- **Built-in agents**: `general`, `build`, `plan`
- **Permissions**: Fine-grained per agent (edit, bash patterns, webfetch)
- **Tools**: Enable/disable tools per agent
- **Modes**: `primary`, `subagent`, `all`
- **Custom prompts**: Per-agent system prompts

### 2. Session System (`src/session/index.ts`)
- **Parent/child sessions**: `parentID` field for hierarchy
- **Event bus**: `Session.Event.Created`, `Session.Event.Updated`
- **Storage-backed**: Persistent across restarts

### 3. Event Bus (`src/bus/index.ts`)
- **Publish/subscribe**: `Bus.publish()`, `Bus.subscribe()`
- **Event types**: `session.created`, `session.updated`, `todo.updated`
- **Wildcard**: Subscribe to `*` for all events

### 4. Todo System (`src/session/todo.ts`)
- **Schema**: `{ content, status, priority, id }`
- **Status**: `pending`, `in_progress`, `completed`, `cancelled`
- **API**: `GET /session/:id/todo`, `TodoWriteTool`
- **Events**: `Todo.Event.Updated` on changes

## Proposed Architecture

### New Agent Type: `orchestrator`

```typescript
// In src/agent/agent.ts, add to built-in agents:
orchestrator: {
  name: "orchestrator",
  description: "Supervises child sessions, monitors todos, detects anti-patterns",
  mode: "primary",  // Can be used as main agent
  builtIn: true,
  permission: {
    edit: "deny",      // Cannot modify code directly
    bash: {
      // Read-only bash commands
      "ls*": "allow",
      "cat*": "allow",
      "grep*": "allow",
      "git status*": "allow",
      "git log*": "allow",
      "git diff*": "allow",
      "*": "deny",     // Deny everything else
    },
    webfetch: "deny",
  },
  tools: {
    read: true,
    grep: true,
    glob: true,
    todoread: true,    // Can read todos from child sessions
    todowrite: true,   // Manages its own todos
    write: false,
    edit: false,
    bash: false,       // Restricted via permissions
  },
}
```

### New Module: `src/orchestrator/orchestrator.ts`

```typescript
import { Bus } from "../bus"
import { Session } from "../session"
import { Todo } from "../session/todo"
import { MessageV2 } from "../session/message-v2"

export namespace Orchestrator {
  export interface SupervisionConfig {
    parentSessionID: string
    childSessionID: string
    projectDescription: string
    tasks: string[]
    currentTaskIndex: number
    maxRetries: number
  }

  /**
   * Create orchestrator session that supervises a doer session
   */
  export async function createSupervisionSession(input: {
    projectDescription: string
    directory: string
  }): Promise<{ orchestratorID: string; doerID: string }> {
    // 1. Create orchestrator session
    const orchestratorSession = await Session.createNext({
      title: `Orchestrator: ${input.projectDescription}`,
      directory: input.directory,
    })

    // 2. Create child doer session
    const doerSession = await Session.createNext({
      title: `Doer: ${input.projectDescription}`,
      directory: input.directory,
      parentID: orchestratorSession.id,
    })

    // 3. Set up supervision
    await setupSupervision({
      parentSessionID: orchestratorSession.id,
      childSessionID: doerSession.id,
      projectDescription: input.projectDescription,
    })

    return {
      orchestratorID: orchestratorSession.id,
      doerID: doerSession.id,
    }
  }

  /**
   * Subscribe to child session events and coordinate
   */
  async function setupSupervision(config: {
    parentSessionID: string
    childSessionID: string
    projectDescription: string
  }) {
    // Subscribe to todo updates from doer
    Bus.subscribe(Todo.Event.Updated, async (event) => {
      if (event.properties.sessionID !== config.childSessionID) return

      const todos = event.properties.todos
      await handleDoerTodoUpdate(config, todos)
    })

    // Subscribe to session updates from doer
    Bus.subscribe(Session.Event.Updated, async (event) => {
      if (event.properties.info.id !== config.childSessionID) return

      await checkDoerProgress(config)
    })

    // Initialize: Send first task to doer
    await initializeDoerTask(config)
  }

  /**
   * Monitor doer's todo list for stuck patterns
   */
  async function handleDoerTodoUpdate(
    config: { parentSessionID: string; childSessionID: string },
    todos: Todo.Info[]
  ) {
    const inProgress = todos.filter((t) => t.status === "in_progress")

    // Anti-pattern: Multiple tasks in progress
    if (inProgress.length > 1) {
      await sendFeedbackToDoer(
        config.childSessionID,
        "You have multiple tasks in progress. Focus on one task at a time."
      )
    }

    // Anti-pattern: Same task stuck too long
    // (Would need timestamp tracking in todo items)
  }

  /**
   * Check if doer claims done and review work
   */
  async function checkDoerProgress(config: {
    parentSessionID: string
    childSessionID: string
  }) {
    const messages = await MessageV2.list(config.childSessionID)
    const lastMsg = messages[messages.length - 1]

    if (!lastMsg || lastMsg.info.role !== "assistant") return

    // Check if claiming done
    const text = extractText(lastMsg.parts)
    if (text.toLowerCase().includes("done") || text.toLowerCase().includes("complete")) {
      await reviewDoerWork(config)
    }
  }

  /**
   * Review doer's work using role inversion
   */
  async function reviewDoerWork(config: {
    parentSessionID: string
    childSessionID: string
  }) {
    // 1. Get doer's messages
    const doerMessages = await MessageV2.list(config.childSessionID)

    // 2. Create inverted summary for orchestrator
    const invertedPrompt = createInvertedReviewPrompt(doerMessages)

    // 3. Send to orchestrator session for critique
    await MessageV2.send({
      sessionID: config.parentSessionID,
      content: invertedPrompt,
    })

    // 4. Wait for orchestrator's analysis
    // (Would use Bus.once to wait for response)

    // 5. Parse recommendation and act
    // - APPROVE: move to next task
    // - RETRY: send feedback to doer
    // - ESCALATE: notify user
  }

  /**
   * Create role-inverted review prompt
   */
  function createInvertedReviewPrompt(messages: any[]): string {
    let prompt = "# Review Doer's Work\n\n"
    prompt += "The doer agent claims to be done. Review their session critically:\n\n"

    for (const msg of messages) {
      if (msg.info.role === "user") {
        prompt += `**User requested:** ${extractText(msg.parts)}\n\n`
      } else if (msg.info.role === "assistant") {
        // INVERSION: Assistant messages become claims to verify
        prompt += `**The agent said:** ${extractText(msg.parts)}\n\n`
      }
    }

    prompt += "\n\n**Your task:** Critically evaluate if the work is complete and correct.\n"
    prompt += "Provide: SCORE (0-100), ISSUES (bullet list), RECOMMENDATION (APPROVE/RETRY/ESCALATE)\n"

    return prompt
  }

  async function sendFeedbackToDoer(sessionID: string, feedback: string) {
    await MessageV2.send({
      sessionID,
      content: feedback,
    })
  }

  function extractText(parts: any[]): string {
    return parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ")
  }
}
```

### New API Endpoint: `POST /orchestrator/supervise`

Add to `src/server/server.ts`:

```typescript
.post(
  "/orchestrator/supervise",
  describeRoute({
    description: "Create orchestrator and doer sessions",
    operationId: "orchestrator.supervise",
    requestBody: {
      content: {
        "application/json": {
          schema: z.object({
            projectDescription: z.string(),
            directory: z.string().optional(),
          }),
        },
      },
    },
    responses: {
      200: {
        description: "Supervision sessions created",
        content: {
          "application/json": {
            schema: z.object({
              orchestratorID: z.string(),
              doerID: z.string(),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    const { projectDescription, directory } = await c.req.json()
    const result = await Orchestrator.createSupervisionSession({
      projectDescription,
      directory: directory || Instance.directory,
    })
    return c.json(result)
  }
)
```

## Implementation Plan

### Phase 1: Basic Orchestrator Agent
- [ ] Add `orchestrator` to built-in agents with restricted permissions
- [ ] Create `src/orchestrator/` module
- [ ] Implement parent/child session creation
- [ ] Add event bus subscriptions for todo/session updates

### Phase 2: State Coordination
- [ ] Monitor doer's todo list via `Todo.Event.Updated`
- [ ] Detect stuck patterns (multiple in_progress, same task too long)
- [ ] Send feedback to doer via message injection

### Phase 3: Role Inversion Review
- [ ] Create inverted review prompt from doer messages
- [ ] Send to orchestrator session for critique
- [ ] Parse structured response (SCORE/ISSUES/RECOMMENDATION)
- [ ] Act on recommendation (approve/retry/escalate)

### Phase 4: Anti-Pattern Detection
- [ ] Port Rust detectors to TypeScript
- [ ] Integrate with review flow
- [ ] Add detector results to orchestrator's analysis

### Phase 5: API & CLI
- [ ] Add `/orchestrator/supervise` endpoint
- [ ] Add CLI command: `opencode orchestrate "project description"`
- [ ] TUI integration for monitoring both sessions

## Benefits of This Approach

1. **Native Integration**: Uses OpenCode's primitives (agents, sessions, events, todos)
2. **No Polling**: Event bus for reactive updates
3. **Persistent**: State stored in OpenCode's storage
4. **Reusable**: Can review any session, not just live ones
5. **Clean Separation**: Orchestrator can't write code, only analyze
6. **Role Inversion**: Doer's outputs become orchestrator's inputs for critique
7. **Trust But Verify**: Todo state shows intent, messages show execution

## Example Usage

```bash
# Create supervised session
curl -X POST http://localhost:4096/orchestrator/supervise \
  -H "Content-Type: application/json" \
  -d '{"projectDescription": "Create a web server with health check"}'

# Returns: { "orchestratorID": "ses_abc", "doerID": "ses_def" }

# Monitor both sessions in TUI
opencode tui --session ses_abc --child ses_def
```

## Open Questions

1. **Timeout detection**: How long is "too long" for a task?
   - Solution: Add timestamps to todo items

2. **Feedback loop**: What if doer ignores orchestrator's feedback?
   - Solution: Max retry count, then escalate to user

3. **Session lifecycle**: When to end supervision?
   - Solution: When all orchestrator's todos are completed or escalated

4. **Multi-doer**: Can one orchestrator supervise multiple doers?
   - Future: Yes, via multiple child sessions

5. **Permission enforcement**: How to prevent doer from using tools it shouldn't?
   - Solution: Use agent permissions, configure doer with restricted tools
