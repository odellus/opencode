# FOR HUMANS: How OpenCode Sessions Work

> Understanding conversations, state, and memory in OpenCode - explained like you're not a database architect.

---

## What's a Session?

A **session** is a conversation thread between you and an AI agent. Think of it like a chat room that persists.

**Real-world analogy**: Like a Slack thread or email chain - messages stack up over time, creating context and history.

---

## Session Anatomy

### The Data Structure

**File**: `packages/opencode/src/session/index.ts:45-77`

```typescript
{
  id: "session_2Bk4x9...",           // Unique identifier
  parentID: "session_1Ak3...",       // If this is a child session
  projectID: "proj_abc123",          // Which project it belongs to
  directory: "/home/user/my-app",    // Working directory
  title: "Implement auth feature",   // Human-readable name
  version: "1.0.65",                 // OpenCode version
  
  time: {
    created: 1699564800000,          // Timestamp
    updated: 1699565200000,
    compacting: undefined,           // When compaction started
  },
  
  share: {                           // If shared publicly
    url: "https://opencode.ai/s/abc"
  },
  
  revert: {                          // If you've reverted state
    messageID: "msg_xyz",
    snapshot: "snap_123",
  },
  
  summary: {                         // File changes summary
    additions: 45,
    deletions: 12,
    files: 3,
  }
}
```

### What's Stored Where

**Storage Structure**:
```
Storage Root
├── session/
│   └── {projectID}/
│       └── {sessionID}/
│           └── session.json        ← Session metadata
│
├── message/
│   └── {sessionID}/
│       └── {messageID}/
│           └── message.json        ← Message metadata (role, timestamp, cost)
│
└── part/
    └── {messageID}/
        └── {partID}/
            └── part.json           ← Message content (text, tool calls, files)
```

**Code**: `packages/opencode/src/session/index.ts:154-158`

---

## Session Hierarchy

### Parent and Child Sessions

```
Session 000 (Parent) - ARCHITECT agent
  ├─ "Implement authentication system"
  │
  ├─ Session 001 (Child) - SUPERVISE subagent
  │   └─ "Break down auth into tasks"
  │
  ├─ Session 002 (Child) - SUPERVISE subagent
  │   └─ "Review implementation"
  │
  └─ Session 003 (Child) - GENERAL subagent
      └─ "Research OAuth libraries"
```

**Parent → Child Link**: Each child has `parentID` pointing to its parent

**Why children exist**: When an agent uses the Task tool to delegate work, it spawns a child session.

**Code**: `packages/opencode/src/tool/task.ts:31-33`

```typescript
const session = await Session.create({
  parentID: ctx.sessionID,  // Links back to parent
  title: params.description + ` (@${agent.name} subagent)`,
})
```

---

## Messages: The Building Blocks

A session is made of **messages**. Each message has:

### Message Metadata

**File**: `packages/opencode/src/session/message-v2.ts:50-95`

```typescript
{
  id: "message_Xk4p...",
  sessionID: "session_2Bk...",
  parentID: "message_Wj3...",      // Previous message in conversation
  role: "user" | "assistant",      // Who sent it
  mode: "build",                   // Which agent (for assistant messages)
  
  cost: 0.0234,                    // $ cost for this message
  tokens: {
    input: 1500,
    output: 800,
    reasoning: 0,
    cache: { read: 2000, write: 500 }
  },
  
  modelID: "claude-3-5-sonnet-20241022",
  providerID: "anthropic",
  
  path: {
    cwd: "/home/user/project",
    root: "/home/user/project"
  },
  
  time: {
    created: 1699564800000
  },
  
  error: undefined  // If message failed
}
```

### Message Parts

Each message is broken into **parts**:

```typescript
{
  id: "part_abc123",
  messageID: "message_Xk4p...",
  sessionID: "session_2Bk...",
  type: "text" | "tool" | "file" | "reasoning",
  
  // For text parts:
  text: "Here's what I found...",
  
  // For tool parts:
  tool: "bash",
  state: {
    input: { command: "npm test" },
    result: { output: "All tests passed" }
  },
  
  // For file parts:
  filename: "auth.ts",
  mime: "text/typescript",
  url: "data:text/typescript;base64,..."
}
```

