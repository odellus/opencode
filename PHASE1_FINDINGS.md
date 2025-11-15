# Phase 1 Findings: Subagent Communication & State Management

## Executive Summary

**Current State**: Subagents are **completely stateless**. Each Task tool invocation creates a fresh child session with zero memory of previous interactions.

**Impact**: BUILD and SUPERVISE cannot pair program because they forget everything between turns. No iterative refinement. No "like you mentioned earlier" discussions.

**Root Cause**: The Task tool creates isolated child sessions that only send back a final summary to the parent. No conversation persistence mechanism exists.

---

## How Subagent Type Selection Works

### 1. Task Tool Invocation Flow

**File**: `packages/opencode/src/tool/task.ts`

```typescript
// Line 28: Agent lookup by name
const agent = await Agent.get(params.subagent_type)

// Line 31-33: Creates isolated child session
const session = await Session.create({
  parentID: ctx.sessionID,
  title: params.description + ` (@${agent.name} subagent)`,
})

// Line 66-76: Execute in child session with restricted tools
const result = await SessionPrompt.prompt({
  messageID,
  sessionID: session.id,  // Child session ID
  model: { modelID: model.modelID, providerID: model.providerID },
  agent: agent.name,
  tools: {
    todowrite: false,  // Disabled in subagents
    todoread: false,   // Disabled in subagents
    task: false,       // Disabled (no recursive delegation)
    ...agent.tools,
  },
  parts: promptParts,
})

// Line 82-84: Returns only final text summary
return {
  output: (result.parts.findLast((x) => x.type === "text"))?.text ?? "",
}
```

**Key Insight**: The parent agent only sees the final text output. All tool calls, reasoning, and intermediate steps are hidden.

### 2. Agent Mode Types

**File**: `packages/opencode/src/agent/agent.ts:95-170`

```typescript
const agents = {
  general: {
    mode: "subagent",  // Only callable via Task tool
  },
  build: {
    mode: "all",  // Can be primary OR subagent
  },
  plan: {
    mode: "primary",  // Only available as main agent
  },
  supervisor: {
    mode: "primary",
  },
  architect: {
    mode: "primary",
  },
}
```

**Mode Semantics**:
- `"subagent"` - Only accessible via Task tool (general, orchestrator)
- `"primary"` - Only available in TUI as main agent (plan, supervisor, architect)
- `"all"` - Can be either (build)

### 3. How LLM Chooses Subagent Type

The LLM receives this in the Task tool description (`task.txt`):

```
Available agent types and the tools they have access to:
- general-purpose: General-purpose agent for researching...
- statusline-setup: Use this agent to configure...
- Explore: Fast agent specialized for exploring codebases...
```

**File**: `packages/opencode/src/tool/task.ts:13-16`

```typescript
const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))
const description = DESCRIPTION.replace(
  "{agents}",
  agents.map((a) => `- ${a.name}: ${a.description ?? "..."}`)
)
```

**The LLM picks based on**:
1. Agent descriptions in the tool prompt
2. Custom agents in `.opencode/agent/*.md` with `mode: subagent`
3. Built-in subagents (general, build when delegated)

**Why "general" gets invoked instead of BUILD/SUPERVISE**: If BUILD or SUPERVISE have `mode: "primary"`, they won't appear in the agent list. The LLM falls back to "general".

---

## Current Communication Pattern

### Parent → Child (Task Tool Invocation)

**What gets sent**:
```typescript
{
  description: "Short task description",
  subagent_type: "build",  // or "supervise", "general"
  prompt: "Full task instructions including context"
}
```

**File**: `packages/opencode/src/tool/task.ts:66-72`

### Child → Parent (Return Value)

**What gets returned**:
```typescript
{
  title: "Task description",
  metadata: {
    summary: [...],  // Array of tool calls made by child
    sessionId: "child-session-id"
  },
  output: "Final text response from child agent"
}
```

**File**: `packages/opencode/src/tool/task.ts:82-89`

**Critical Missing Pieces**:
1. ❌ No conversation history passed from parent to child
2. ❌ No way to resume a child session
3. ❌ No shared context between multiple Task invocations
4. ❌ Child can't "reply" back - only send final output
5. ❌ Parent sees only final text, not the child's reasoning

---

## Session Architecture

### Session Hierarchy

