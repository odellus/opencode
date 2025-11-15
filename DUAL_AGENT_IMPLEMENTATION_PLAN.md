# Dual-Agent Pair Programming - Implementation Plan

## Overview

Build a new package (`packages/pair-programming`) that implements **dual-agent conversational pair programming** where two AI agents collaborate in a single conversation thread, taking turns with different roles and perspectives.

### Core Concept

Instead of the hierarchical subagent invocation pattern (parent delegates to child), this implements **peer collaboration**:
- **Junior Agent (Builder)**: Does majority of work, executes tools, writes code
- **Senior Agent (Critic)**: Provides guidance, asks questions, reviews work
- Both agents share the same conversation, tools, and todo list
- Conversation history is **reframed** based on whose turn it is (role inversion)

## Architecture

### Package Structure

```
packages/pair-programming/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Main entry point
│   ├── conversation/
│   │   ├── storage.ts              # Neutral conversation storage
│   │   ├── turn.ts                 # Turn data structures
│   │   └── renderer.ts             # Tool call → markdown renderer
│   ├── agent/
│   │   ├── roles.ts                # Junior/Senior role definitions
│   │   ├── perspective.ts          # Role inversion transformer
│   │   └── prompts.ts              # System prompts for each role
│   ├── session/
│   │   ├── dual-session.ts         # Main session orchestrator
│   │   ├── turn-manager.ts         # Turn switching logic
│   │   └── todo.ts                 # Shared todo list
│   ├── tool/
│   │   ├── registry.ts             # Reuse opencode tools
│   │   └── executor.ts             # Tool execution context
│   └── demo/
│       ├── simple.ts               # Basic demo script
│       └── feature-implementation.ts  # Complex demo
└── README.md
```

## Key Components

### 1. Neutral Conversation Storage

**File**: `src/conversation/storage.ts`

```typescript
export namespace Conversation {
  export interface Turn {
    id: string
    agent: "junior" | "senior"
    timestamp: number
    text?: string
    toolCalls?: ToolCall[]
  }

  export interface ToolCall {
    id: string
    name: string
    input: Record<string, any>
    output: string
    error?: string
    timestamp: number
  }

  // Store turns neutrally - no role assignment yet
  export function create(id: string): Promise<void>
  export function addTurn(conversationId: string, turn: Turn): Promise<void>
  export function getTurns(conversationId: string): Promise<Turn[]>
}
```

**What it does**:
- Stores conversation as neutral "turns" without user/assistant roles
- Each turn records: which agent spoke, what they said, what tools they used
- Storage format is agnostic to perspective

**Reuses from opencode**:
- `Storage` namespace for persistence
- `Identifier` for ID generation

---

### 2. Perspective Transformer

**File**: `src/agent/perspective.ts`

```typescript
export namespace Perspective {
  export function transformForAgent(
    turns: Conversation.Turn[],
    agentPerspective: "junior" | "senior"
  ): Message[] {
    return turns.map(turn => {
      if (turn.agent === agentPerspective) {
        // My own turn: role=assistant, keep tool calls native
        return {
          role: "assistant",
          content: turn.text,
          tool_calls: turn.toolCalls  // Native format
        }
      } else {
        // Other agent's turn: role=user, render tools as markdown
        return {
          role: "user",
          content: renderTurnAsMarkdown(turn)
        }
      }
    })
  }
}
```

**What it does**:
- Takes neutral turns + agent perspective → outputs role-inverted messages
- Agent sees their own messages as `role: "assistant"`
- Agent sees other agent's messages as `role: "user"`
- Critical for making each agent think they're having a conversation with a user

**Reuses from opencode**:
- Message structure concepts from `MessageV2`

---

### 3. Tool Call Renderer

**File**: `src/conversation/renderer.ts`

```typescript
export namespace Renderer {
  export function renderTurnAsMarkdown(turn: Conversation.Turn): string {
    let output = turn.text || ""
    
    if (turn.toolCalls?.length) {
      output += "\n\n## Tools Used\n\n"
      
      for (const toolCall of turn.toolCalls) {
        output += `### ${toolCall.name}\n\n`
        output += `**Input:**\n\`\`\`json\n${JSON.stringify(toolCall.input, null, 2)}\n\`\`\`\n\n`
        
        if (toolCall.error) {
          output += `**Error:**\n\`\`\`\n${toolCall.error}\n\`\`\`\n\n`
        } else {
          output += `**Output:**\n\`\`\`\n${toolCall.output}\n\`\`\`\n\n`
        }
      }
    }
    
    return output
  }
}
```

**What it does**:
- Converts tool calls to human-readable markdown
- Needed because LLM APIs don't accept `tool_calls` in `role: "user"` messages
- Senior agent sees Junior's tool usage as descriptive text

---

### 4. Agent Roles

**File**: `src/agent/roles.ts`

```typescript
export namespace AgentRole {
  export type Role = "junior" | "senior"
  
