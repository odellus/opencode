# Orchestrator Real Integration Plan

**Status**: Ready to implement
**Goal**: Move from scaffolding to real end-to-end agent supervision with actual LLM

## Current Status (Honest Assessment)

### ✓ What Works
- Bus event coordination
- Anti-pattern detection logic
- Message creation in doer session
- Parent-child session relationship
- Orchestrator can send feedback messages
- 6 tests passing (all unit tests with simulated data)

### ✗ What Doesn't Work Yet
- Real doer agent with LLM
- Doer responding to orchestrator feedback
- Detecting REAL anti-patterns from REAL tool calls
- Integration with `opencode serve`
- End-to-end with actual file changes

## The Plan

### Phase 1: Real LLM Integration (Current Phase)

**Goal**: Get doer agent using actual LLM to execute real work

**Steps**:

1. **Use OpenCode's free provider** ✓
   - Provider: `opencode` (built-in free models)
   - Models available with `cost.input === 0`
   - No API key needed for free models

2. **Create real demo script** that:
   ```typescript
   // Give doer actual task with LLM enabled
   await SessionPrompt.prompt({
     sessionID: doerSessionID,
     agent: "build", // Use actual build agent
     // Let it use default free model from opencode provider
     parts: [{
       type: "text",
       text: "Create 3 test files. Use TodoWrite to create todos."
     }]
     // NO noReply: true - let LLM actually respond!
   })
   ```

3. **Monitor TodoWrite tool calls**:
   - Subscribe to tool execution events
   - Detect when doer calls TodoWrite
   - Watch for multiple in-progress anti-pattern

4. **Orchestrator intervenes in real-time**:
   - Feedback message appears in doer's session
   - Next LLM response sees orchestrator feedback
   - Doer adjusts behavior

**Success Criteria**:
- Doer creates todos via TodoWrite tool (not manual Todo.update)
- Orchestrator detects via Bus events
- Orchestrator sends feedback
- Doer's next LLM call sees feedback in context
- Doer responds to feedback (either compliance or explanation)

### Phase 2: Anti-Pattern Library

**Additional Detectors to Implement**:

1. **Stuck Task** - Task in_progress > 5 minutes
2. **Mock Cascade** - Too many `.mock.ts` files created
3. **Infinite Loop** - Same tool call repeated 3+ times
4. **Reward Hacking** - Claims "done" without file changes
5. **Analysis Paralysis** - Too many pending tasks (>5)

### Phase 3: Role Inversion for Review

When doer claims done:
1. Check file status via Snapshot API
2. If no changes detected → reward hacking
3. Convert doer's assistant messages to user messages
4. Force critical review instead of cooperation
5. Use markdown intermediary for structured critique

### Phase 4: Production Integration

1. **Agent type**: Create `orchestrator` agent in `.opencode/agent/`
2. **Tool restrictions**: Read-only bash, no code writing
3. **HTTP API**: Expose via `/session/:id/supervise` endpoint
4. **TUI Dashboard**: Show orchestrator status
5. **Manual intervention**: Allow user override

## Implementation Order

### Next: Build Real Demo (This Session)

**File**: `packages/opencode/src/orchestrator/llm-demo.ts`

**Flow**:
```
1. Create orchestrator + doer sessions
2. Start supervision (Bus events)
3. Give doer task with actual LLM
4. Doer executes → uses TodoWrite tool
5. Orchestrator detects anti-pattern
6. Orchestrator sends feedback
7. Doer continues → sees feedback in context
8. Verify doer responded/adjusted
```

**Key Code**:
```typescript
// Let doer use real LLM
const result = await SessionPrompt.prompt({
  sessionID: doerSessionID,
  agent: "build",
  parts: [{
    type: "text",
    text: "Create 3 test files: hello.txt, world.txt, foo.txt. " +
          "Use TodoWrite to track your progress."
  }]
  // No noReply - let it execute!
})

// Monitor tool calls
Bus.subscribe(Tool.Event.Executed, (event) => {
  if (event.properties.tool === "TodoWrite") {
    // Check the todos created
  }
})
```

## Testing Strategy

### Unit Tests (Current)
- Bus events work
- Detection logic works
- Message creation works

### Integration Tests (Need to Build)
- Real LLM executes
- Real tool calls happen
- Real anti-patterns detected
- Real feedback processed

### End-to-End Test
```
Given: Doer with task "Create many files quickly"
When: Doer uses TodoWrite with multiple in_progress
Then: Orchestrator detects and sends feedback
And: Doer's next response acknowledges feedback
```

## Risks & Mitigations

**Risk 1**: Free model may be slow/unreliable
- **Mitigation**: Add timeouts, fallback to simulated behavior

**Risk 2**: Doer ignores feedback
- **Mitigation**: Track compliance rate, escalate to stronger intervention

**Risk 3**: Infinite feedback loops
- **Mitigation**: Max 3 feedback messages per anti-pattern type

**Risk 4**: Performance overhead
- **Mitigation**: Rate limit detections, batch feedback

## Success Metrics

1. **Detection Accuracy**: >90% of real anti-patterns caught
2. **False Positive Rate**: <10%
3. **Doer Compliance**: >70% of feedback acknowledged
4. **Latency**: <500ms from anti-pattern → feedback sent

## Timeline

- **Phase 1** (Real LLM): This session (~1 hour)
- **Phase 2** (Anti-patterns): Next session (~2 hours)
- **Phase 3** (Role inversion): Future session (~3 hours)
- **Phase 4** (Production): Future session (~5 hours)

## Next Steps

1. Build `llm-demo.ts` with real LLM integration
2. Run and verify end-to-end flow
3. Document what actually works vs what still needs work
4. Iterate based on findings

Let's build the real thing.
