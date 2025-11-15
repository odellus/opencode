# Orchestrator Architecture Findings

## Key Discovery: Task Tool Already Does This!

The **Task tool** (`packages/opencode/src/tool/task.ts`) already implements subagent delegation! You don't need to build a separate orchestrator system - you can make the orchestrator agent use the Task tool to delegate to the build agent.

## Agent Architecture

### Agent Modes

**Three modes defined in `Agent.Info`:**
- `mode: "primary"` - Can be selected as main session agent (build, plan, orchestrator)
- `mode: "subagent"` - Only usable via Task tool (general, custom agents)
- `mode: "all"` - Can be both (flexible)

**Current built-in agents:**
```typescript
// packages/opencode/src/agent/agent.ts

general: {
  mode: "subagent",  // Task tool only
  description: "General-purpose agent for research, code search, multi-step tasks"
}

build: {
  mode: "primary",  // Default doer agent
  tools: { all tools enabled }
}

plan: {
  mode: "primary",  // Planning agent
  permission: { edit: "deny", limited bash }
}

orchestrator: {
  mode: "primary",  // WE JUST ADDED THIS
  prompt: PROMPT_ORCHESTRATOR,
  tools: { all tools + todowrite/todoread }
}
```

### How Task Tool Works

**Location:** `packages/opencode/src/tool/task.ts`

**What it does:**
1. Creates a **child session** with `parentID` set to caller
2. Sends prompt to subagent in that session
3. Waits for subagent to complete
4. Returns final text response to parent
5. Stores full conversation in child session

**Key code:**
```typescript
const session = await Session.create({
  parentID: ctx.sessionID,  // Child session!
  title: params.description + ` (@${agent.name} subagent)`,
})

await SessionPrompt.prompt({
  sessionID: session.id,
  agent: agent.name,  // Run as specified agent
  tools: {
    todowrite: false,  // Subagents don't manage main todos
    todoread: false,
    task: false,  // Prevents infinite nesting
    ...agent.tools,
  },
  parts: promptParts,
})
```

**Available subagents:**
- Filters agents where `mode !== "primary"`
- Currently just `general` agent
- **Build is NOT a subagent** - it's primary mode

## Your Requirement: Orchestrator Must Delegate to Build

**Problem:** Build agent has `mode: "primary"`, not `"subagent"`
- Task tool filters it out: `agents.filter((a) => a.mode !== "primary")`
- So orchestrator can't delegate to it via Task tool

**Solution Options:**

### Option 1: Change Build to "all" Mode (Recommended)
```typescript
build: {
  mode: "all",  // Can be both primary AND subagent
  tools: { ...defaultTools },
  permission: agentPermission,
}
```

**Pros:**
- Simple one-line change
- Build works as primary session (current behavior)
- Build now usable via Task tool (new behavior)
- No breaking changes

**Cons:**
- None really

### Option 2: Create "Worker" Subagent
```typescript
worker: {
  mode: "subagent",
  description: "Executes tasks as instructed. Does the actual coding work.",
  tools: { ...defaultTools },  // Same as build
  permission: agentPermission,
  prompt: "You are a worker agent. Do exactly what the orchestrator asks.",
}
```

**Pros:**
- Clear separation: build = primary, worker = delegated
- Can customize worker behavior vs build

**Cons:**
- Duplicate agent definitions
- More complexity

### Option 3: Add "delegatable" Flag
```typescript
build: {
  mode: "primary",
  delegatable: true,  // NEW FIELD
}

// In task.ts:
const agents = await Agent.list().then(x => 
  x.filter(a => a.mode === "subagent" || a.delegatable)
)
```

**Pros:**
- Explicit control
- Build stays "primary" mode

**Cons:**
- New field to maintain
- More code changes

## Orchestrator Workflow (Using Task Tool)

**Revised orchestrator system prompt:**
```
You are an orchestrator agent - a project manager.

Your workflow:
1. User describes a project
2. You break it into 3-7 concrete, ordered tasks using TodoWrite
3. For each task:
   a. Use the Task tool to delegate to the "build" agent (or "worker")
   b. Provide clear task description
   c. Wait for completion
   d. Review the result
   e. Check files changed, tests passed
   f. Decide: APPROVED (next task) or RETRY (send different prompt)
4. Keep user informed of progress

You CAN make small edits yourself (fix typos, adjust configs), but delegate
substantial implementation work to the build agent via Task tool.

Critical: Always use Task tool for implementation work. You coordinate, 
the build agent executes.
```