  export interface Config {
    role: Role
    systemPrompt: string
    toolPermissions?: string[]  // Which tools this agent can use
  }
  
  export const JUNIOR: Config = {
    role: "junior",
    systemPrompt: JUNIOR_SYSTEM_PROMPT,
    // Full tool access
  }
  
  export const SENIOR: Config = {
    role: "senior",
    systemPrompt: SENIOR_SYSTEM_PROMPT,
    toolPermissions: ["Read", "Grep", "Glob"]  // Read-only tools
  }
}
```

**File**: `src/agent/prompts.ts`

```typescript
const JUNIOR_SYSTEM_PROMPT = `
You are a junior software engineer pair programming with a senior engineer.

Your role:
- Implement features and write code
- Execute tools to read, write, and modify files
- Update the shared todo list
- Ask for guidance when uncertain
- Learn from senior's feedback

Your senior partner will provide guidance, review your work, and ask questions.
Listen carefully to their feedback and incorporate it into your work.
`

const SENIOR_SYSTEM_PROMPT = `
You are a senior software engineer pair programming with a junior engineer.

Your role:
- Provide guidance and architectural direction
- Review junior's code and tool usage
- Ask clarifying questions to prevent mistakes
- Suggest better approaches
- Keep junior on track toward the goal

Be sparse in your responses - only interject when necessary.
Let junior do the work; you're here to guide, not implement.

You have read-only tools available to review code.
`
```

**What it does**:
- Defines distinct personalities and responsibilities
- Junior has full tool access (Read, Write, Edit, Bash, etc.)
- Senior has limited tools (Read, Grep, Glob - inspection only)
- Clear separation of concerns

---

### 5. Turn Manager

**File**: `src/session/turn-manager.ts`

```typescript
export namespace TurnManager {
  export interface Config {
    maxTurns: number
    juniorTurnsBeforeSeniorIntercept: number
  }
  
  export class Manager {
    private turnCount = 0
    private currentAgent: "junior" | "senior" = "junior"
    
    constructor(private config: Config) {}
    
    whoIsNext(): "junior" | "senior" {
      // Junior goes first and does most turns
      // Senior intercepts periodically
      if (this.turnCount % this.config.juniorTurnsBeforeSeniorIntercept === 0 && this.turnCount > 0) {
        return "senior"
      }
      return "junior"
    }
    
    recordTurn(agent: "junior" | "senior"): void {
      this.turnCount++
      this.currentAgent = agent
    }
    
    isComplete(): boolean {
      return this.turnCount >= this.config.maxTurns
    }
  }
}
```

**What it does**:
- Controls whose turn it is
- Enforces turn limits to prevent infinite loops
- Configurable interception pattern (e.g., senior reviews every 3 junior turns)

---

### 6. Dual Session Orchestrator

**File**: `src/session/dual-session.ts`

```typescript
export namespace DualSession {
  export interface Config {
    conversationId: string
    initialPrompt: string
    maxTurns: number
    provider: {
      providerID: string
      juniorModelID: string
      seniorModelID: string
    }
  }
  
