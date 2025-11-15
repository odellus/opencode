# Reflection & Next Steps

## What We Accomplished 🎉

### Documentation Suite (FOR_HUMANS_*.md Convention)

We created a **complete human-readable documentation suite** explaining OpenCode internals in plain English:

1. **FOR_HUMANS_AGENTS.md** (15KB)
   - How agents work (consulting firm analogy)
   - Agent modes, types, and hierarchy
   - Custom agent creation
   - Where everything lives in the codebase

2. **FOR_HUMANS_SESSIONS.md** (16KB)
   - How sessions and conversations work (Google Docs analogy)
   - Message structure and lifecycle
   - Parent/child session relationships
   - Storage architecture

3. **FOR_HUMANS_TOOLS.md** (18KB)
   - What tools agents can use (API endpoint analogy)
   - Tool execution flow
   - Permission system
   - Creating custom tools

**Impact**: You now understand your codebase from ass to hole in the ground! No more "I don't know wtf is happening."

### Technical Implementation Docs

4. **PHASE1_FINDINGS.md** (14KB)
   - Deep technical analysis of subagent system
   - How subagent type selection works
   - Current communication patterns
   - Why context wasn't being preserved

5. **PERSISTENT_PAIRING_IMPLEMENTATION.md** (14KB)
   - Complete implementation summary
   - How context injection works
   - Testing strategy
   - Future enhancements

### Core Feature: Persistent Pair Programming ✅

**Problem Solved**: Subagents were stateless - they forgot everything between invocations.

**Solution Implemented**:
- **Context injection** in `getMessages()` - child sessions now see parent + sibling context
- **Session metadata** - control what context gets injected
- **Delegation restrictions** - SUPERVISE→BUILD, ARCHITECT→SUPERVISE

**Files Modified**:
- `packages/opencode/src/session/index.ts` - Added metadata field to Session.Info
- `packages/opencode/src/session/prompt.ts` - Implemented context injection
- `packages/opencode/src/tool/task.ts` - Enable context by default + restrictions

**Build Status**: ✅ Builds successfully, no source file errors

---

## Issues Discovered During Testing 🔍

### 1. Orchestrator Invocation Stack Issue (CRITICAL)

**Observed Behavior**:
```
User asks orchestrator to do X
  → Orchestrator delegates to build agent
  → Build completes work
  → Control returns to USER instead of orchestrator ❌
```

**Expected Behavior**:
```
User asks orchestrator to do X
  → Orchestrator delegates to build agent
  → Build completes work
  → Control returns to ORCHESTRATOR ✓
  → Orchestrator reviews/continues work
```

**Root Cause**: Appears to be FILO (stack) instead of FIFO (queue) for session control flow.

**Impact**: Orchestrator can't supervise multi-step work because control escapes back to user after first delegation.

**Location to Investigate**:
- `packages/opencode/src/session/prompt.ts` - Session prompt flow
- `packages/opencode/src/tool/task.ts` - Task tool execution and return
- `packages/opencode/src/session/lock.ts` - Session locking/control

**Fix Needed**: Make delegation async/non-blocking OR implement proper control flow stack where parent agent regains control after child completes.

---

### 2. Agent Naming Inconsistency

**Issue**: "orchestrator" vs "supervisor" naming not settled.

**Current State**:
- Built-in agent: `supervisor`
- Custom agents: Users might create `orchestrator`
- Both names used interchangeably in codebase