**Example conversation:**
```
User: Build a TODO app

Orchestrator: I'll break this into 5 tasks:
[Uses TodoWrite to create 5 todos]

Task 1: Set up project structure
[Uses Task tool: subagent_type="build", prompt="Create React project with TypeScript..."]

[Build agent creates files in child session]

Orchestrator: ✓ Task 1 complete. Files created:
- package.json
- tsconfig.json  
- src/index.tsx

Moving to task 2: Implement data model
[Uses Task tool again...]
```

## Agent Selection UI

### Desktop UI
**Location:** `packages/desktop/src/components/prompt-input.tsx`

**Current behavior:**
- Shows model/agent selectors
- Filters agents by `mode === "primary"` for main dropdown
- No explicit "orchestrator" tab/button yet

**Needed changes:**
- Add orchestrator to agent dropdown (already works if mode="primary")
- OR: Special "Orchestrated Session" button that creates session with orchestrator agent

### TUI
**Location:** `packages/opencode/src/cli/cmd/tui/`

**Current behavior:**
- Agent selection via command line flag: `--agent build` or `--agent plan`
- No UI for switching agents mid-session

**Needed changes:**
- Add `--agent orchestrator` support (already works)
- Show different UI when orchestrator is active (optional polish)

## Parent/Child Session Architecture

**Already supported!**
- `Session.create({ parentID: string })` creates child
- Bus events include sessionID, so orchestrator can monitor children
- Child session messages stored separately
- Task tool already uses this

**Orchestrator can:**
- Create doer session with `Session.create({ parentID: orchestratorSessionID })`
- Monitor doer via `Bus.subscribe(Session.Event.Updated, ...)`
- Read doer messages via `MessageV2.stream(doerSessionID)`
- Inject feedback via `SessionPrompt.prompt({ sessionID: doerSessionID, ... })`

**But simpler to just use Task tool!**

## Recommendation: Simplified Orchestrator

**Don't build complex supervision system**. Use what exists:

### 1. Change Build Agent Mode
```typescript
// packages/opencode/src/agent/agent.ts
build: {
  mode: "all",  // WAS: "primary"
  // ... rest unchanged
}
```

### 2. Update Orchestrator Prompt
```typescript
// packages/opencode/src/agent/orchestrator.txt

You are an orchestrator - a project manager that breaks work into tasks.

CRITICAL: You do NOT write code yourself. You delegate to the build agent via Task tool.

Workflow:
1. Break project into 3-7 tasks (use TodoWrite)
2. For each task:
   - Use Task tool with subagent_type="build"
   - Provide detailed task description
   - Review the result
   - Verify files changed (use grep/read to check)
3. Mark todo as complete when verified
4. Move to next task

Example:
Task 1: Create user schema
[Task(subagent_type="build", description="Create user schema", 
  prompt="Create a TypeScript interface for User in src/types/user.ts with fields: id, name, email, createdAt")]

[Reviews result]
✓ Verified: src/types/user.ts created with correct fields
```

### 3. Give Orchestrator Task Tool
```typescript
orchestrator: {
  tools: {
    ...defaultTools,
    task: true,  // CAN delegate
    todowrite: true,
    todoread: true,
  }
}
```

### 4. Test It
```bash
./dist/opencode-linux-x64/bin/opencode tui --agent orchestrator

> Build a TODO app

Orchestrator: I'll break this into 5 tasks...
[Creates todos]
[Uses Task tool to delegate to build agent]
[Build agent does the work in child session]
[Orchestrator reviews and approves]
[Moves to next task]
```

## Summary

**What you get:**
- Orchestrator agent is "primary" mode (user can select it)
- Build agent is "all" mode (usable as primary OR subagent)
- Orchestrator delegates via existing Task tool
- No new infrastructure needed
- Parent/child sessions already work
- Supervision via existing Bus events (if needed for polish)

**Changes needed:**
1. ✅ Add orchestrator agent (DONE)
2. ✅ Create orchestrator.txt prompt (DONE) - NEEDS UPDATE
3. ⬜ Change build.mode from "primary" to "all"
4. ⬜ Update orchestrator prompt to always use Task tool
5. ⬜ Rebuild and test

**This is WAY simpler than building a separate orchestrator system!**