  export async function run(config: Config): Promise<void> {
    const turnManager = new TurnManager.Manager({
      maxTurns: config.maxTurns,
      juniorTurnsBeforeSeniorIntercept: 3
    })
    
    // Initialize conversation with user's initial prompt
    await Conversation.create(config.conversationId)
    await Conversation.addTurn(config.conversationId, {
      id: generateId(),
      agent: "junior",  // Start with junior
      timestamp: Date.now(),
      text: config.initialPrompt
    })
    
    while (!turnManager.isComplete()) {
      const nextAgent = turnManager.whoIsNext()
      const agentConfig = nextAgent === "junior" ? AgentRole.JUNIOR : AgentRole.SENIOR
      
      // Get conversation history from this agent's perspective
      const turns = await Conversation.getTurns(config.conversationId)
      const messages = Perspective.transformForAgent(turns, nextAgent)
      
      // Get model for this agent
      const modelID = nextAgent === "junior" 
        ? config.provider.juniorModelID 
        : config.provider.seniorModelID
      const model = await Provider.getModel(config.provider.providerID, modelID)
      
      // Call LLM with role-inverted messages
      const result = await streamText({
        model: model.language,
        system: agentConfig.systemPrompt,
        messages,
        tools: getToolsForAgent(agentConfig),
        experimental_telemetry: {
          isEnabled: true,
          functionId: `dual-session-${nextAgent}-turn-${turnManager.turnCount}`,
          metadata: {
            conversationId: config.conversationId,
            agent: nextAgent,
            turn: turnManager.turnCount
          }
        }
      })
      
      // Collect response and tool calls
      const turn = await processTurn(result, nextAgent)
      await Conversation.addTurn(config.conversationId, turn)
      
      turnManager.recordTurn(nextAgent)
    }
  }
}
```

**What it does**:
- Main entry point for running dual-agent conversation
- Orchestrates turn-taking between junior and senior
- Calls Vercel AI SDK with properly transformed messages
- Stores results back into neutral conversation storage

**Reuses from opencode**:
- `Provider.getModel()` for LLM access
- `streamText` from Vercel AI SDK
- Tool execution infrastructure

---

### 7. Tool Registry & Executor

**File**: `src/tool/registry.ts`

```typescript
export namespace ToolRegistry {
  // Import tools from opencode
  import { Bash } from "../../../opencode/src/tool/bash"
  import { Read } from "../../../opencode/src/tool/read"
  import { Write } from "../../../opencode/src/tool/write"
  import { Edit } from "../../../opencode/src/tool/edit"
  import { Grep } from "../../../opencode/src/tool/grep"
  import { Glob } from "../../../opencode/src/tool/glob"
  
  export function getToolsForAgent(agentConfig: AgentRole.Config) {
    const allTools = [Bash, Read, Write, Edit, Grep, Glob]
    
    if (!agentConfig.toolPermissions) {
      return allTools  // Junior gets everything
    }
    
    return allTools.filter(tool => 
      agentConfig.toolPermissions!.includes(tool.id)
    )
  }
}
```

**What it does**:
- Reuses all tool definitions from `packages/opencode/src/tool/`
- Filters tools based on agent role permissions
- No need to reimplement tools - just wrap them

**Reuses from opencode**:
- All tool implementations (Bash, Read, Write, Edit, Grep, Glob, etc.)
- Tool.Info interface
- Tool execution context

---

### 8. Shared Todo List

**File**: `src/session/todo.ts`

```typescript
export namespace SharedTodo {
  export interface Item {
    id: string
    content: string
    status: "pending" | "in_progress" | "completed"
    createdBy: "junior" | "senior"
    timestamp: number
  }
  
  export function add(conversationId: string, item: Item): Promise<void>
  export function update(conversationId: string, itemId: string, status: Item["status"]): Promise<void>
  export function list(conversationId: string): Promise<Item[]>
  
