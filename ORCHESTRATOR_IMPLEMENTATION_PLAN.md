# Orchestrator Implementation Plan - Sequential Supervision

## Vision

**User experience:** User talks to orchestrator only. Orchestrator breaks work into tasks, delegates to doer, reviews completion, and manages the whole project lifecycle.

**User never sees doer directly** - orchestrator is the interface, doer is the worker.

## Architecture Overview

```
User → Orchestrator Session (orchestrator agent)
          ↓
          Creates & monitors Doer Session (build agent)
          ↓
          Sequential flow:
          1. Orchestrator: breaks project into tasks
          2. Orchestrator → Doer: "Do task 1"
          3. Doer: works on task (tools, edits, etc.)
          4. Doer: "Task done"
          5. Orchestrator: reviews work (git diff, tests, etc.)
          6. Orchestrator decision:
             - ✓ APPROVED: move to next task
             - ✗ RETRY: send feedback to doer
             - ⚠️ ESCALATE: ask user for help
```

## Core Components

### 1. Orchestrator Agent (New Built-in Agent)

**File:** `packages/opencode/src/agent/agent.ts`

```typescript
// Add to the result object in Agent.state():

orchestrator: {
  name: "orchestrator",
  description: "Project manager agent that breaks work into tasks and supervises execution",
  tools: {
    // Orchestrator can read but not write code
    read: true,
    grep: true,
    glob: true,
    ls: true,
    bash: true,  // Read-only commands via permissions
    todowrite: true,  // Manages project tasks
    todoread: true,
    
    // Cannot modify code directly
    write: false,
    edit: false,
    task: false,  // Doer uses this, not orchestrator
  },
  permission: {
    edit: "deny",
    bash: {
      // Read-only bash commands
      "git status*": "allow",
      "git log*": "allow",
      "git diff*": "allow",
      "ls*": "allow",
      "cat*": "allow",
      "grep*": "allow",
      "find*": "allow",
      "test*": "allow",  // Can run tests to verify
      "npm test*": "allow",
      "bun test*": "allow",
      "*": "deny",  // Everything else denied
    },
    webfetch: "deny",
    doom_loop: "deny",
    external_directory: "deny",
  },
  mode: "primary",  // Can be used as main agent
  builtIn: true,
  prompt: ORCHESTRATOR_SYSTEM_PROMPT,  // New prompt file
},
```

**New file:** `packages/opencode/src/agent/orchestrator.txt`

```
You are an orchestrator agent - a project manager that breaks work into tasks and supervises their execution.

Your workflow:
1. When user describes a project, break it into 3-7 concrete, ordered tasks
2. Create todos for each task using TodoWrite
3. Delegate the current task to a doer agent
4. Wait for doer to complete
5. Review doer's work critically:
   - Check git diff for changes
   - Run tests if applicable
   - Verify task requirements met
6. Make decision: APPROVE (continue), RETRY (send feedback), or ESCALATE (ask user)

You manage the doer agent through a child session. The doer cannot see your thoughts - you coordinate everything.

When reviewing work:
- Be thorough but not pedantic
- Check for actual implementation, not just claims
- Verify tests pass
- Look for edge cases
- Consider if solution is production-ready

Your tone with the doer should be direct and clear. With the user, be helpful and transparent about progress.

Critical: You do NOT write code yourself. You delegate to the doer and review their work.
```

### 2. Orchestrator Core Logic

**File:** `packages/opencode/src/orchestrator/orchestrator.ts` (expand existing)

