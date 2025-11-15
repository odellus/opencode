# Hierarchical Todo Supervision - Real-Time Orchestrator

## Vision

**Orchestrator creates high-level todos, delegates to subagent, and monitors subagent's todos in real-time.**

```
ORCHESTRATOR TODOS:           SUBAGENT TODOS:
1. [in_progress] Setup        → 1. [completed] Create package.json
   project structure          → 2. [in_progress] Install dependencies
2. [pending] Build data       → 3. [pending] Setup TypeScript config
   model                      
3. [pending] Add CRUD ops     ← Orchestrator watches these!
4. [pending] Write tests
```

**Key insight:** Every time subagent updates its todos, orchestrator gets an event and can:
- See progress
- Detect anti-patterns (multiple in_progress, stuck tasks)
- Intervene with guidance
- Decide if high-level task is complete

## Current Infrastructure (Already Exists!)

### Todo Event Bus

**Location:** `packages/opencode/src/session/todo.ts`

```typescript
export const Event = {
  Updated: Bus.event(
    "todo.updated",
    z.object({
      sessionID: z.string(),
      todos: z.array(Info),
    }),
  ),
}
```

**When it fires:**
- Subagent calls TodoWrite tool
- Todo.update() is called
- Bus.publish(Event.Updated, { sessionID, todos })
- ALL subscribers get notified immediately

### Existing Supervision (orchestrator.ts)

```typescript
Bus.subscribe(Todo.Event.Updated, async (event) => {
  if (event.properties.sessionID !== doerSessionID) return
  
  const todos = event.properties.todos
  const antiPatterns = detectTodoAntiPatterns(todos)
  
  if (antiPatterns.length > 0) {
    // Send feedback to doer
    await sendFeedbackToDoer(doerSessionID, pattern.message)
  }
})
```

**This already does real-time monitoring!** We just need to extend it.

## Hierarchical Todo Architecture

### Two-Level System

**Level 1: Orchestrator Todos** (High-level project tasks)
```typescript
// Stored in orchestrator's session
orchestratorTodos = [
  {
    id: "task-1",
    content: "Setup project structure",
    status: "in_progress",
    metadata: {
      subagentSessionId: "ses_child_abc",  // Links to subagent
      subagentTodoCount: 3,
      subagentCompleted: 1,
    }
  },
  {
    id: "task-2",
    content: "Build data model",
    status: "pending"
  }
]
```

**Level 2: Subagent Todos** (Detailed implementation steps)
```typescript
// Stored in subagent's session (ses_child_abc)
subagentTodos = [
  {
    id: "subtask-1",
    content: "Create package.json",
    status: "completed",
    parentTaskId: "task-1",  // Links to orchestrator task
  },
  {
    id: "subtask-2",
    content: "Install dependencies", 
    status: "in_progress",
    parentTaskId: "task-1",
  },
  {
    id: "subtask-3",
    content: "Setup TypeScript config",
    status: "pending",
    parentTaskId: "task-1",
  }
]
```

### Supervision Flow

```
1. Orchestrator creates high-level task
   [TodoWrite: "Setup project structure" - in_progress]
   
2. Orchestrator delegates to subagent
   [Task tool with instruction to create detailed todos]
   
3. Subagent breaks it down
   [TodoWrite in child session: 3 detailed todos]
   ↓
   Bus.publish(Todo.Event.Updated, { sessionID: child, todos: [...] })
   
4. Orchestrator's subscriber fires
   ↓
   Sees: 3 todos created by subagent
   ↓
   Updates own todo: metadata.subagentTodoCount = 3
   
5. Subagent works on subtask-1
   [TodoWrite: subtask-1 status = "completed"]
   ↓
   Bus.publish(Todo.Event.Updated, ...)
   
6. Orchestrator's subscriber fires AGAIN
   ↓
   Sees: subtask-1 completed (1/3 done)
   ↓
   Updates own todo: metadata.subagentCompleted = 1
   ↓
   Checks for anti-patterns:
   - Multiple in_progress? 
   - Same task stuck too long?
   - Suspic ious pattern?
   
7. If anti-pattern detected
   ↓
   Orchestrator intervenes:
   "You have 2 tasks in progress. Focus on one."
   
8. When all subagent todos complete (3/3)
   ↓
   Orchestrator reviews work (Read files, run tests)
   ↓
   If satisfied:
   [TodoWrite: "Setup project structure" - completed]
   ↓
   Move to next high-level task
```