  // Inject into system prompt
  export function formatForPrompt(todos: Item[]): string {
    return `
## Current TODO List

${todos.map(t => `- [${t.status}] ${t.content}`).join("\n")}

You can update this todo list using the UpdateTodo tool.
    `.trim()
  }
}
```

**What it does**:
- Both agents can read and update shared todo list
- Todo state is visible in both agents' prompts
- Helps coordination and tracking progress

**Could reuse from opencode**:
- Todo data structures from existing todo system
- Storage mechanisms

---

## Implementation Phases

### Phase 1: Foundation (Core Infrastructure)
**Deliverable**: Basic conversation storage and role inversion working

1. Create package structure
2. Implement `Conversation.Storage` (neutral turn storage)
3. Implement `Perspective.transformForAgent` (role inversion)
4. Implement `Renderer.renderTurnAsMarkdown` (tool call rendering)
5. Write unit tests for role transformation

**Success criteria**: Can store turns neutrally and transform them from different perspectives

---

### Phase 2: Agent Roles & Tools
**Deliverable**: Agents have distinct personalities and tool access

1. Define agent roles in `AgentRole`
2. Write system prompts for junior/senior
3. Create `ToolRegistry` to import opencode tools
4. Implement tool permission filtering
5. Test tool execution from both agent perspectives

**Success criteria**: Can execute tools with different permission sets per agent

---

### Phase 3: Turn Management
**Deliverable**: Turn-based conversation flow works

1. Implement `TurnManager` with turn limits
2. Implement turn interception logic (junior → senior pattern)
3. Add conversation state tracking
4. Test turn progression logic

**Success criteria**: Turn manager correctly alternates between agents based on rules

---

### Phase 4: Session Orchestration
**Deliverable**: End-to-end dual-agent conversation runs

1. Implement `DualSession.run()` orchestrator
2. Wire up Vercel AI SDK calls with transformed messages
3. Handle tool execution within turns
4. Store turn results back to conversation
5. Add LangFuse telemetry

**Success criteria**: Can run a complete dual-agent conversation from start to finish

---

### Phase 5: Shared Todo & Polish
**Deliverable**: Agents coordinate via shared todo list

1. Implement `SharedTodo` storage
2. Create `UpdateTodo` tool
3. Inject todo list into agent prompts
4. Add todo list to conversation context
5. Test agents coordinating via todos

**Success criteria**: Agents can collaboratively manage a todo list

---

### Phase 6: Demo & Documentation
**Deliverable**: Working demos and usage guide

1. Create simple demo (`demo/simple.ts`)
2. Create feature implementation demo (`demo/feature-implementation.ts`)
3. Write README with usage examples
4. Document configuration options
5. Add integration guide

**Success criteria**: Someone can run demos and understand how to use the system

---

## Reusable Components from OpenCode

### Direct Reuse (Import as-is)
- `packages/opencode/src/tool/*` - All tool implementations
- `packages/opencode/src/provider/provider.ts` - LLM provider abstraction
- `packages/opencode/src/storage/storage.ts` - Storage primitives
- `packages/opencode/src/id/id.ts` - ID generation
- `packages/opencode/src/util/log.ts` - Logging
- `packages/opencode/src/observability/langfuse.ts` - LangFuse setup

### Adapt/Modify
- `MessageV2` structures - Use as inspiration for Turn structures
- Session concepts - Adapt for dual-agent context
- Tool execution context - Modify to track which agent is executing

### Don't Reuse
- `session/prompt.ts` - Too coupled to single-agent pattern
- `agent/agent.ts` - Built for hierarchical subagents
- TUI/CLI - This is a library, not a frontend

---

## Key Technical Decisions

### 1. Message Role Inversion Strategy

**Decision**: Transform entire conversation history based on agent perspective

**Why**: LLM APIs expect `role: "user" | "assistant"` format. We can't send both agents' messages as `assistant`. Solution: rewrite history so each agent sees themselves as assistant and other as user.

**Implementation**: 
```typescript
// Junior's view:
[
  {role: "user", content: "Senior: Let's add authentication"},
  {role: "assistant", content: "Junior: *uses Write tool*"},
  {role: "user", content: "Senior: Good, now add tests"}
]

// Senior's view:
[
  {role: "assistant", content: "Senior: Let's add authentication"},
  {role: "user", content: "Junior: *rendered tool calls*"},
  {role: "assistant", content: "Senior: Good, now add tests"}
]
```

---

### 2. Tool Call Rendering

**Decision**: Render other agent's tool calls as markdown in `role: "user"` messages

**Why**: Can't send `tool_calls` array in user messages - API rejects it. Must convert to text.

**Format**:
```markdown
Junior executed the following tools:

### Write
**Input:**
```json
{"file_path": "/path/to/file", "content": "..."}
```

**Output:**
```
Successfully wrote file
```
```

---

### 3. Turn Interception Pattern

**Decision**: Junior does N turns, then senior intercepts for 1 turn

**Why**: Junior is the "doer", should dominate conversation. Senior provides periodic guidance.

**Configurable**: `juniorTurnsBeforeSeniorIntercept` parameter

**Example**: With N=3:
- Turn 1: Junior (implements feature)
- Turn 2: Junior (writes tests)  
- Turn 3: Junior (runs tests)
- Turn 4: Senior (reviews and suggests improvements)
- Turn 5: Junior (applies feedback)
- ...

---

### 4. Tool Permissions

**Decision**: Junior gets full tool access, Senior gets read-only

**Why**: 
- Junior is implementer - needs Write, Edit, Bash
- Senior is reviewer - only needs Read, Grep, Glob
- Prevents senior from "doing the work" - forces guidance role

---

### 5. Model Selection

**Decision**: Allow different models for each agent

**Why**: 
- Senior could use stronger model (GPT-5, Claude Opus) for better guidance
- Junior could use faster/cheaper model (GPT-4, Claude Sonnet) for execution
- Cost optimization: most turns are junior (cheaper), critical turns are senior (expensive)

---

## Testing Strategy

### Unit Tests
- `Perspective.transformForAgent()` - verify role inversion
- `Renderer.renderTurnAsMarkdown()` - verify tool rendering
- `TurnManager` - verify turn progression logic
- `ToolRegistry.getToolsForAgent()` - verify permission filtering

### Integration Tests
- Full conversation flow with mocked LLM responses
- Tool execution from both agent perspectives
- Todo list coordination between agents

### Manual Testing
- Simple feature implementation demo
- Bug fix scenario
- Code refactoring task

---

## Example Usage

```typescript
import { DualSession } from "@opencode-ai/pair-programming"

await DualSession.run({
  conversationId: "feature-auth",
  initialPrompt: "Implement user authentication with JWT tokens",
  maxTurns: 20,
  provider: {
    providerID: "anthropic",
    juniorModelID: "claude-sonnet-4",
    seniorModelID: "claude-opus-4"
  }
})
```

## Configuration Options

```typescript
interface DualSessionConfig {
  conversationId: string           // Unique ID for this conversation
  initialPrompt: string            // Initial task description
  maxTurns: number                 // Prevent infinite loops
  juniorTurnsBeforeSeniorIntercept?: number  // Default: 3
  provider: {
    providerID: string             // e.g., "anthropic", "openai"
    juniorModelID: string          // Model for junior agent
    seniorModelID: string          // Model for senior agent
  }
  tools?: {
    junior?: string[]              // Override junior tool permissions
    senior?: string[]              // Override senior tool permissions
  }
  systemPrompts?: {
    junior?: string                // Override junior system prompt
    senior?: string                // Override senior system prompt
  }
}
```

---

## Open Questions & Future Work

### Questions to Resolve
1. **When should senior intercept?**
   - Fixed interval (every N junior turns)?
   - When junior uses certain tools (AskUserQuestion)?
   - When junior's message contains uncertainty markers ("I'm not sure", "maybe")?

2. **How to handle errors?**
   - If junior's tool fails, does senior get a turn to help?
   - Or does junior get to retry first?

3. **How to determine completion?**
   - Turn limit reached?
   - Senior explicitly approves ("looks good")?
   - Both agents agree task is done?

### Future Enhancements
- **Multi-agent**: Support more than 2 agents (junior, senior, architect)
- **Async execution**: Let senior run in background while junior continues
- **Human-in-loop**: Allow human to intercept and provide input
- **Evaluation**: Score conversation quality, measure how well agents collaborate
- **Learning**: Use conversation data to fine-tune agent prompts

---

## Timeline Estimate

- **Phase 1** (Foundation): 2-3 hours
- **Phase 2** (Roles & Tools): 2 hours
- **Phase 3** (Turn Management): 1 hour
- **Phase 4** (Orchestration): 3-4 hours
- **Phase 5** (Todo & Polish): 2 hours
- **Phase 6** (Demo & Docs): 2 hours

**Total**: ~12-15 hours of implementation

---

## Success Metrics

1. ✅ Can store conversation turns neutrally
2. ✅ Can transform messages from different agent perspectives
3. ✅ Tool calls render correctly as markdown
4. ✅ Agents have distinct roles and tool permissions
5. ✅ Turn management enforces alternation and limits
6. ✅ Full conversation runs end-to-end
7. ✅ Agents coordinate via shared todo list
8. ✅ LangFuse traces capture both agents' turns
9. ✅ Demo scripts successfully implement features
10. ✅ Documentation enables external usage

---

## Dependencies

### Runtime
- `ai` (Vercel AI SDK) - already in opencode
- `zod` - already in opencode
- `@langfuse/otel` - already in opencode

### Dev
- `bun:test` - for testing
- `typescript` - already in opencode

### Peer
- `@opencode-ai/opencode` - for tool reuse

---

## Next Steps

1. ✅ Review and approve this plan
2. Decide on package name: `@opencode-ai/pair-programming` or `@opencode-ai/dual-agent`?
3. Create `packages/pair-programming/package.json`
4. Start Phase 1 implementation