**Why parts?**: A single message might contain text + multiple tool calls + files. Parts let you stream and update them independently.

---

## How Messages Flow

### Turn 1: User → Assistant

```
You: "Add a login function"
  │
  ├─ Creates User Message
  │   └─ Part 1 (text): "Add a login function"
  │
  └─ Triggers Assistant Response
      │
      ├─ Creates Assistant Message
      │
      ├─ Part 1 (text): "I'll add a login function to auth.ts"
      ├─ Part 2 (tool): Read tool - reads auth.ts
      ├─ Part 3 (tool): Edit tool - modifies auth.ts
      └─ Part 4 (text): "Done! Added login() function"
```

**Code**: `packages/opencode/src/session/prompt.ts:196-450`

### Turn 2: Builds on Turn 1

```
You: "Now add logout"
  │
  └─ getMessages() loads ALL previous messages
      ├─ Turn 1 User: "Add a login function"
      ├─ Turn 1 Assistant: [login implementation]
      ├─ Turn 2 User: "Now add logout"  ← NEW
      └─ Turn 2 Assistant: [pending]
```

**Context is cumulative**: Each turn sees the entire conversation history (until compaction).

---

## The Message Loading Pipeline

**File**: `packages/opencode/src/session/prompt.ts:482-530`

```typescript
async function getMessages(input: { sessionID: string }) {
  // 1. Load all messages from this session
  let msgs = await MessageV2.stream(input.sessionID)
  
  // 2. Filter out compacted messages (replaced by summaries)
  msgs = await MessageV2.filterCompacted(msgs)
  
  // 3. Check if context overflowed
  const lastAssistant = msgs.findLast(m => m.info.role === "assistant")
  if (SessionCompaction.isOverflow(lastAssistant.info.tokens)) {
    // 4. Compact old messages into summary
    const summaryMsg = await SessionCompaction.run(...)
    msgs = [summaryMsg, resumeMsg]  // Replace history with summary
  }
  
  return msgs
}
```

**What's happening**:
1. Loads message history from storage
2. Filters out compacted (summarized) messages
3. Checks if we're hitting token limits
4. If so, summarizes old messages and starts fresh

**THE PROBLEM**: This only loads from `input.sessionID` - never looks at parent or sibling sessions!

---

## Session Lifecycle

### 1. Creation

**Code**: `packages/opencode/src/session/index.ts:144-181`

```typescript
Session.create({
  parentID: undefined,  // No parent = root session
  title: "New conversation"
})
```

**What happens**:
- Generates unique session ID
- Records project, directory, timestamp
- Publishes `Session.Event.Created`
- Auto-shares if configured
- Writes to storage

### 2. Message Exchange

```
while (conversation continues) {
  User sends message
    ├─ Creates user message
    ├─ Calls prompt()
    │   ├─ Loads message history
    │   ├─ Builds system prompt
    │   ├─ Calls LLM
    │   └─ Executes tool calls
    └─ Creates assistant message
}
```

### 3. Compaction (When History Gets Too Long)

**File**: `packages/opencode/src/session/compaction.ts`

```
History: [msg1, msg2, msg3, ..., msg50]
  │
  │ Token count exceeds limit
  │
  ├─ Sends old messages to LLM
  ├─ Asks: "Summarize this conversation"
  ├─ Gets: "User implemented auth, added tests, fixed bugs"
  │
  └─ Marks msg1-msg45 as compacted
  └─ Inserts summary message
  
New History: [summaryMsg, msg46, msg47, ..., msg50]
```

**Why**: LLMs have token limits. Compaction keeps conversations going indefinitely.

### 4. Forking

**Code**: `packages/opencode/src/session/index.ts:120-142`

```typescript
Session.fork({
  sessionID: "original_session",
  messageID: "msg_123"  // Fork from this point
})
```

Creates a copy of the session up to a specific message. Like branching in Git.

### 5. Deletion

**Code**: `packages/opencode/src/session/index.ts:296-320`

```typescript
Session.remove(sessionID)
```