**File**: `packages/opencode/src/session/index.ts:45-48`

```typescript
export const Info = z.object({
  id: Identifier.schema("session"),
  parentID: Identifier.schema("session").optional(),  // Links to parent
  directory: z.string(),
  title: z.string(),
  // ... no conversation link to parent
})
```

**Parent-Child Relationship**:
- Child sessions have `parentID` pointing to parent
- Storage: `["session", projectID, sessionID]`
- Child messages stored separately: `["message", childSessionID, messageID]`
- **No cross-session message sharing**

### Message Context Building

**File**: `packages/opencode/src/session/prompt.ts:482-530`

```typescript
async function getMessages(input: { sessionID: string }) {
  let msgs = await MessageV2.filterCompacted(MessageV2.stream(input.sessionID))
  // ^^^ Only reads from CURRENT session
  // No parent context pulled in
  return msgs
}
```

**Where messages come from**:
1. `MessageV2.stream(sessionID)` - streams messages from current session only
2. Compaction summaries (when context overflow)
3. **NOT from parent session**

---

## Is ANY State Preserved Between Turns?

### Answer: NO

**Evidence**:

1. **Each Task tool call creates NEW child session** (task.ts:31-33)
2. **getMessages() only reads current session** (prompt.ts:483)
3. **No session reuse mechanism exists**
4. **Child sessions are write-only archives**

### Example Scenario

```
Turn 1:
  ARCHITECT → Task(BUILD, "implement feature X")
    → Creates session-001
    → BUILD implements feature
    → Returns "Done, implemented X"
  
Turn 2:
  ARCHITECT → Task(SUPERVISE, "review BUILD's work")
    → Creates session-002 (NEW SESSION)
    → SUPERVISE has ZERO context about session-001
    → SUPERVISE can't see what BUILD did
    → Can only see: "review BUILD's work" prompt
```

**Why this breaks pair programming**:
- SUPERVISE can't reference BUILD's implementation
- BUILD can't respond to SUPERVISE's feedback
- No iterative back-and-forth possible
- Each interaction is isolated

---

## Architecture Diagram: Current System

```
┌─────────────────────────────────────────────────────────┐
│ ARCHITECT (Primary Agent, Session 000)                  │
│                                                          │
│ "Implement auth feature"                                │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Task(BUILD, "implement auth")
                     ▼
        ┌────────────────────────────┐
        │ BUILD (Session 001)        │
        │ - No parent context        │
        │ - Implements auth          │
        │ - Returns: "Done"          │
        └────────────┬───────────────┘
                     │
                     │ output: "Implemented auth with JWT"
                     ▼
┌─────────────────────────────────────────────────────────┐
│ ARCHITECT receives: "Implemented auth with JWT"          │
│                                                          │
│ "Now have SUPERVISE review it"                          │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Task(SUPERVISE, "review BUILD's auth")
                     ▼
        ┌────────────────────────────────┐
        │ SUPERVISE (Session 002)        │
        │ - No parent context            │
        │ - No session-001 access        │
        │ - Can't see BUILD's code!      │
        │ - Returns: "Can't find auth"   │
        └────────────────────────────────┘

❌ BROKEN: SUPERVISE and BUILD never interact
```

---

## Code Paths Analysis

### 1. Task Tool Execution Path

```
task.ts:execute()
  ├─ Line 28: Agent.get(subagent_type)
  ├─ Line 31: Session.create({ parentID })  ← NEW SESSION
  ├─ Line 66: SessionPrompt.prompt({
  │             sessionID: NEW_SESSION_ID
  │           })
  │    └─ prompt.ts:getMessages(NEW_SESSION_ID)
  │         └─ MessageV2.stream(NEW_SESSION_ID)  ← Only current session
  │              └─ Storage.list(["message", NEW_SESSION_ID])
  └─ Line 82: Return final text only
```

### 2. Parent Context Availability

**Question**: Can child sessions access parent messages?

**Answer**: Technically yes via `session.parentID`, but **not implemented**:

```typescript
// Current: prompt.ts:482-530
async function getMessages(input: { sessionID: string }) {
  let msgs = await MessageV2.stream(input.sessionID)
  // Only reads current session
}

// What's needed:
async function getMessages(input: { sessionID: string }) {
  const session = await Session.get(input.sessionID)
  
  // Include parent context if child session
  if (session.parentID) {
    const parentMsgs = await MessageV2.stream(session.parentID)
    msgs = [...parentMsgs, ...msgs]
  }
  
  let msgs = await MessageV2.stream(input.sessionID)
}
```

