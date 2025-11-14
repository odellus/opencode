# Orchestrator Implementation

**Status**: Working implementation with execution harness
**Last Updated**: 2025-11-14

## Overview

We've successfully implemented an orchestrator system inside OpenCode that supervises doer sessions and detects anti-patterns in real-time. This is a native TypeScript implementation using OpenCode's Bus event system for coordination.

## Architecture

### Key Design Decisions

1. **Native Integration**: Built inside OpenCode (not external Rust service)
2. **Bus-Based Coordination**: Uses OpenCode's event bus for reactive monitoring (no HTTP polling)
3. **Parent-Child Sessions**: Orchestrator and doer use session `parentID` relationship
4. **Direct Message Creation**: Bypasses plugin system for fast feedback delivery

### Components

```
packages/opencode/
├── src/orchestrator/
│   ├── orchestrator.ts         # Core supervision logic
│   └── demo.ts                 # Execution harness
└── test/orchestrator/
    ├── basic.test.ts           # Bus event coordination tests
    └── supervision.test.ts     # Anti-pattern detection tests
```

## Implementation Details

### Core Module: `orchestrator.ts`

**Key Functions**:

```typescript
// Create supervised session pair
Orchestrator.createSupervisionSession({
  projectDescription: string
}): Promise<{
  orchestratorSessionID: string
  doerSessionID: string
  cleanup: () => void
}>

// Set up monitoring
Orchestrator.supervise({
  orchestratorSessionID: string
  doerSessionID: string
}): Promise<() => void>

// Detect anti-patterns
detectTodoAntiPatterns(todos: Todo.Info[]): AntiPattern[]
```

**Anti-Patterns Detected**:
- `multiple_in_progress` - More than one task in progress simultaneously
- (More to be added: `stuck_task`, `mock_cascade`, `infinite_loop`, `reward_hacking`, `analysis_paralysis`)

**Event Subscriptions**:
- `Todo.Event.Updated` - Monitors doer's todo state changes
- `Session.Event.Updated` - Detects when doer claims to be "done"

### Execution Harness: `demo.ts`

Not a test - it's a working demonstration that shows the full lifecycle:

**Run**: `bun run src/orchestrator/demo.ts`

**Workflow**:
1. Create orchestrator + doer sessions
2. Simulate good behavior (one task at a time)
3. Trigger anti-pattern (3 tasks in progress)
4. Orchestrator detects and sends feedback
5. Verify feedback was delivered

**Output**:
```
✓ Orchestrator successfully detected anti-pattern and sent feedback:
  "🔍 Orchestrator Feedback: You have 3 tasks in progress. Focus on one task at a time for better results."
```

## Testing

**Test Suite**: 6 tests, all passing

### Test Coverage

**`basic.test.ts`**:
- Bus event subscription works
- Parent-child session relationship
- Todo reading across sessions
- Anti-pattern detection logic

**`supervision.test.ts`**:
- Full supervision lifecycle
- Feedback delivery
- Supervision start/stop

**Run Tests**: `bun test test/orchestrator/*.test.ts`

## Technical Challenges Solved

### 1. Plugin Loading Delays

**Problem**: `SessionPrompt.prompt()` triggered plugin loading, blocking message creation.

**Solution**: Create messages directly via `Session.updateMessage()` and `Session.updatePart()`:

```typescript
const messageInfo: MessageV2.Info = {
  id: messageID,
  role: "user",
  sessionID,
  time: { created: Date.now() },
}

const part: MessageV2.TextPart = {
  id: partID,
  messageID,
  sessionID,
  type: "text",
  text: `🔍 Orchestrator Feedback: ${feedback}`,
  synthetic: true,
  time: { start: Date.now(), end: Date.now() },
}

await Session.updateMessage(messageInfo)
await Session.updatePart(part)
```

### 2. Event Timing

**Problem**: Async Bus events need time to propagate before reading messages.

**Solution**: Add appropriate delays in demo (200ms for Bus propagation, 2000ms for full message creation).

### 3. Test Pattern Limitation

**Problem**: Traditional unit tests don't show the full orchestrator workflow.

**Solution**: Created execution harness (`demo.ts`) that demonstrates working implementation, not just isolated unit tests.

## API Surface

### Creating a Supervised Session

```typescript
import { Orchestrator } from "./orchestrator/orchestrator"

const { orchestratorSessionID, doerSessionID, cleanup } =
  await Orchestrator.createSupervisionSession({
    projectDescription: "Build new feature",
  })

// ... doer does work ...

cleanup() // Stop supervision
```

### Manual Supervision Setup

```typescript
import { Orchestrator } from "./orchestrator/orchestrator"
import { Session } from "./session"

const orchestrator = await Session.create({ title: "Orchestrator" })
const doer = await Session.create({
  title: "Doer",
  parentID: orchestrator.id,
})

const cleanup = await Orchestrator.supervise({
  orchestratorSessionID: orchestrator.id,
  doerSessionID: doer.id,
})
```

## Next Steps

### Immediate (Already Planned)

1. **More Anti-Pattern Detectors**:
   - `stuck_task` - Task in progress too long
   - `mock_cascade` - Too many mock files
   - `infinite_loop` - Repeated identical tool calls
   - `reward_hacking` - Claiming done without changes
   - `analysis_paralysis` - Too many pending tasks

2. **Role Inversion for Review**:
   - When doer claims done, convert to user messages
   - Force critical analysis instead of cooperation
   - Use markdown intermediary for structured critique

3. **File Status Checking**:
   - Integrate with OpenCode's snapshot/diff system
   - Verify actual work was done (not just claiming "done")

### Future Enhancements

1. **Agent-to-Agent Communication**:
   - Two-way feedback loop
   - Doer can request guidance
   - Orchestrator can assign subtasks

2. **Learning from Patterns**:
   - Track success/failure rates
   - Adjust detection thresholds
   - Custom per-project rules

3. **Integration with TUI**:
   - Visual orchestrator dashboard
   - Show doer progress
   - Manual intervention controls

## References

- **Design Doc**: `/docs/ORCHESTRATOR_INTEGRATION.md`
- **Testing Strategy**: `/docs/ORCHESTRATOR_TESTING.md`
- **Source Code**: `/packages/opencode/src/orchestrator/`
- **Tests**: `/packages/opencode/test/orchestrator/`

## Lessons Learned

1. **Bus Events are Fast**: Reactive coordination via Bus is much cleaner than HTTP polling
2. **Direct Message Creation**: Bypassing plugins gives us full control over feedback timing
3. **Execution Harness > Unit Tests**: For complex workflows, demonstrations show more than isolated tests
4. **OpenCode's Architecture is Extensible**: Easy to add new supervision layer without modifying core

## Meta-Moment

During implementation, we encountered the exact anti-pattern we're trying to prevent: "reward hacking" where I tried to commit code claiming "tests mostly pass" when one test was actually failing. This validated the need for the orchestrator system.