**What happens**:
- Deletes all child sessions recursively
- Deletes all messages
- Deletes all message parts
- Removes from storage
- Publishes `Session.Event.Deleted`

---

## The Event Bus

Sessions publish events that other parts of OpenCode can listen to:

**File**: `packages/opencode/src/session/index.ts:87-118`

```typescript
Bus.subscribe(Session.Event.Created, (event) => {
  console.log("New session:", event.info.id)
})

Bus.subscribe(Session.Event.Updated, (event) => {
  console.log("Session updated:", event.info.id)
})

Bus.subscribe(Session.Event.Deleted, (event) => {
  console.log("Session deleted:", event.info.id)
})

Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
  console.log("Message part updated:", event.part)
})
```

**Why**: Decouples session logic from UI updates, logging, sync, etc.

---

## Child Sessions: The Delegation Problem

### Current Behavior (The Issue)

```
ARCHITECT Session (ID: 000)
  ├─ Message 1: "Implement auth"
  │
  ├─ Calls Task(SUPERVISE, "Break down auth tasks")
  │   └─ Creates Child Session 001
  │       └─ Message 1: "Break down auth tasks"
  │       └─ Message 2: [SUPERVISE's response]
  │       └─ Returns to parent: "Created 3 tasks"
  │
  ├─ Message 2: "Great! Now review the implementation"
  │
  └─ Calls Task(SUPERVISE, "Review implementation")
      └─ Creates NEW Child Session 002  ← PROBLEM!
          └─ Message 1: "Review implementation"
          └─ NO MEMORY of Session 001
          └─ Can't reference "the 3 tasks I created"
```

### What's Missing

**Child sessions don't see**:
- Parent session messages
- Sibling session messages
- Previous child session interactions

**Code proof**: `packages/opencode/src/session/prompt.ts:483`

```typescript
async function getMessages(input: { sessionID: string }) {
  let msgs = await MessageV2.stream(input.sessionID)
  // ^^^ Only loads from input.sessionID
  // Never checks session.parentID
  // Never loads sibling sessions
  return msgs
}
```

---

## What You're Building: Persistent Conversations

### Goal

```
ARCHITECT Session (ID: 000)
  │
  ├─ Calls Task(SUPERVISE, "Break down auth tasks")
  │   └─ Finds or Creates Thread "ARCHITECT↔SUPERVISE"
  │       └─ Session 001 (persistent thread)
  │           ├─ Turn 1: "Break down auth tasks"
  │           ├─ Turn 2: [SUPERVISE responds]
  │
  ├─ Calls Task(SUPERVISE, "Review implementation")
  │   └─ REUSES SAME Thread Session 001  ← FIX!
  │       ├─ Turn 1: "Break down auth tasks"
  │       ├─ Turn 2: [SUPERVISE responds]
  │       ├─ Turn 3: "Review implementation"  ← NEW
  │       └─ Turn 4: [SUPERVISE can reference Turn 1&2!]
```

### Implementation Strategy (Option 2: Context Injection)

**Modify**: `packages/opencode/src/session/prompt.ts:482-530`

```typescript
async function getMessages(input: { sessionID: string }) {
  const session = await Session.get(input.sessionID)
  let msgs = await MessageV2.stream(input.sessionID)
  
  // NEW: Inject parent and sibling context
  if (session.parentID) {
    const parentMsgs = await MessageV2.stream(session.parentID)
    const siblingMsgs = await getSiblingMessages(session.parentID, input.sessionID)
    
    // Combine: parent + siblings + current
    msgs = [...parentMsgs, ...siblingMsgs, ...msgs]
  }
  
  msgs = await MessageV2.filterCompacted(msgs)
  // ... rest of compaction logic
  return msgs
}

async function getSiblingMessages(parentID: string, excludeSessionID: string) {
  const children = await Session.children(parentID)
  const siblingMsgs = []
  
  for (const child of children) {
    if (child.id === excludeSessionID) continue
    const msgs = await MessageV2.stream(child.id)
    siblingMsgs.push(...msgs)
  }
  
  return siblingMsgs
}
```