**File**: `packages/opencode/src/session/index.ts:283-294` shows children() lookup exists:

```typescript
export const children = fn(Identifier.schema("session"), async (parentID) => {
  const result = [] as Session.Info[]
  for (const item of await Storage.list(["session", project.id])) {
    const session = await Storage.read<Info>(item)
    if (session.parentID !== parentID) continue
    result.push(session)
  }
  return result
})
```

But this is only used for deletion cascading, not context sharing.

---

## Storage Layer

**File**: `packages/opencode/src/session/index.ts`

### Session Storage
```typescript
Storage.write(["session", projectID, sessionID], sessionInfo)
```

### Message Storage
```typescript
Storage.write(["message", sessionID, messageID], messageInfo)
```

### Part Storage
```typescript
Storage.write(["part", messageID, partID], partInfo)
```

**Key Observation**: Storage is hierarchical and supports reading across sessions. The infrastructure EXISTS to share context - it's just not wired up.

---

## What Would Enable Persistent Pair Programming?

### Option 1: Session Reuse (Simplest)

Instead of creating new child session every turn, reuse existing one:

```typescript
// In task.ts:execute()
const existingChild = await findChildSession({
  parentID: ctx.sessionID,
  agentName: agent.name,
  conversationKey: "BUILD-SUPERVISE-pairing"  // Shared key
})

const session = existingChild ?? await Session.create({
  parentID: ctx.sessionID,
  metadata: { conversationKey: "BUILD-SUPERVISE-pairing" }
})
```

**Pros**: Minimal changes, uses existing session system
**Cons**: Still isolated from parent context

### Option 2: Context Injection (Medium)

Inject parent + sibling session messages into child context:

```typescript
// In prompt.ts:getMessages()
async function getMessages(input: { sessionID: string }) {
  const session = await Session.get(input.sessionID)
  let msgs = await MessageV2.stream(input.sessionID)
  
  if (session.parentID && session.metadata?.includeParent) {
    const parentMsgs = await MessageV2.stream(session.parentID)
    const siblingMsgs = await getSiblingMessages(session.parentID, sessionID)
    msgs = [...parentMsgs, ...siblingMsgs, ...msgs]
  }
  
  return msgs
}
```

**Pros**: Full context visibility, no new storage
**Cons**: Token usage explodes, complex filtering needed

### Option 3: Shared Conversation Thread (Best)

Create a persistent "conversation thread" that multiple subagents contribute to:

```typescript
// New: packages/opencode/src/session/thread.ts
export namespace Thread {
  export function create(parentSessionID: string, participants: string[]) {
    // Creates shared thread storage
    // Both BUILD and SUPERVISE write to same thread
  }
  
  export function append(threadID: string, message: Message) {
    // Appends to shared history
  }
  
  export function getHistory(threadID: string) {
    // Returns full conversation between participants
  }
}
```

**Pros**: Purpose-built for pair programming, clean separation
**Cons**: New abstraction to maintain

---

## Recommendation

**Start with Option 1 (Session Reuse)** as a proof of concept:

1. Add session metadata field for conversation threading
2. Modify task.ts to reuse child sessions based on conversation key
3. Test with BUILD/SUPERVISE pair programming scenario
4. Measure token usage and iterate

**Then evolve to Option 3** for production use once proven valuable.

---

## Next Steps (Phase 2)

1. Add `metadata` field to Session.Info schema
2. Implement `findOrCreateChildSession()` helper
3. Modify task.ts to reuse sessions for same conversation
4. Add conversation management commands (`/reset-conversation`)
5. Test with multi-turn BUILD ↔ SUPERVISE interactions

---

## Code References

- Task tool: `packages/opencode/src/tool/task.ts:28-89`
- Session creation: `packages/opencode/src/session/index.ts:144-181`
- Message loading: `packages/opencode/src/session/prompt.ts:482-530`
- Agent registry: `packages/opencode/src/agent/agent.ts:95-170`
- Storage layer: `packages/opencode/src/storage/storage.ts`