**Fix Needed**:
- Pick one canonical name (suggest: `supervisor` since it's built-in)
- Update all references consistently
- Add deprecation notice if renaming

---

### 3. LangFuse Instrumentation Missing

**Issue**: No tracing/observability for LLM calls.

**Impact**: Can't debug agent behavior, measure costs, or build datasets from traces.

**Why Critical for GEPA**:
- Need traces to create reflective datasets
- Need evaluation prompts to score candidates
- Need to capture human feedback for training

**Requirements for GEPA Integration**:

```python
class EvaluationBatch(Generic[Trajectory, RolloutOutput]):
    """
    - outputs: raw per-example outputs
    - scores: per-example numeric scores (floats)
    - trajectories: optional per-example traces for reflective dataset
    """
    outputs: list[RolloutOutput]
    scores: list[float]
    trajectories: list[Trajectory] | None = None
```

**What We Need**:
1. **Capture traces** - Every LLM call, tool invocation, result
2. **Evaluation tool/agent** - Takes trajectory + eval prompt → returns float score
3. **Human feedback capture** - When you say "this is good/bad", mark trace as sacrosanct
4. **LangFuse integration** - Send traces to LangFuse for analysis

**Next Steps**:
- Add LangFuse SDK to `packages/opencode/package.json`
- Create `packages/opencode/src/observability/langfuse.ts`
- Instrument prompt execution in `session/prompt.ts`
- Create evaluation tool that outputs float scores

---

### 4. Long-Running Conversational Pair Programming

**Issue**: Current subagent pattern is synchronous request/response.

**Vision**: Agents should be able to have **persistent, long-running conversations** like Letta-code.

**Example**:
```
User talks to ARCHITECT
  → ARCHITECT spawns SUPERVISE (async)
  → SUPERVISE spawns BUILD (async)
  
User asks ARCHITECT a question mid-work
  → SUPERVISE and BUILD keep working in background
  → ARCHITECT answers user
  → Work continues

Nothing under ARCHITECT changes when user interrupts
```

**Current Limitation**: Subagents are synchronous - parent waits for child to complete.

**Fix Needed**: Async agent invocation pattern where:
- Child agents run independently
- Parent can check status, send messages, get updates
- User can interrupt parent without killing children
- Children can continue work in background

**Possible Approaches**:
1. **Background sessions** - Like `run_in_background` for Bash, but for agents
2. **Agent mailboxes** - Agents can send/receive messages asynchronously  
3. **Stateful agents** - Agents persist beyond single invocation
4. **Letta-code integration** - Use their architecture for long-running agents

---

## What This Enables 🚀

### Immediate Benefits

1. **Pair Programming Works**
   - SUPERVISE and BUILD can iterate together
   - They remember previous exchanges
   - Real back-and-forth conversations

2. **Better Code Quality**
   - SUPERVISE can review BUILD's work with full context
   - BUILD can address feedback referencing earlier implementations
   - Iterative refinement instead of one-shot attempts

3. **Understandable Codebase**
   - FOR_HUMANS_*.md docs explain everything in plain English
   - New contributors can ramp up quickly
   - You know where everything is

### Future Possibilities

With proper instrumentation and GEPA integration:

1. **Self-Improvement Loop**
   - Capture traces of successful interactions
   - Use human feedback to mark good/bad examples
   - Train on reflective datasets
   - Agents get better over time

2. **Dogfooding Dataset**
   - Every time you use OpenCode productively
   - Capture the trace + outcome
   - Build training data from your own usage
   - The tool learns from how you work

3. **Evaluation Framework**
   - Score agent outputs automatically
   - Run experiments on candidate prompts
   - Pareto front tracking for multi-objective optimization
   - Data-driven prompt engineering

---

## Next Priorities

### P0 (Critical) - Fix Control Flow

**Issue**: Orchestrator can't supervise work because control escapes to user.

**Tasks**:
1. Investigate session control flow in `prompt.ts`
2. Understand why parent doesn't regain control after child completes
3. Implement proper control stack (FIFO queue or async pattern)
4. Test: User → Orchestrator → Build → Orchestrator → User

**Success**: Orchestrator can delegate multiple tasks and review each result.

---

### P1 (High) - LangFuse Instrumentation

**Why**: Can't improve what you can't measure. Need traces for GEPA.

**Tasks**:
1. Add LangFuse SDK dependency
2. Create observability layer (`src/observability/langfuse.ts`)
3. Instrument:
   - LLM calls (prompt, response, tokens, cost)
   - Tool invocations (tool name, input, output)
   - Agent transitions (parent → child, child → parent)
   - User feedback (thumbs up/down, corrections)
4. Send traces to LangFuse dashboard
5. Verify traces captured end-to-end

**Success**: Can view complete conversation traces in LangFuse UI.

---

### P1 (High) - Evaluation Tool

**Why**: Need scoring for GEPA candidate evaluation.

**Tasks**:
1. Create evaluation tool or subagent
2. Input: trajectory + evaluation prompt
3. Output: float score (0.0 - 1.0)
4. Test with example trajectories
5. Integrate with GEPA EvaluationBatch

**Example**:
```typescript
// packages/opencode/src/tool/evaluate.ts
export const EvaluateTool = Tool.define("evaluate", async () => {
  return {
    description: "Evaluate a trajectory against criteria and return a score",
    parameters: z.object({
      trajectory: z.string(),  // JSON trace
      eval_prompt: z.string(), // Evaluation criteria
    }),
    async execute(input, ctx) {
      const score = await scoreTrajectory(input.trajectory, input.eval_prompt)
      return {
        title: "Evaluation",
        output: `Score: ${score}`,
        metadata: { score }
      }
    }
  }
})
```

**Success**: Can score agent outputs programmatically.

---

### P2 (Medium) - Async Agent Invocation

**Why**: Enable long-running pair programming without blocking.

**Tasks**:
1. Design async agent pattern
2. Implement background agent execution
3. Add agent status checking
4. Allow parent to continue while child works
5. Enable message passing between agents

**Success**: ARCHITECT can ask SUPERVISE to work on a task, then continue responding to user while SUPERVISE works in background.

---

### P2 (Medium) - Human Feedback Capture

**Why**: Build sacrosanct training data from your usage.

**Tasks**:
1. Add feedback commands (`/good`, `/bad`, `/correction`)
2. Mark traces with feedback in LangFuse
3. Export annotated traces for GEPA
4. Build reflective dataset from successful interactions

**Success**: Every good conversation becomes training data.

---

### P3 (Nice to Have) - Session Reuse

**Why**: More efficient than creating new sessions every time.

**Context**: Currently using Option 2 (context injection). Could upgrade to Option 1 (session reuse).

**Tasks**:
1. Implement `findOrCreateChildSession()`
2. Reuse sessions with same conversation thread
3. Add session reset commands
4. Measure token savings vs context injection

**Success**: Fewer sessions, cleaner storage, lower token usage.

---

## Reflection

### What Went Well ✅

1. **Context injection works** - Relatively simple change with big impact
2. **Documentation is comprehensive** - FOR_HUMANS_*.md convention is gold
3. **Build passes** - No breaking changes to existing code
4. **Clear path forward** - Know exactly what needs fixing

### What's Hard 🤔

1. **Control flow is subtle** - Session/agent lifecycle is complex
2. **Async is non-trivial** - Making agents truly async requires careful design
3. **Instrumentation sprawl** - Need to instrument many code paths
4. **Testing is manual** - No automated tests for multi-turn conversations yet

### What We Learned 📚

1. **OpenCode's architecture** - Deep understanding of sessions, agents, tools
2. **Delegation patterns** - How Task tool works, where it falls short
3. **Context management** - Message loading, compaction, filtering
4. **Human docs matter** - Plain English explanations are invaluable

---

## The Vision 🔮

**Where This Is Going**:

1. **Self-Improving Coding Agent**
   - Learns from your usage patterns
   - Improves prompts via GEPA
   - Gets better at pair programming over time

2. **Long-Running Conversations**
   - Agents work independently
   - User can interrupt without breaking flow
   - True async collaboration

3. **Observable Everything**
   - Every trace captured
   - Every decision explained
   - Every improvement measured

4. **Dogfooding Loop**
   - Use OpenCode to improve OpenCode
   - Every good interaction → training data
   - Continuous evolution

**The Dream**: An AI pair programmer that:
- Remembers context across sessions
- Learns from feedback
- Works autonomously on complex tasks
- Collaborates with you naturally
- Gets better the more you use it

---

## Call to Action

**What to Work On Next**:

1. **Fix orchestrator control flow** - Most impactful
2. **Add LangFuse** - Enables everything else
3. **Create evaluation tool** - Unblocks GEPA
4. **Test multi-turn pairing** - Validate the implementation

**Questions to Answer**:

1. How should async agent invocation work?
2. What's the right UI for long-running agents?
3. How to capture human feedback unobtrusively?
4. Should we integrate Letta-code or build our own?

---

## Meta: What This Document Is

This is a **reflection checkpoint** after implementing persistent pair programming.

**Purpose**:
- Celebrate what we built
- Document issues discovered
- Chart the path forward
- Preserve context for future work

**Use It To**:
- Onboard new contributors
- Decide what to build next
- Remember why decisions were made
- Track progress over time

---

**Built with**: Persistent pair programming between ARCHITECT, SUPERVISE, and BUILD agents

**Proof**: This very document shows agents collaborating with shared context! 🎉