## Implementation

### Enhanced Orchestrator Supervision

**Location:** `packages/opencode/src/orchestrator/orchestrator.ts`

```typescript
export namespace Orchestrator {
  /**
   * Enhanced supervision with hierarchical todo tracking
   */
  export async function supervise(input: {
    orchestratorSessionID: string
    doerSessionID: string
    orchestratorTaskId: string  // Which high-level task this relates to
  }): Promise<() => void> {
    
    const unsubscribers: Array<() => void> = []
    
    // Track subagent todo state
    let lastSubagentTodos: Todo.Info[] = []
    
    // Real-time todo monitoring
    const todoUnsub = Bus.subscribe(Todo.Event.Updated, async (event) => {
      if (event.properties.sessionID !== input.doerSessionID) return
      
      const subagentTodos = event.properties.todos
      const changes = detectTodoChanges(lastSubagentTodos, subagentTodos)
      lastSubagentTodos = subagentTodos
      
      // Update orchestrator's high-level todo with subagent progress
      await updateOrchestratorTaskProgress(input.orchestratorSessionID, {
        taskId: input.orchestratorTaskId,
        subagentTodoCount: subagentTodos.length,
        subagentCompleted: subagentTodos.filter(t => t.status === "completed").length,
        subagentInProgress: subagentTodos.filter(t => t.status === "in_progress").length,
      })
      
      // Detect anti-patterns
      const antiPatterns = detectTodoAntiPatterns(subagentTodos)
      if (antiPatterns.length > 0) {
        log.warn("anti-pattern detected", { patterns: antiPatterns })
        
        // Intervene immediately
        for (const pattern of antiPatterns) {
          await interventionHandler(input, pattern, subagentTodos)
        }
      }
      
      // Check if subagent task is complete
      const allComplete = subagentTodos.every(t => 
        t.status === "completed" || t.status === "cancelled"
      )
      
      if (allComplete && subagentTodos.length > 0) {
        log.info("subagent completed all todos, triggering review")
        await triggerOrchestratorReview(input)
      }
      
      // Detect specific events
      for (const change of changes) {
        switch (change.type) {
          case "todo_added":
            log.info("subagent created new todo", { todo: change.todo })
            // Orchestrator can react: "Good, you broke it down"
            break
            
          case "todo_completed":
            log.info("subagent completed todo", { todo: change.todo })
            // Update progress bar, check if milestone hit
            break
            
          case "todo_stuck":
            // Same todo in_progress for > 5 minutes
            log.warn("subagent stuck on todo", { todo: change.todo })
            await sendGuidance(input.doerSessionID, 
              `You've been working on "${change.todo.content}" for a while. Need help?`)
            break
        }
      }
    })
    
    unsubscribers.push(todoUnsub)
    
    return () => {
      unsubscribers.forEach(unsub => unsub())
    }
  }
  
  /**
   * Detect what changed in todos
   */
  function detectTodoChanges(
    oldTodos: Todo.Info[],
    newTodos: Todo.Info[]
  ): TodoChange[] {
    const changes: TodoChange[] = []
    
    // New todos added
    for (const todo of newTodos) {
      if (!oldTodos.find(t => t.id === todo.id)) {
        changes.push({ type: "todo_added", todo })
      }
    }
    
    // Status changes
    for (const newTodo of newTodos) {
      const oldTodo = oldTodos.find(t => t.id === newTodo.id)
      if (oldTodo && oldTodo.status !== newTodo.status) {
        changes.push({ type: "status_changed", todo: newTodo, oldStatus: oldTodo.status })
        
        if (newTodo.status === "completed") {
          changes.push({ type: "todo_completed", todo: newTodo })
        }
      }
    }
    
    return changes
  }
  
  /**
   * Handle different intervention types
   */
  async function interventionHandler(
    context: { orchestratorSessionID: string, doerSessionID: string },
    pattern: AntiPattern,
    todos: Todo.Info[]
  ) {
    switch (pattern.type) {
      case "multiple_in_progress":
        // Direct intervention
        await sendFeedbackToDoer(context.doerSessionID, pattern.message)
        break
        
      case "stuck_task":
        // Offer help
        await sendFeedbackToDoer(context.doerSessionID,
          "Been stuck? Try a different approach or ask for guidance.")
        break
        
      case "reward_hacking":
        // Challenge the claim
        const lastCompleted = todos.filter(t => t.status === "completed").pop()
        await sendFeedbackToDoer(context.doerSessionID,
          `You marked "${lastCompleted?.content}" complete. Show me the changes.`)
        break
    }
  }
  
  /**
   * Trigger orchestrator to review subagent's work
   */
  async function triggerOrchestratorReview(context: {
    orchestratorSessionID: string
    doerSessionID: string
    orchestratorTaskId: string
  }) {
    // Send message to orchestrator session to trigger review
    await SessionPrompt.prompt({
      sessionID: context.orchestratorSessionID,
      noReply: false,  // Orchestrator should respond
      parts: [{
        type: "text",
        text: `The subagent has completed all their todos for the current task. Please review their work and decide if the high-level task "${context.orchestratorTaskId}" is complete.

Use Read/Grep/Bash tools to verify the work meets requirements.

Then either:
- Mark the task as complete and move to next task
- Request changes from the subagent
- Fix small issues yourself`,
      }],
    })
  }
}
```

### Orchestrator System Prompt (Enhanced)

```
You are an orchestrator - a senior developer supervising a junior developer (the subagent).

