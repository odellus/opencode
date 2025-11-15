# Dual-Agent Pair Programming - Progress

## Phase 1: Foundation ✅ COMPLETE

**Status**: All tests passing (19/19), TypeScript compiles with no errors

### What's Built

1. **Conversation Storage** (`src/conversation/storage.ts`)
   - Neutral turn-based storage (no role assignment)
   - In-memory Map (will migrate to opencode Storage later)
   - Create, add, retrieve, clear conversations
   - ULID-based ID generation

2. **Turn Data Structures** (`src/conversation/turn.ts`)
   - `Turn.Info` - agent, timestamp, text, toolCalls
   - `Turn.ToolCall` - id, name, input, output, error
   - Zod schemas for validation

3. **Tool Call Renderer** (`src/conversation/renderer.ts`)
   - Converts tool calls → markdown format
   - Handles errors separately from outputs
   - Clean formatting for human readability

4. **Perspective Transformer** (`src/agent/perspective.ts`)
   - **Core innovation**: Role inversion
   - Agent sees their own turns as `role: "assistant"`
   - Agent sees other agent's turns as `role: "user"`
   - Returns simple `{role, content}` messages

### Test Coverage

```
✓ 19 tests passing
✓ 57 expect() calls
✓ 0 failures
```

**Storage tests**: create, add, retrieve, error handling
**Renderer tests**: text, tools, errors, edge cases  
**Perspective tests**: role inversion from both agent viewpoints

### Key Design Decisions

1. **Simple Message Format**: Using `{role: "user" | "assistant", content: string}` instead of complex AI SDK types
   - Easier to work with
   - Will convert to AI SDK format when needed in orchestrator

2. **In-Memory Storage**: Using Map for now
   - Fast iteration and testing
   - Easy to migrate to opencode Storage later

3. **Tool Calls as Markdown**: Rendering all tool calls as text
   - Avoids complex AI SDK type issues
   - Clean separation of concerns
   - Senior agent sees junior's work as readable narrative

## Next: Phase 2 - Agent Roles & Tools

### Plan

1. **Define Agent Roles** (`src/agent/roles.ts`)
   - Junior: full tool access, does the work
   - Senior: read-only tools, provides guidance
   - System prompts for each role

2. **Tool Registry** (`src/tool/registry.ts`)
   - Import tools from opencode package
   - Filter by agent permissions
   - Map to AI SDK tool format

3. **Tool Executor** (`src/tool/executor.ts`)
   - Execute tools with proper context
   - Capture results as Turn.ToolCall
   - Handle errors gracefully

### Deliverables

- [ ] System prompts for junior/senior
- [ ] Tool permission filtering
- [ ] Tool execution integration
- [ ] Tests for tool registry and execution

### Estimated Time

~2 hours

---

## Architecture Validation

The foundation proves the core concept works:

```typescript
// Example from tests
const turns = [
  {agent: "senior", text: "Let's add auth"},
  {agent: "junior", text: "On it", toolCalls: [...]},
  {agent: "senior", text: "Good, now add tests"}
]

// Junior's perspective
const juniorView = Perspective.transformForAgent(turns, "junior")
// [
//   {role: "user", content: "Let's add auth"},
//   {role: "assistant", content: "On it\n\n## Tools Used\n..."},
//   {role: "user", content: "Good, now add tests"}
// ]

// Senior's perspective  
const seniorView = Perspective.transformForAgent(turns, "senior")
// [
//   {role: "assistant", content: "Let's add auth"},
//   {role: "user", content: "On it\n\n## Tools Used\n..."},
//   {role: "assistant", content: "Good, now add tests"}
// ]
```

**Role inversion confirmed working!** ✅

---

## Package Info

```json
{
  "name": "@opencode-ai/pair-programming",
  "version": "0.1.0",
  "status": "Phase 1 Complete"
}
```

**Dependencies**:
- `ai` (Vercel AI SDK)
- `zod` (validation)
- `ulid` (IDs)
- `remeda` (utils)

**Dev Commands**:
```bash
bun test       # Run tests
bun typecheck  # Type checking
```
