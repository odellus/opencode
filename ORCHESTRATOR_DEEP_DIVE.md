# Orchestrator Deep Dive: Agent-Subagent Interaction

## Core Discovery: The Task Tool Flow

### What Happens When Parent Calls Task Tool

```typescript
// Parent agent (orchestrator) calls:
Task(
  description: "Create user schema",
  prompt: "Create TypeScript interface for User with id, name, email fields",
  subagent_type: "build"
)
```

**Behind the scenes:**

1. **Child session created:**
```typescript
const session = await Session.create({
  parentID: ctx.sessionID,  // Links to orchestrator's session
  title: "Create user schema (@build subagent)",
})
```

2. **Subagent executes in child session:**
```typescript
const result = await SessionPrompt.prompt({
  sessionID: session.id,      // Child session
  agent: "build",             // Subagent type
  tools: {
    todowrite: false,         // Can't manage parent's todos
    todoread: false,
    task: false,              // Can't spawn sub-subagents
    ...agent.tools,           // All other tools available
  },
  parts: promptParts,
})
```

3. **Task tool returns to parent:**
```typescript
return {
  title: "Create user schema",
  metadata: {
    summary: allToolCalls,    // Array of all tool calls made
    sessionId: session.id,    // Child session ID for inspection
  },
  output: lastTextResponse,   // Just the final text from subagent
}
```

### What the Parent Orchestrator Sees

**In the tool response:**
- ✅ Final text output from subagent ("I created the user schema in src/types/user.ts")
- ✅ List of ALL tool calls the subagent made (Write, Edit, Bash, etc.)
- ✅ Child session ID for deeper inspection

**What it DOESN'T automatically see:**
- ❌ Full conversation in child session
- ❌ Detailed file contents that were created
- ❌ Test results or error messages
- ❌ Whether the subagent actually succeeded

**This is the gap we need to fill!**

## Senior Dev Review Pattern

### Current Problem
Orchestrator gets:
```
Subagent: "Done! I created the user schema."
```

Orchestrator blindly trusts it and moves on. **This is junior dev behavior.**

### What a Senior Dev Does

```
Junior: "Done! I created the user schema."

Senior: 
1. "Show me the file" (Read tool)
2. "Did you add the fields I asked for?" (grep/check)
3. "Did tests pass?" (check metadata for test results)
4. "Is there error handling?" (review code quality)
5. Decision:
   - ✓ APPROVED: Looks good, merge it
   - ↻ ITERATE: "Add validation for email format"
   - ✗ REDO: "This doesn't match requirements, try again"
```

## How Orchestrator Can Review Work

### Access Pattern 1: Use Metadata
```typescript
// Task tool returns:
metadata: {
  summary: [
    { tool: "Write", input: { file_path: "src/types/user.ts", ... } },
    { tool: "Bash", input: { command: "npm test" }, output: "All tests pass" },
  ],
  sessionId: "ses_child123"
}
```

**Orchestrator can:**
- Loop through summary to see what was done
- Check if expected tools were used
- Look for test results in Bash outputs

### Access Pattern 2: Inspect Child Session
```typescript
// Orchestrator has the child session ID
// It can read the full conversation:

const messages = await Session.messages({ sessionID: childSessionId })
const fileChanges = await File.status()  // See what changed
```

**But simpler to use tools directly:**

### Access Pattern 3: Direct Verification (Recommended)
```typescript
// After Task tool returns, orchestrator uses its own tools:

1. Read(file_path: "src/types/user.ts")
   → See actual file contents
   
2. Grep(pattern: "interface User", path: "src/types")
   → Verify interface exists
   
3. Bash(command: "npm test")
   → Run tests to verify
   
4. Compare to requirements
   → Check if all fields present
```

## Orchestrator Iteration Workflow

### Single-Pass (Current)
```
Orchestrator: "Create user schema"
  ↓ [Task tool]
Build agent: "Done!"
  ↓
Orchestrator: "✓ Task complete" (blind trust)
```

### Review-and-Iterate (Proposed)
```
Orchestrator: "Create user schema with id, name, email, createdAt"
  ↓ [Task tool]
Build agent: "Created src/types/user.ts"
  ↓
Orchestrator: [Review phase]
  → Read("src/types/user.ts")
  → Check: has id? ✓
  → Check: has name? ✓
  → Check: has email? ✓
  → Check: has createdAt? ✗ MISSING
  ↓
Orchestrator Decision: ITERATE
  ↓ [Task tool with feedback]
Build agent: "Add createdAt to User interface"
  ↓
Build agent: "Added createdAt field"
  ↓
Orchestrator: [Review again]
  → Read("src/types/user.ts")
  → All fields present? ✓
  ↓
Orchestrator: "✓ Task approved, moving to next"
```

## Implementation: Orchestrator Prompt Pattern