## Hierarchical Todo Management

You work with TWO levels of todos:

1. YOUR TODOS (High-level tasks)
   - Project-level tasks (3-7 tasks per project)
   - Each represents a major milestone
   - Example: "Setup project structure", "Build data model"
   
2. SUBAGENT TODOS (Detailed steps)
   - Created by the subagent when you delegate
   - Fine-grained implementation steps
   - You MONITOR these in real-time
   - Example: "Create package.json", "Install dependencies"

## Real-Time Supervision Workflow

### 1. CREATE HIGH-LEVEL TASK
[TodoWrite: "Setup project structure" - in_progress]

### 2. DELEGATE TO SUBAGENT
[Task tool: "Setup a TypeScript project with React. Create detailed todos for each step."]

Subagent will break your task down and create their own todos.

### 3. MONITOR SUBAGENT TODOS (Automatic)
You'll receive notifications when subagent updates their todos:
- "Subagent created 3 todos: package.json, dependencies, tsconfig"
- "Subagent completed: Create package.json (1/3)"
- "Subagent completed: Install dependencies (2/3)"
- "⚠️ Subagent has 2 tasks in progress!" ← Anti-pattern detected

### 4. INTERVENE WHEN NEEDED
Don't wait until the end. React to anti-patterns immediately:

- Multiple in_progress → "Focus on one task at a time"
- Stuck on same task → "Try a different approach?"
- Suspicious completion → "Show me what you did"

Send feedback via new Task call or direct message.

### 5. REVIEW WHEN SUBAGENT FINISHES
When all subagent todos are complete, you'll be notified to review.

Use your tools to verify:
- Read files created
- Grep for key patterns
- Run tests
- Check if requirements met

### 6. DECIDE
- ✓ APPROVED: Mark your high-level task complete, move on
- ↻ ITERATE: Send new Task with specific feedback
- ✏️ FIX: Make small corrections yourself

## Example Session

USER: Build a TODO app

YOU: I'll break this into 5 high-level tasks:
[TodoWrite creates 5 tasks]

Task 1: "Setup project structure" - IN_PROGRESS