```typescript
export namespace Orchestrator {
  /**
   * Orchestrator state machine
   */
  export type State = 
    | { phase: "planning"; tasks: string[] }
    | { phase: "executing"; currentTask: number; tasks: string[] }
    | { phase: "reviewing"; currentTask: number; tasks: string[] }
    | { phase: "complete" }
    | { phase: "blocked"; reason: string }

  /**
   * Create orchestrated session - user talks to orchestrator only
   */
  export async function create(input: {
    projectDescription: string
    directory: string
    model?: { providerID: string; modelID: string }
  }): Promise<{
    orchestratorSessionID: string
    doerSessionID: string
  }> {
    // 1. Create orchestrator session with orchestrator agent
    const orchestratorSession = await Session.create({
      title: `Project: ${input.projectDescription}`,
      directory: input.directory,
    })

    // 2. Send initial prompt to orchestrator to plan
    await SessionPrompt.prompt({
      sessionID: orchestratorSession.id,
      agent: "orchestrator",
      model: input.model,
      parts: [{
        type: "text",
        text: input.projectDescription,
      }],
    })

    // Orchestrator will now:
    // - Break project into tasks (creates todos)
    // - Create doer session (via special command or API)
    // - Start task delegation

    return {
      orchestratorSessionID: orchestratorSession.id,
      doerSessionID: "", // Will be created by orchestrator
    }
  }

  /**
   * Orchestrator creates and manages doer session
   */
  export async function createDoerSession(input: {
    orchestratorSessionID: string
    taskDescription: string
  }): Promise<string> {
    const doerSession = await Session.create({
      title: `Task: ${input.taskDescription}`,
      parentID: input.orchestratorSessionID,
    })

    // Set up monitoring
    setupSupervision({
      orchestratorSessionID: input.orchestratorSessionID,
      doerSessionID: doerSession.id,
    })

    return doerSession.id
  }

  /**
   * Monitor doer session for completion
   */
  function setupSupervision(input: {
    orchestratorSessionID: string
    doerSessionID: string
  }) {
    // Subscribe to doer session updates
    Bus.subscribe(Session.Event.Updated, async (event) => {
      if (event.properties.info.id !== input.doerSessionID) return

      // Check if doer claims done
      const isDone = await checkDoerDone(input.doerSessionID)
      if (!isDone) return

      // Notify orchestrator that doer is done
      await notifyOrchestratorDoerDone(input.orchestratorSessionID, input.doerSessionID)
    })

    // Subscribe to anti-pattern detection
    Bus.subscribe(Todo.Event.Updated, async (event) => {
      if (event.properties.sessionID !== input.doerSessionID) return

      const antiPatterns = detectTodoAntiPatterns(event.properties.todos)
      if (antiPatterns.length > 0) {
        await sendAntiPatternFeedback(input.doerSessionID, antiPatterns)
      }
    })
  }

  /**
   * Check if doer claims to be done
   */
  async function checkDoerDone(doerSessionID: string): Promise<boolean> {
    const messages: MessageV2.WithParts[] = []
    for await (const msg of MessageV2.stream(doerSessionID)) {
      messages.push(msg)
    }

    const lastMsg = messages[messages.length - 1]
    if (!lastMsg || lastMsg.info.role !== "assistant") return false

    // Check for completion indicators
    const text = extractText(lastMsg.parts)
    const doneKeywords = ["done", "complete", "finished", "ready for review"]
    return doneKeywords.some(keyword => text.toLowerCase().includes(keyword))
  }

  /**
   * Notify orchestrator that doer finished
   */
  async function notifyOrchestratorDoerDone(
    orchestratorSessionID: string,
    doerSessionID: string
  ) {
    // Create summary of doer's work
    const summary = await createWorkSummary(doerSessionID)

    // Send to orchestrator for review
    await SessionPrompt.prompt({
      sessionID: orchestratorSessionID,
      agent: "orchestrator",
      parts: [{
        type: "text",
        text: `The doer agent has finished the task. Here's what they did:\n\n${summary}\n\nPlease review and decide: APPROVE, RETRY, or ESCALATE.`,
      }],
    })
  }

  /**
   * Create summary of doer's work for orchestrator review
   */
  async function createWorkSummary(doerSessionID: string): Promise<string> {
    const messages: MessageV2.WithParts[] = []
    for await (const msg of MessageV2.stream(doerSessionID)) {
      messages.push(msg)
    }

    let summary = "## Doer's Work Summary\n\n"

    // Get file changes
    const fileStatus = await File.status()
    if (fileStatus.length > 0) {
      summary += "### Files Changed:\n"
      for (const file of fileStatus) {
        summary += `- ${file.path} (${file.status})\n`
      }
      summary += "\n"
    }

    // Get conversation highlights
    summary += "### Doer's Actions:\n"
    for (const msg of messages) {
      if (msg.info.role === "assistant") {
        const text = extractText(msg.parts)
        if (text.length > 200) {
          summary += `- ${text.substring(0, 200)}...\n`
        } else {
          summary += `- ${text}\n`
        }
      }
    }

    return summary
  }

  function extractText(parts: MessageV2.Part[]): string {
    return parts
      .filter((p) => p.type === "text")
      .map((p) => (p as any).text)
      .join(" ")
  }
}
```

### 3. New API Endpoints

**File:** `packages/opencode/src/server/server.ts`

```typescript
// Add new endpoints:

.post(
  "/orchestrator/create",
  describeRoute({
    description: "Create orchestrated session with project manager",
    operationId: "orchestrator.create",
    requestBody: {
      content: {
        "application/json": {
          schema: z.object({
            projectDescription: z.string(),
            directory: z.string().optional(),
            model: z.object({
              providerID: z.string(),
              modelID: z.string(),
            }).optional(),
          }),
        },
      },
    },
    responses: {
      200: {
        description: "Orchestrated session created",
        content: {
          "application/json": {
            schema: z.object({
              orchestratorSessionID: z.string(),
              doerSessionID: z.string(),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    const { projectDescription, directory, model } = await c.req.json()
    const result = await Orchestrator.create({
      projectDescription,
      directory: directory || Instance.directory,
      model,
    })
    return c.json(result)
  }
)

.post(
  "/orchestrator/:id/review",
  describeRoute({
    description: "Orchestrator reviews doer's work and makes decision",
    operationId: "orchestrator.review",
    parameters: [
      resolver(
        "param",
        z.object({
          id: z.string().meta({ description: "Orchestrator Session ID" }),
        }),
      ),
    ],
    requestBody: {
      content: {
        "application/json": {
          schema: z.object({
            doerSessionID: z.string(),
            decision: z.enum(["APPROVE", "RETRY", "ESCALATE"]),
            feedback: z.string().optional(),
          }),
        },
      },
    },
    responses: {
      200: {
        description: "Review processed",
      },
    },
  }),
  async (c) => {
    const orchestratorSessionID = c.req.valid("param").id
    const { doerSessionID, decision, feedback } = await c.req.json()
    
    // Process orchestrator's decision
    // Implementation TBD based on decision type
    
    return c.json({ success: true })
  }
)
```

### 4. Desktop UI Integration

**File:** `packages/desktop/src/pages/session.tsx`

**Changes needed:**
- Detect if session is orchestrator session (check agent name)
- Show different UI for orchestrator sessions:
  - Highlight orchestrator messages differently (e.g., blue background)
  - Show "Orchestrator is reviewing..." loading state
  - Show task progress (which task of N)
  - Collapse doer session details (or show in expandable section)

**UI Mockup:**

```
┌────────────────────────────────────────────┐
│ Project: Build TODO App          [Task 2/5]│
├────────────────────────────────────────────┤
│ 🎯 Orchestrator:                           │
│ I've broken this into 5 tasks. Starting    │
│ with the data model...                     │
│                                            │
│   └─ 🤖 Doer: Creating user.ts...         │
│      └─ 🤖 Doer: Tests passing ✓          │
│      └─ 🤖 Doer: Done!                    │
│                                            │
│ 🎯 Orchestrator: [Reviewing work...] ⏳    │
│                                            │
│ 🎯 Orchestrator: ✓ Task 1 approved.       │
│ Moving to task 2: CRUD operations          │
│                                            │
│ You: Can you add validation?              │
│                                            │
│ 🎯 Orchestrator: Good idea. I'll add that │
│ as task 6.                                 │
├────────────────────────────────────────────┤
│ Type your message...                       │
└────────────────────────────────────────────┘
```

### 5. Tools Needed by Orchestrator

**New Tool:** `CreateDoerSessionTool`

**File:** `packages/opencode/src/tool/create-doer-session.ts`

```typescript
export const CreateDoerSessionTool = Tool.define({
  name: "CreateDoerSession",
  description: "Create a doer session to work on a specific task",
  input: z.object({
    task_description: z.string().describe("Clear description of the task for the doer"),
  }),
  execute: async (input, context) => {
    const doerSessionID = await Orchestrator.createDoerSession({
      orchestratorSessionID: context.sessionID,
      taskDescription: input.task_description,
    })

    return {
      doerSessionID,
      message: `Created doer session ${doerSessionID} for task: ${input.task_description}`,
    }
  },
})
```

**New Tool:** `SendToDoerTool`

**File:** `packages/opencode/src/tool/send-to-doer.ts`

```typescript
export const SendToDoerTool = Tool.define({
  name: "SendToDoer",
  description: "Send a message/task to the doer agent",
  input: z.object({
    doer_session_id: z.string(),
    message: z.string().describe("Message or task for the doer"),
  }),
  execute: async (input, context) => {
    await SessionPrompt.prompt({
      sessionID: input.doer_session_id,
      agent: "build",  // Doer uses build agent
      parts: [{
        type: "text",
        text: input.message,
      }],
    })

    return {
      success: true,
      message: "Message sent to doer",
    }
  },
})
```

**New Tool:** `ReviewDoerWorkTool`

**File:** `packages/opencode/src/tool/review-doer-work.ts`

```typescript
export const ReviewDoerWorkTool = Tool.define({
  name: "ReviewDoerWork",
  description: "Get summary of doer's work for review",
  input: z.object({
    doer_session_id: z.string(),
  }),
  execute: async (input, context) => {
    const summary = await Orchestrator.createWorkSummary(input.doer_session_id)
    
    return {
      summary,
      session_id: input.doer_session_id,
    }
  },
})
```

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Add orchestrator agent to `agent.ts`
- [ ] Create `orchestrator.txt` system prompt
- [ ] Implement `Orchestrator.create()` and `Orchestrator.createDoerSession()`
- [ ] Add supervision event handlers
- [ ] Create new tools: CreateDoerSession, SendToDoer, ReviewDoerWork
- [ ] Register tools in `tool/registry.ts`

### Phase 2: API & Testing (Week 1-2)
- [ ] Add `/orchestrator/create` endpoint
- [ ] Add `/orchestrator/:id/review` endpoint
- [ ] Test with llm-demo style integration test
- [ ] Verify event bus coordination works
- [ ] Test with local LM Studio model

### Phase 3: Desktop UI (Week 2)
- [ ] Update session.tsx to detect orchestrator sessions
- [ ] Add orchestrator-specific message styling
- [ ] Show task progress indicator
- [ ] Add collapsible doer session view
- [ ] Test end-to-end user flow

### Phase 4: Polish & Edge Cases (Week 3)
- [ ] Handle doer getting stuck (timeout)
- [ ] Handle orchestrator getting stuck (doom loop detection)
- [ ] Add ability to cancel/restart tasks
- [ ] Improve work summary quality
- [ ] Add more anti-pattern detectors

## Success Criteria

1. **User can create orchestrated session** via Desktop UI
2. **Orchestrator breaks work into tasks** automatically
3. **Doer executes tasks** without user intervention
4. **Orchestrator reviews work** and makes decisions
5. **User only sees orchestrator messages** primarily
6. **Sequential flow works** - no parallel confusion
7. **Works with local LM Studio** model

## Open Questions

1. **How does orchestrator create doer session?**
   - Via tool call (CreateDoerSessionTool)
   - Orchestrator has explicit tool for this

2. **What if doer never says "done"?**
   - Timeout after N minutes
   - Orchestrator can send "Are you done?" prompt
   - Max message count per task

3. **How to handle escalations?**
   - Orchestrator sends message to user
   - Wait for user response
   - Resume after user provides input

4. **Can user override orchestrator?**
   - Yes, user messages go to orchestrator
   - Orchestrator adjusts plan based on user input

5. **Do we need state persistence?**
   - Yes, use session metadata to store:
     - Current task index
     - Task list
     - Doer session ID
   - Survives restarts

## Next Steps

1. Review this plan with user
2. Start Phase 1 implementation
3. Test incrementally with local model
4. Iterate based on real usage
