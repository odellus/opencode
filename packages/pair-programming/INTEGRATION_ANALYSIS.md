# Dual-Agent Integration into OpenCode - Analysis

## Current OpenCode Architecture

### Session Flow
```
User/TUI → Server → SessionPrompt.prompt()
                        ↓
                   Agent.get(agentName)
                        ↓
                   Provider.getModel()
                        ↓
                   streamText() with tools
                        ↓
                   MessageV2 storage
```

### Key Components

1. **Session.create()** - Creates session with parentID support
2. **SessionPrompt.prompt()** - Main orchestration function
   - Takes: sessionID, agent name, parts (text/files)
   - Returns: MessageV2.WithParts
   - Handles: agent selection, model resolution, tool execution, streaming

3. **Agent System**
   - `mode: "primary"` - User-selectable agents (build, plan, etc.)
   - `mode: "subagent"` - Only callable via Task tool (supervise, architect)
   - `mode: "all"` - Both
   
4. **Task Tool** - Delegates to subagents
   - Creates child session with parentID
   - Enforces delegation rules (architect→supervise, supervise→build)
   - Uses `metadata: { includeParentContext: true, includeSiblingContext: true }`

## Dual-Agent System (What We Built)

### Architecture
```
DualSession.run()
   ↓
Instance.provide()
   ↓
Loop: turnCount < maxTurns
   ├─> Perspective.transformForAgent() // Role inversion
   ├─> ToolRegistry.tools()
   ├─> streamText()
   └─> Store in Turn (not MessageV2)
```

### Key Differences

| Aspect | OpenCode | Dual-Agent |
|--------|----------|------------|
| Storage | MessageV2 + Session | Turn + Conversation |
| Message roles | user/assistant (standard) | Role-inverted per agent |
| Turn management | Single agent per session | Alternating agents |
| Context | Session-based | Conversation-based |
| Agent selection | User chooses or Task delegates | Automatic alternation |

## Integration Options

### Option 1: Separate Package (Current)
**Status**: ✅ Working

**Pros**:
- No risk of breaking OpenCode
- Independent development
- Clean separation of concerns

**Cons**:
- Doesn't integrate with TUI
- Users can't access from main OpenCode
- Duplicates storage concepts

**What breaks**: Nothing

---

### Option 2: New Agent Mode `mode: "dual"`
**Concept**: Add dual-agent as a special agent type

```typescript
// In Agent.Info
mode: z.union([
  z.literal("primary"), 
  z.literal("subagent"), 
  z.literal("all"),
  z.literal("dual")  // NEW
])
```

**Implementation**:
```typescript
// In SessionPrompt.prompt()
const agent = await Agent.get(input.agent)

if (agent.mode === "dual") {
  // Use DualSession.run() instead of normal streamText
  return await DualSession.prompt({
    sessionID: input.sessionID,
    ...
  })
}

// Normal flow for other agents
```

**Pros**:
- Integrates with existing Agent system
- Can be selected from TUI
- Uses existing Session storage

**Cons**:
- Need to convert Turn → MessageV2
- Role inversion complicates MessageV2 structure
- Alternating agents doesn't map to Session model

**What breaks**:
- MessageV2 assumes single agent per message
- Session.prompt expects one response, not alternating
- TUI expects linear conversation (user → assistant → user)

**Difficulty**: HIGH - fundamentally different conversation model

---

### Option 3: New Tool `DualPair`
**Concept**: Make dual-agent a tool like Task

```typescript
export const DualPairTool = Tool.define("dualpair", {
  description: "Start a pair programming session with two agents",
  parameters: z.object({
    task: z.string(),
    maxTurns: z.number().default(10),
  }),
  async execute(params, ctx) {
    // Run DualSession
    const result = await DualSession.run({
      conversationId: generateId(),
      initialPrompt: params.task,
      maxTurns: params.maxTurns,
      workingDirectory: Instance.directory,
      model: await getModel(),
    })
    
    // Return transcript as tool output
    return {
      title: "Pair programming complete",
      output: formatTranscript(result.turns),
      metadata: { turns: result.turns }
    }
  }
})
```

**Pros**:
- Minimal changes to OpenCode
- Any agent can invoke pair programming
- Clean encapsulation

**Cons**:
- No visibility into progress (runs in background)
- Can't interrupt or steer
- Tool output might be huge

**What breaks**: Nothing (pure addition)

**Difficulty**: LOW

---

### Option 4: Server API Extension
**Concept**: Add new endpoints alongside existing /sessions

```typescript
// New endpoints
POST /dual-sessions
GET /dual-sessions/:id
GET /dual-sessions/:id/transcript
POST /dual-sessions/:id/stop
```

**Implementation**:
```typescript
app.post("/dual-sessions", async (c) => {
  const { task, maxTurns } = c.req.valid("json")
  
  const id = generateId()
  
  // Run in background
  DualSession.run({
    conversationId: id,
    initialPrompt: task,
    maxTurns,
    workingDirectory: getWorkingDir(c),
    model: getModel(c),
  })
  
  return c.json({ id })
})

app.get("/dual-sessions/:id", async (c) => {
  const turns = Conversation.getTurns(c.req.param("id"))
  
  return c.json({
    turns: turns.map(t => ({
      agent: t.agent, // "junior" or "senior" (NOT user/assistant)
      text: t.text,
      toolCalls: t.toolCalls,
      timestamp: t.timestamp
    }))
  })
})
```

**Pros**:
- Separate API surface
- Can build dedicated UI
- Doesn't interfere with existing sessions
- Shows `build`/`supervise` roles (not user/assistant)

**Cons**:
- No TUI integration
- Separate from main workflow

**What breaks**: Nothing (pure addition)

**Difficulty**: LOW

---

### Option 5: Hybrid - Tool + API
**Concept**: Combine Option 3 + 4

**Flow**:
1. User invokes `dualpair` tool from any agent
2. Tool starts DualSession and returns session ID
3. User can monitor via API `/dual-sessions/:id`
4. Tool waits and returns final transcript

**Pros**:
- Best of both worlds
- Discoverable from main interface
- Monitorable via API
- Doesn't break anything

**Cons**:
- More complex
- Need background job management

**Difficulty**: MEDIUM

---

## Recommendation

**Start with Option 4: Server API Extension**

### Why?
1. **Zero risk** - Pure addition, breaks nothing
2. **Clean separation** - Dual-agent is fundamentally different from single-agent sessions
3. **Proper roles** - Can show `build`/`supervise` instead of user/assistant
4. **Tool call rendering** - Can render as markdown in API response (for humans)
5. **Foundation for UI** - Can build dedicated pair-programming view later

### Implementation Steps

1. Add `/dual-sessions` endpoints to server
2. Return transcript with proper role labels
3. Render tool calls as markdown in API
4. Document API

Later can add Option 3 (Tool) for discoverability.

## What Breaks with Each Option

| Option | Breaks OpenCode? | Risk Level |
|--------|------------------|------------|
| 1. Separate Package | ❌ No | None |
| 2. Agent Mode | ⚠️ Maybe | High |
| 3. Tool | ❌ No | None |
| 4. API | ❌ No | None |
| 5. Hybrid | ❌ No | Low |

## Next Steps

1. Implement Option 4 (API endpoints)
2. Test with real dual-agent sessions
3. Add Option 3 (Tool) for discoverability
4. Consider dedicated TUI view later

This gives us working integration without touching OpenCode's core session logic.