[Task tool: "Setup TypeScript + React project. Create detailed todos."]

SYSTEM: Subagent created todos:
1. Create package.json
2. Install React + TypeScript
3. Setup tsconfig.json
4. Create src/ folder structure

YOU: Good breakdown. Proceeding...

SYSTEM: Subagent completed: Create package.json (1/4)
SYSTEM: Subagent completed: Install React + TypeScript (2/4)
SYSTEM: ⚠️ Anti-pattern: Task "Setup tsconfig.json" in_progress for 5 minutes

YOU: [Intervenes]
"Having trouble with tsconfig? Here's a template: { compilerOptions: { ... } }"

SYSTEM: Subagent completed: Setup tsconfig.json (3/4)
SYSTEM: Subagent completed: Create src/ folder (4/4)
SYSTEM: All subagent todos complete. Please review.

YOU: [Reviews]
[Read: "package.json"] ✓ Looks good
[Read: "tsconfig.json"] ✓ Correct settings
[Bash: "npm run build"] ✓ Builds successfully

Task 1: COMPLETE
[TodoWrite: Task 1 status = completed]

Moving to Task 2: "Build data model"
[Task tool: "Create TypeScript interfaces..."]

## Key Behaviors

1. **Create high-level todos** for the project (3-7 tasks)
2. **Delegate one task at a time** to subagent
3. **Monitor subagent todos** in real-time (automatic)
4. **Intervene when needed** (anti-patterns, guidance)
5. **Review when complete** (verify work)
6. **Approve or iterate** (mark complete or request changes)
7. **Move to next task** (sequential progress)

You're not just delegating and forgetting - you're actively supervising.
```

## Anti-Pattern Detection (Enhanced)

```typescript
function detectTodoAntiPatterns(todos: Todo.Info[]): AntiPattern[] {
  const patterns: AntiPattern[] = []
  
  // Multiple in progress
  const inProgress = todos.filter(t => t.status === "in_progress")
  if (inProgress.length > 1) {
    patterns.push({
      type: "multiple_in_progress",
      severity: "medium",
      message: `You have ${inProgress.length} tasks in progress. Focus on one.`,
      intervention: "immediate",  // Send feedback now
    })
  }
  
  // Rapid completion without tool use
  if (todos.filter(t => t.status === "completed").length > 0) {
    // Check metadata: did subagent actually use tools?
    // If last completed todo has no associated file changes...
    patterns.push({
      type: "reward_hacking",
      severity: "high",
      message: "Show me what you actually did for that task.",
      intervention: "challenge",  // Ask for proof
    })
  }
  
  // Task stuck too long (requires timestamp tracking)
  for (const todo of inProgress) {
    if (todo.metadata?.startTime) {
      const duration = Date.now() - todo.metadata.startTime
      if (duration > 5 * 60 * 1000) {  // 5 minutes
        patterns.push({
          type: "stuck_task",
          severity: "low",
          message: `Stuck on "${todo.content}"? Try a different approach.`,
          intervention: "guidance",  // Offer help
        })
      }
    }
  }
  
  return patterns
}
```

## Benefits

1. **Real-time visibility** - Orchestrator sees progress as it happens
2. **Early intervention** - Catch anti-patterns immediately
3. **Hierarchical structure** - High-level plan + detailed execution
4. **Natural workflow** - Senior dev supervising junior dev
5. **No polling** - Event-driven via Bus
6. **Scalable** - Can supervise multiple subagents (future)

## Implementation Checklist

- [x] Todo.Event.Updated exists and fires
- [x] Bus.subscribe works for monitoring
- [x] Orchestrator.supervise() scaffolding exists
- [ ] Enhance supervise() with todo change detection
- [ ] Add interventionHandler for different anti-patterns
- [ ] Add triggerOrchestratorReview when subagent completes
- [ ] Update orchestrator.txt prompt with real-time supervision
- [ ] Add timestamp tracking to todos (for stuck detection)
- [ ] Test hierarchical todo workflow

This is the senior dev pattern you wanted - active supervision, not passive waiting!