**What this enables**:
- SUPERVISE sees what ARCHITECT asked before
- BUILD sees what SUPERVISE requested
- Agents can reference earlier turns: "As you mentioned earlier..."
- True pair programming conversations

---

## Key Files Reference

### Session Core
- **Session Management**: `packages/opencode/src/session/index.ts`
  - Session.create() (line 119)
  - Session.get() (line 183)
  - Session.children() (line 283)
  - Session.remove() (line 296)

### Message Handling
- **Message V2**: `packages/opencode/src/session/message-v2.ts`
  - Message schema (line 50-95)
  - Part types (line 120-250)
  - MessageV2.stream() - loads messages
  - MessageV2.toModelMessage() - converts for LLM

### Prompt Building
- **Session Prompt**: `packages/opencode/src/session/prompt.ts`
  - prompt() - main entry point (line 196)
  - getMessages() - loads history (line 482)
  - createProcessor() - handles streaming (line 1022)

### Compaction
- **Session Compaction**: `packages/opencode/src/session/compaction.ts`
  - run() - summarizes old messages
  - isOverflow() - checks token limits

### Storage
- **Storage Layer**: `packages/opencode/src/storage/storage.ts`
  - write() - persists data
  - read() - retrieves data
  - list() - iterates entries
  - update() - atomic updates

---

## Common Operations

### Create a New Session

```typescript
const session = await Session.create({
  title: "My conversation",
  parentID: undefined  // Root session
})
```

### Load Session History

```typescript
const messages = await Session.messages({
  sessionID: "session_abc",
  limit: 50  // Optional
})
```

### Send a Message

```typescript
await SessionPrompt.prompt({
  sessionID: "session_abc",
  messageID: Identifier.ascending("message"),
  agent: "build",
  parts: [
    {
      type: "text",
      text: "Add a login function"
    }
  ]
})
```

### Fork a Session

```typescript
const forked = await Session.fork({
  sessionID: "session_abc",
  messageID: "message_123"  // Fork from here
})
```

---

## Debugging Sessions

### Inspect Session State

```typescript
const session = await Session.get(sessionID)
console.log(session)
```

### Trace Message History

```typescript
for await (const msg of MessageV2.stream(sessionID)) {
  console.log(msg.info.role, msg.info.mode)
  for (const part of msg.parts) {
    console.log("  ", part.type, part.text ?? part.tool)
  }
}
```

### Find Child Sessions

```typescript
const children = await Session.children(parentSessionID)
console.log("Child sessions:", children.map(c => c.title))
```

### Check Token Usage

```typescript
const messages = await Session.messages({ sessionID })
const lastAssistant = messages.findLast(m => m.info.role === "assistant")
console.log("Tokens:", lastAssistant.info.tokens)
console.log("Cost: $" + lastAssistant.info.cost)
```

---

## FAQ

**Q: Where are sessions stored?**
A: In the storage layer, typically `~/.opencode/storage/` or project-local `.opencode/storage/`

**Q: Can I delete old sessions safely?**
A: Yes, via `Session.remove()`. It cascades to messages, parts, and children.

**Q: How long do sessions persist?**
A: Forever, unless manually deleted or compacted.

**Q: Can I export a session?**
A: Yes, via share feature. Creates public URL with read-only access.

**Q: What's the difference between compact and delete?**
A: Compact summarizes old messages to save tokens. Delete removes the session entirely.

**Q: Can sessions span multiple projects?**
A: No, each session belongs to one projectID.

**Q: How do I resume a session?**
A: Load it in the TUI - sessions persist automatically.

---

## The Mental Model

Think of sessions like **Google Docs**:

- **Document = Session** - Persistent container
- **Comments = Messages** - Stack up over time
- **Suggestions = Tool calls** - Proposed edits
- **Version history = Compaction** - Summaries of old edits
- **Shared link = Share feature** - Public read-only access
- **Copy document = Fork** - Branch off a new version

The difference: OpenCode sessions are conversational threads with an AI agent, not static documents.

The problem you're solving: When agents delegate to subagents (like adding comments in a shared doc), those subagents currently can't see the parent doc's content. You're fixing that.
