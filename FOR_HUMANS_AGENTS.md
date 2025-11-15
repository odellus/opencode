# FOR HUMANS: How OpenCode Agents Work

> A human-readable guide to understanding the agent system in OpenCode - no CS degree required.

---

## What's an Agent, Anyway?

Think of an agent as a **persona** or **role** that the AI plays. Each agent has:
- **A job description** (what they're good at)
- **A set of tools** they can use
- **A mode** that controls where they can be used
- **A custom prompt** that shapes their behavior

**Real-world analogy**: Like hiring different specialists on a construction site - you have architects, builders, supervisors. Each has different skills and responsibilities.

---

## The Agent Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│ PRIMARY AGENTS (You start conversations with these)          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ARCHITECT                                                   │
│  ├─ Role: Strategic planner, reads project specs            │
│  ├─ Tools: Can delegate to SUPERVISE                        │
│  └─ When: Multi-file projects, complex requirements         │
│                                                              │
│  SUPERVISOR (aka ORCHESTRATE - being renamed)                │
│  ├─ Role: Project coordinator, breaks work into tasks       │
│  ├─ Tools: Can delegate to BUILD                            │
│  └─ When: Coordinating multiple code changes                │
│                                                              │
│  PLAN                                                        │
│  ├─ Role: Creates implementation plans                      │
│  ├─ Tools: Planning-focused, limited code execution         │
│  └─ When: You want to review a plan before implementation   │
│                                                              │
│  BUILD (default)                                             │
│  ├─ Role: Hands-on coder, implements features               │
│  ├─ Tools: Full access to Read, Write, Edit, Bash, etc.     │
│  └─ When: Direct coding tasks                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ SUBAGENTS (Only invoked by other agents via Task tool)      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  GENERAL                                                     │
│  ├─ Role: Research, exploration, code search                │
│  ├─ Tools: Read-only tools, grep, glob                      │
│  └─ When: Primary agent needs help finding info             │
│                                                              │
│  EXPLORE                                                     │
│  ├─ Role: Fast codebase exploration                         │
│  ├─ Tools: File search, keyword search                      │
│  └─ When: "Find all API endpoints", "Where is X handled?"   │
│                                                              │
│  Custom Subagents (.opencode/agent/*.md)                    │
│  └─ You can define your own specialized agents              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent Modes Explained

Every agent has a `mode` that controls **where it can be used**:

### `mode: "primary"`
- **Can**: Be selected as your main agent in the TUI
- **Can**: Start conversations
- **Cannot**: Be delegated to via Task tool
- **Examples**: ARCHITECT, SUPERVISOR, PLAN

### `mode: "subagent"`
- **Can**: Be invoked by other agents via Task tool
- **Can**: Work on subtasks
- **Cannot**: Be selected as primary in TUI
- **Examples**: GENERAL, EXPLORE

### `mode: "all"`
- **Can**: Be used as primary OR subagent
- **Most flexible**
- **Example**: BUILD (you can talk to it directly OR delegate to it)

---

## Where Agents Are Defined

### Built-in Agents

**File**: `packages/opencode/src/agent/agent.ts:95-170`

```typescript
const result: Record<string, Info> = {
  general: {
    name: "general",
    description: "General-purpose agent for researching...",
    mode: "subagent",
    builtIn: true,
  },
  build: {
    name: "build",
    mode: "all",  // Can be primary OR subagent
    builtIn: true,
  },
  architect: {
    name: "architect",
    description: "Top-level agent that reads project specs...",
    mode: "primary",
    builtIn: true,
  },
  // ... etc
}
```

**What's happening**: This object defines all the built-in agents OpenCode ships with.

### Custom Agents

**Location**: `.opencode/agent/*.md` files

**Example**: `.opencode/agent/code-reviewer.md`
```markdown
---
description: Reviews code for bugs and suggests improvements
mode: subagent
tools:
  read: true
  write: false
  bash: false
temperature: 0.3
---

You are a meticulous code reviewer. When reviewing code:
1. Look for bugs and edge cases
2. Suggest performance improvements
3. Check for security vulnerabilities
4. Ensure code follows project conventions

Be constructive and specific in your feedback.
```

**What happens**:
1. OpenCode reads all `.md` files in `.opencode/agent/`
2. Parses the YAML frontmatter (the stuff between `---`)
3. Uses the markdown body as the agent's system prompt
4. Registers the agent with the name matching the filename

**Code**: `packages/opencode/src/config/config.ts:238-267`

---

## How Agent Selection Works

### You Choose Primary Agent
In the TUI, you select which primary agent to talk to. This is stored in your session.

### LLM Chooses Subagents
When a primary agent wants help, it uses the **Task tool** to delegate:

```typescript
// What the LLM does internally:
Task({
  subagent_type: "general",
  description: "Find authentication code",
  prompt: "Search the codebase for authentication implementation"
})
```

**How the LLM picks**:
1. Task tool shows list of available subagents in its description
2. LLM reads agent descriptions
3. Picks the most suitable one based on the task

**File**: `packages/opencode/src/tool/task.ts:13-16`

```typescript
const agents = await Agent.list().then((x) => 
  x.filter((a) => a.mode !== "primary")  // Only show subagents
)
```

---

## Agent Configuration Options

Every agent can be customized with these fields:

### Core Identity
- `name`: Unique identifier (matches filename for custom agents)
- `description`: What the agent is good at (shown to LLMs)
- `mode`: `"primary"`, `"subagent"`, or `"all"`
- `prompt`: Custom system prompt (overrides defaults)

### Model Settings
- `model`: Specific LLM to use (e.g., `"claude-3-5-sonnet-20241022"`)
- `temperature`: Creativity (0.0-1.0, lower = more focused)
- `top_p`: Nucleus sampling (0.0-1.0)

### Tool Access
- `tools`: Which tools the agent can use
  ```yaml
  tools:
    read: true
    write: true
    bash: false
    task: true
  ```

### Permissions
- `permission`: Fine-grained control over tool behavior
  ```yaml
  permission:
    bash:
      mode: ask  # or "allow", "deny"
    edit:
      mode: allow
  ```

### UI
- `color`: Terminal color for this agent's messages

---

## How Agents Get Their Prompts

This is the **order of precedence** for system prompts:

1. **Agent's custom prompt** (if specified in agent config)
2. **Default provider prompt** (from `src/session/system-prompt.ts`)
3. **Header prompt** (provider-specific formatting)
4. **Environment prompt** (git status, file context, etc.)
5. **Custom prompts** (from `.opencode/prompt/*.md`)

**Code**: `packages/opencode/src/session/prompt.ts:545-564`

```typescript
async function resolveSystemPrompt(input: {
  agent: Agent.Info
  providerID: string
  modelID: string
}) {
  let system = SystemPrompt.header(input.providerID)
  
  // Agent's custom prompt wins
  system.push(
    input.agent.prompt 
      ? [input.agent.prompt] 
      : SystemPrompt.provider(input.modelID)
  )
  
  system.push(...await SystemPrompt.environment())
  system.push(...await SystemPrompt.custom())
  
  return system
}
```

---

## How Tools Are Assigned to Agents

### Default Tool Access

Each agent type has default tool permissions:

**File**: `packages/opencode/src/tool/registry.ts`

```typescript
// Example: PLAN agent has limited tools
if (agent.name === "plan") {
  return {
    bash: false,
    write: false,
    edit: false,
    // ... read-only tools enabled
  }
}
```

### Overriding Tools

**In agent config**:
```yaml
tools:
  bash: false  # Disable bash for safety
  custom_tool: true  # Enable custom MCP tool
```

**In Task tool invocation** (`task.ts:66-72`):
```typescript
tools: {
  todowrite: false,  // Always disabled in subagents
  todoread: false,
  task: false,       // Prevent recursive delegation
  ...agent.tools,    // Agent's configured tools
}
```

---

## The Agent Lifecycle

### 1. Agent Registration (Startup)

```
App Starts
  ├─ Load built-in agents (agent.ts:95-170)
  ├─ Scan .opencode/agent/*.md
  ├─ Parse frontmatter + markdown
  └─ Register in agent registry
```

**Code**: `packages/opencode/src/agent/agent.ts:179-181`

### 2. Session Creation

```
User creates session
  ├─ Selects primary agent (or defaults to BUILD)
  ├─ Session stores agent name
  └─ Agent config loaded from registry
```

**Code**: `packages/opencode/src/session/prompt.ts:221`

### 3. Message Processing

```
User sends message
  ├─ Load agent config
  ├─ Build system prompt (agent.prompt or defaults)
  ├─ Resolve tools (agent.tools + permissions)
  ├─ Call LLM with agent context
  └─ Execute tool calls with agent permissions
```

**Code**: `packages/opencode/src/session/prompt.ts:196-450`

### 4. Subagent Delegation

```
Agent decides to delegate
  ├─ Calls Task tool
  ├─ Task creates NEW child session
  ├─ Child session uses delegated agent
  ├─ Child executes with restricted tools
  └─ Returns result to parent
```

**Code**: `packages/opencode/src/tool/task.ts:28-89`

---

## Key Files Reference

### Agent System Core
- **Agent Registry**: `packages/opencode/src/agent/agent.ts`
  - Defines built-in agents (line 95-170)
  - Agent.get(), Agent.list() functions (line 179-185)
  - Agent configuration schema (line 6-42)

### Configuration Loading
- **Config Parser**: `packages/opencode/src/config/config.ts`
  - Loads custom agents from `.opencode/agent/*.md` (line 238-267)
  - Agent schema validation (line 361-376)
  - Merges built-in + custom agents

### Agent Execution
- **Session Prompt**: `packages/opencode/src/session/prompt.ts`
  - Main prompt() function (line 196)
  - Agent selection (line 221)
  - System prompt resolution (line 545-564)
  - Tool resolution (line 566-626)

### Delegation
- **Task Tool**: `packages/opencode/src/tool/task.ts`
  - Subagent invocation (line 28)
  - Child session creation (line 31-33)
  - Tool restriction for subagents (line 66-72)

---

## Common Patterns

### Creating a Research Agent

```markdown
# .opencode/agent/researcher.md
---
description: Deep-dives into documentation and codebases
mode: subagent
tools:
  read: true
  grep: true
  webfetch: true
  write: false
---

You are a thorough researcher. When asked to research:
1. Search multiple sources
2. Cross-reference information
3. Summarize findings clearly
4. Cite specific files and line numbers
```

### Creating a Safety-First Agent

```markdown
# .opencode/agent/safe-builder.md
---
description: Cautious builder that asks before risky operations
mode: primary
temperature: 0.2
permission:
  bash:
    mode: ask
  edit:
    mode: allow
  write:
    mode: ask
---

You are a careful developer. Always:
- Explain what you're about to do
- Ask before running shell commands
- Validate inputs before writing files
```

---

## Debugging Agents

### See Which Agent Is Active

**In TUI**: Look for the agent name in the session title or message headers

**In Code**: Check session messages:
```typescript
const msg = await MessageV2.get({ sessionID, messageID })
console.log(msg.info.mode)  // Agent name that created this message
```

### See Available Agents

```bash
# In OpenCode TUI
/list-agents  # If such a command exists

# Or check the files:
ls .opencode/agent/
cat packages/opencode/src/agent/agent.ts
```

### Test Custom Agent

1. Create `.opencode/agent/test.md`
2. Set `mode: subagent`
3. In TUI, ask primary agent: "Use the test subagent to help with X"
4. Watch for Task tool invocation with `subagent_type: "test"`

---

## FAQ

**Q: Can subagents delegate to other subagents?**
A: No, `task: false` is hardcoded in task.ts:68. Prevents infinite recursion.

**Q: Can I have multiple agents active at once?**
A: Only one primary agent per session, but it can spawn multiple subagent child sessions.

**Q: How do I change the default agent?**
A: Edit `.opencode/opencode.json` and add `"agent": "architect"` (or plan, etc.)

**Q: Why does my custom agent not appear?**
A: Check:
  1. File is in `.opencode/agent/` directory
  2. Has valid YAML frontmatter
  3. `mode` is set correctly
  4. Restart OpenCode to reload configs

**Q: Can agents share memory between invocations?**
A: Currently NO (but you're building this feature!). Each Task invocation creates isolated child session.

---

## Next Steps

Read these companion docs:
- `FOR_HUMANS_SESSIONS.md` - How conversations and state work
- `FOR_HUMANS_TOOLS.md` - What tools agents can use
- `FOR_HUMANS_DELEGATION.md` - Deep dive on Task tool and subagents

---

## The Mental Model

Think of OpenCode like a **consulting firm**:

- **You're the client** - You come with a problem
- **Primary agents are partners** - They take the lead on your project
- **Subagents are specialists** - Partners bring them in for specific expertise
- **Sessions are projects** - Each has a lead partner and a team
- **Tools are capabilities** - What the team can actually do (coding, research, etc.)

When you ask BUILD to implement a feature, it might delegate to GENERAL to research the codebase first. Just like a partner bringing in a specialist researcher before writing code.

The problem you're solving: Currently, specialists forget everything after each consultation. You're building persistent memory so they can have ongoing conversations.
