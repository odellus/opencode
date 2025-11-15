# Autonomous Agent Architecture

## Overview

OpenCode now has a **3-tier autonomous agent hierarchy** designed to handle complex projects with minimal human intervention.

```
USER → MANAGER → ORCHESTRATOR → BUILD AGENT
```

## Agent Hierarchy

### 1. Manager Agent (Top Tier)
**File:** `packages/opencode/src/agent/manager.txt`

**Role:** Autonomous project manager that reads high-level specs and manages execution through orchestrators.

**Key Features:**
- Reads project specs (can be blog-post style, detailed requirements, or rough ideas)
- Breaks projects into logical phases/milestones
- Delegates phases to orchestrator agents via Task tool
- Monitors orchestrator progress in real-time via todo updates
- Reflects on completed work and adjusts strategy
- Operates autonomously - doesn't constantly ask for approval

**When to use:** Give it a full project spec and let it run autonomously.

**Example:**
```bash
# Via HTTP API
POST /session/:id/message
{
  "agent": "manager",
  "model": { "providerID": "lmstudio", "modelID": "..." },
  "parts": [{ 
    "type": "text", 
    "text": "Build a todo app with React frontend and Node backend" 
  }]
}
```

### 2. Orchestrator Agent (Middle Tier)
**File:** `packages/opencode/src/agent/orchestrator.txt`

**Role:** Project coordinator that breaks down phases into concrete tasks and manages execution.

**Key Features:**
- Breaks user requests into 3-7 ordered tasks
- Creates todos to track each task
- Can execute tasks directly OR delegate to build agent
- Verifies each task before moving to next
- Real-time supervision of delegated work

**Supervision System:**
- Monitors subagent todo updates via Bus events (`Todo.Event.Updated`)
- Detects anti-patterns (multiple tasks in progress, stuck tasks)
- Sends feedback to subagents when issues detected
- Triggers review when subagent completes all todos

**When to use:** For multi-step tasks that need coordination.

### 3. Build Agent (Bottom Tier)
**Built-in agent, no custom prompt**

**Role:** Executes specific tasks - writes code, runs commands, creates files.

**Key Features:**
- Direct execution of concrete tasks
- Uses all tools (Write, Edit, Bash, etc.)
- Creates detailed todos for implementation steps
- Can be supervised by orchestrator

**Mode:** `"all"` - Can be used as primary agent OR delegated to as subagent

## Real-Time Supervision

### How It Works

**File:** `packages/opencode/src/orchestrator/orchestrator.ts`

The orchestrator can supervise subagent execution in real-time:

1. **Todo Change Detection**
   - Every time subagent updates their todos, `Todo.Event.Updated` fires
   - Orchestrator's `detectTodoChanges()` identifies what changed:
     - New todos added
     - Todos started (pending → in_progress)
     - Todos completed (in_progress → completed)
     - All todos completed

2. **Anti-Pattern Detection**
   - Multiple tasks in progress (should focus on one at a time)
   - Stuck tasks (no progress for long time)
   - Other workflow violations

3. **Intervention**
   - Orchestrator sends feedback via direct message injection
   - Subagent sees feedback in their session
   - Can provide guidance or corrections in real-time

4. **Completion Review**
   - When subagent completes all todos, orchestrator is notified
   - Can verify work, run tests, check files
   - Decides whether to approve or request changes

## Task Delegation via Task Tool

**File:** `packages/opencode/src/tool/task.ts`

Agents delegate work using the Task tool:

```typescript
{
  "name": "task",
  "input": {
    "description": "Create user authentication",
    "prompt": "Build a user auth system with login and signup...",
    "subagent_type": "build"
  }
}
```

This creates a **child session** with:
- `parentID` set to orchestrator's session
- Separate message history
- Own todo list
- Supervised by parent orchestrator

The orchestrator monitors the child session via `Orchestrator.supervise()`.

## Demo Scripts

### 1. Orchestrator → Build Agent
**File:** `packages/opencode/src/orchestrator/demo-delegation.ts`

Shows orchestrator delegating file creation to build agent via HTTP API.

```bash
bun run src/orchestrator/demo-delegation.ts
```

### 2. Manager → Orchestrator → Build Agent
**File:** `packages/opencode/src/orchestrator/demo-manager.ts`

Shows full 3-tier hierarchy with autonomous manager.

```bash
bun run src/orchestrator/demo-manager.ts
```

### 3. Direct LLM Demo (older)
**File:** `packages/opencode/src/orchestrator/llm-demo.ts`

Shows supervision with direct LLM calls (not via HTTP API).

```bash
bun run src/orchestrator/llm-demo.ts
```

## Tests

### Unit Tests
**File:** `packages/opencode/test/orchestrator/todo-change-detection.test.ts`

Tests the `detectTodoChanges()` logic in isolation.

### Integration Tests
**File:** `packages/opencode/test/orchestrator/realtime-supervision.test.ts`

Tests supervision mechanics (Bus events, message injection) without LLM.

### Real Conversation Tests
**File:** `packages/opencode/test/orchestrator/real-conversation.test.ts`

Tests with actual LLM conversations - no mocking.

## HTTP API Usage

All agents can be used via the OpenCode server HTTP API:

### Create Session
```bash
POST /session
{
  "title": "My project"
}
```

### Send Message to Agent
```bash
POST /session/:id/message
{
  "agent": "manager",  # or "orchestrator" or "build"
  "model": {
    "providerID": "lmstudio",
    "modelID": "glm-4.5-air@q4_k_m"
  },
  "parts": [
    {
      "type": "text",
      "text": "Your request here"
    }
  ]
}
```

### Get Todos
```bash
GET /session/:id/todo
```

### Get Child Sessions
```bash
GET /session/:id/children
```

### Get Messages
```bash
GET /session/:id/message
```

## Configuration

### LM Studio Setup
In `.opencode/opencode.json`:

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

## Key Implementation Files

- `packages/opencode/src/agent/agent.ts` - Agent registry
- `packages/opencode/src/agent/manager.txt` - Manager prompt
- `packages/opencode/src/agent/orchestrator.txt` - Orchestrator prompt
- `packages/opencode/src/orchestrator/orchestrator.ts` - Supervision logic
- `packages/opencode/src/tool/task.ts` - Delegation tool
- `packages/opencode/src/session/todo.ts` - Todo system with events

## Next Steps

1. **Test the full hierarchy** - Run demo-manager.ts with real LLM
2. **Blog-style UI** - Build interface where user writes project specs as posts
3. **Parallel execution** - Manager runs multiple orchestrators concurrently
4. **Learning/adaptation** - Manager reflects on failures and adjusts strategy
5. **Project templates** - Pre-defined project structures for common tasks