```
You are an orchestrator - a senior developer managing a junior developer (the build agent).

WORKFLOW FOR EACH TASK:

1. DELEGATE
   Use Task tool to give clear instructions to build agent
   
2. REVIEW (DO NOT SKIP THIS)
   After Task returns, verify the work:
   - Use Read tool to see files created/modified
   - Use Grep to verify key changes
   - Use Bash to run tests if applicable
   - Check if ALL requirements met
   
3. DECIDE
   a) APPROVED: Requirements met, move to next task
      → Mark todo as complete
      → Start next task
      
   b) ITERATE: Close but needs fixes
      → Use Task tool AGAIN with specific feedback
      → "Add validation to email field"
      → Go back to step 2 (review again)
      
   c) REDO: Completely wrong approach
      → Use Task tool with different instructions
      → "Actually, use Zod for validation instead"
      → Go back to step 2
      
   d) DO IT YOURSELF: Tiny fix not worth delegating
      → Use Edit tool to fix it directly
      → Update relevant files
      → Mark task complete

4. COMMUNICATE
   Tell the user what you did:
   "✓ Task 1 complete: User schema created with all fields
    Files: src/types/user.ts (verified)
    Moving to task 2..."

CRITICAL RULES:
- NEVER trust subagent's claims without verification
- ALWAYS read the actual files to verify
- Run tests when relevant
- Iterate if needed - don't settle for "close enough"
- Keep trying until requirements actually met
- Be specific in feedback to subagent
```

## Tools the Orchestrator Needs

```typescript
orchestrator: {
  tools: {
    // Delegation
    task: true,              // Call subagents
    
    // Review
    read: true,              // Check files created
    grep: true,              // Verify code patterns
    glob: true,              // Find files
    ls: true,                // List directory
    bash: true,              // Run tests
    
    // Direct fixes (when needed)
    write: true,             // Create files
    edit: true,              // Fix small issues
    
    // Project management
    todowrite: true,         // Track tasks
    todoread: true,          // Check progress
    
    // NOT ALLOWED
    websearch: false,        // Orchestrator doesn't research
    webfetch: false,
  }
}
```

## Example: Full Iteration

```
USER: Build a TODO app

ORCHESTRATOR:
I'll break this into 5 tasks:
1. Create data model
2. Add CRUD operations
3. Build UI components
4. Add persistence
5. Write tests

[Uses TodoWrite to create 5 todos]

Starting Task 1: Create data model

[Uses Task tool]
Task(
  description="Create data model",
  prompt="Create a TypeScript interface for Todo item with: id (string), text (string), completed (boolean), createdAt (Date)",
  subagent_type="build"
)

BUILD AGENT (in child session):
"I'll create the data model in src/types/todo.ts"
[Uses Write tool to create file]
"Done! Created Todo interface with id, text, and completed fields."

ORCHESTRATOR receives:
{
  output: "Done! Created Todo interface with id, text, and completed fields.",
  metadata: {
    summary: [
      { tool: "Write", input: { file_path: "src/types/todo.ts", content: "..." } }
    ],
    sessionId: "ses_child_abc"
  }
}

ORCHESTRATOR: [REVIEW PHASE]
Let me verify...

[Uses Read tool]
Read(file_path="src/types/todo.ts")

Returns:
```typescript
export interface Todo {
  id: string
  text: string
  completed: boolean
}
```

ORCHESTRATOR analyzes:
- ✓ Has id: string
- ✓ Has text: string  
- ✓ Has completed: boolean
- ✗ MISSING: createdAt: Date

ORCHESTRATOR: [ITERATE]
Missing createdAt field. Let me ask build agent to add it.

[Uses Task tool again with same child session]
Task(
  description="Add createdAt field",
  prompt="Add a createdAt field of type Date to the Todo interface in src/types/todo.ts",
  subagent_type="build"
)

BUILD AGENT:
[Uses Edit tool to add field]
"Added createdAt field"

ORCHESTRATOR: [REVIEW AGAIN]
[Uses Read tool]
Read(file_path="src/types/todo.ts")

Returns:
```typescript
export interface Todo {
  id: string
  text: string
  completed: boolean
  createdAt: Date
}
```

ORCHESTRATOR analyzes:
- ✓ All fields present
- ✓ Types correct

ORCHESTRATOR: [APPROVE]
✓ Task 1 complete: Todo data model verified
  Created: src/types/todo.ts with all required fields (id, text, completed, createdAt)
  
[Marks todo #1 as complete]

Moving to Task 2: Add CRUD operations...
```

## Key Insights

1. **Task tool is stateless** - each call creates a new child session
   - Parent can call Task multiple times for iteration
   - Each iteration is a separate conversation

2. **Metadata gives tool summary** - orchestrator sees what was done
   - Can check if Write/Edit/Bash tools were used
   - Can see test results from Bash outputs

3. **Parent has full access** - orchestrator can:
   - Read any file to verify
   - Run its own tests
   - Check file status
   - Make small fixes itself

4. **Iteration is natural** - orchestrator can:
   - Call Task again with feedback
   - Keep refining until satisfied
   - Eventually give up and do it itself

## Changes Needed

### 1. Make Build Agent Delegatable
```typescript
// src/agent/agent.ts
build: {
  mode: "all",  // Was "primary" - now both primary AND subagent
}
```

### 2. Update Orchestrator Prompt
See full prompt pattern above - emphasize REVIEW phase

### 3. Give Orchestrator Task Tool
Already done! ✓

### 4. Test Iteration Pattern
Create test that:
- Orchestrator delegates
- Subagent does it wrong
- Orchestrator catches it
- Orchestrator iterates until right

## Next Steps

1. ✅ Understand architecture (this doc)
2. ⬜ Change build.mode to "all"
3. ⬜ Rewrite orchestrator.txt with review/iteration workflow
4. ⬜ Test with intentionally broken subagent
5. ⬜ Verify iteration works
6. ⬜ Test with real project

This is senior dev behavior: delegate, verify, iterate, approve.
