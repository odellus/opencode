# FOR HUMANS: How OpenCode Tools Work

> Everything agents can actually DO - explained without the jargon.

---

## What's a Tool?

A **tool** is a capability that an AI agent can use to interact with your system. Think of tools as the agent's hands - they're how it actually gets work done.

**Real-world analogy**: Like apps on your phone - each tool does one specific thing (camera takes photos, maps shows directions, etc.)

---

## The Tool Menu

### File Operations
- **Read** - Read file contents
- **Write** - Create new files
- **Edit** - Modify existing files with find/replace
- **Glob** - Find files by pattern (like `**/*.ts`)

### Code Search
- **Grep** - Search file contents with regex
- **LSP** - Language server integration (hover, diagnostics, etc.)

### Execution
- **Bash** - Run shell commands
- **NotebookEdit** - Edit Jupyter notebooks

### Research
- **WebFetch** - Fetch and analyze web pages
- **WebSearch** - Search the internet

### Agent Coordination
- **Task** - Delegate work to subagents
- **TodoWrite** - Track task progress
- **TodoRead** - View current todos

### Plugin Tools
- **MCP Tools** - Model Context Protocol integrations
- **Custom Tools** - Project-specific tools you define

---

## How Tools Work

### The Tool Interface

Every tool implements this structure:

**File**: `packages/opencode/src/tool/tool.ts:10-38`

```typescript
{
  name: "read",
  description: "Reads a file from the filesystem",
  
  parameters: {
    // Zod schema defining inputs
    file_path: z.string(),
    limit: z.number().optional(),
    offset: z.number().optional()
  },
  
  execute: async (input, context) => {
    // Do the work
    const content = await Bun.file(input.file_path).text()
    
    // Return result
    return {
      title: "Read file.ts",
      output: content,
      metadata: { ... }
    }
  }
}
```

### The Execution Flow

```
1. LLM decides to use a tool
   ├─ "I need to read auth.ts to understand it"
   └─ Generates: { tool: "read", input: { file_path: "auth.ts" } }

2. OpenCode validates the input
   ├─ Checks parameters match schema
   └─ Checks agent has permission to use this tool

3. Tool executes
   ├─ Runs the execute() function
   └─ Returns result

4. Result goes back to LLM
   └─ "Here's the content of auth.ts: [file content]"

5. LLM decides next action
   └─ "Now I'll edit it to add the login function"
```

**Code**: `packages/opencode/src/session/prompt.ts:1300-1500` (tool execution loop)

---

## Tool Deep Dives

### Read Tool

**File**: `packages/opencode/src/tool/read.ts`

**What it does**: Reads files from disk

**Parameters**:
```typescript
{
  file_path: string,          // Absolute path
  offset?: number,            // Start from line N (default: 1)
  limit?: number              // Read N lines (default: 2000)
}
```

**Example LLM usage**:
```json
{
  "tool": "read",
  "input": {
    "file_path": "/home/user/project/src/auth.ts",
    "offset": 50,
    "limit": 100
  }
}
```

**Returns**:
```typescript
{
  title: "Read auth.ts",
  output: "// File contents here...",
  metadata: {
    lines: [50, 150],
    total_lines: 500
  }
}
```

**Special features**:
- Auto-truncates large files
- Supports images (returns base64)
- Tracks file access for snapshots

---

### Edit Tool

**File**: `packages/opencode/src/tool/edit.ts`

**What it does**: Exact string replacement in files

**Parameters**:
```typescript
{
  file_path: string,
  old_string: string,         // Must be EXACT match
  new_string: string,
  replace_all?: boolean       // Replace all occurrences (default: false)
}
```

**Example**:
```json
{
  "tool": "edit",
  "input": {
    "file_path": "auth.ts",
    "old_string": "function login() {",
    "new_string": "async function login() {",
    "replace_all": false
  }
}
```

**Critical**:
- `old_string` must match EXACTLY (including whitespace)
- If not unique, edit fails (unless `replace_all: true`)
- Agent must Read the file first (enforced)

**Why exact matching**: Prevents accidental partial replacements. Forces LLM to be precise.

---

### Bash Tool

**File**: `packages/opencode/src/tool/bash.ts`

**What it does**: Runs shell commands

**Parameters**:
```typescript
{
  command: string,
  description?: string,       // Human-readable explanation
  run_in_background?: boolean,
  timeout?: number            // Max 120000ms
}
```

**Example**:
```json
{
  "tool": "bash",
  "input": {
    "command": "npm test",
    "description": "Run test suite"
  }
}
```

**Returns**:
```typescript
{
  output: "stdout + stderr combined",
  exit_code: 0,
  shell_id: "shell_abc123"  // If background
}
```

**Safety features**:
- Permission system (allow/deny/ask)
- Timeout enforcement
- Working directory isolation
- Background process management

---

### Task Tool

**File**: `packages/opencode/src/tool/task.ts`

**What it does**: Delegates work to subagents

**Parameters**:
```typescript
{
  subagent_type: string,      // Which agent to invoke
  description: string,        // Short title (3-5 words)
  prompt: string              // Full task instructions
}
```

**Example**:
```json
{
  "tool": "task",
  "input": {
    "subagent_type": "general",
    "description": "Find auth code",
    "prompt": "Search the codebase for authentication implementation. Look for login/logout functions and return file paths."
  }
}
```

**What happens**:
1. Creates new child session
2. Loads specified agent (e.g., "general")
3. Restricts tools (no TodoWrite, no recursive Task)
4. Executes agent with the prompt
5. Returns final text response to parent

**Current limitation**: Child forgets everything after returning. (You're fixing this!)

---

### Grep Tool

**File**: `packages/opencode/src/tool/grep.ts`

**What it does**: Searches file contents with regex

**Parameters**:
```typescript
{
  pattern: string,            // Regex pattern
  path?: string,              // Where to search (default: cwd)
  glob?: string,              // File filter (e.g., "*.ts")
  type?: string,              // File type (e.g., "typescript")
  output_mode?: "content" | "files_with_matches" | "count",
  "-i"?: boolean,             // Case insensitive
  "-A"?: number,              // Lines after match
  "-B"?: number,              // Lines before match
  multiline?: boolean         // Multi-line patterns
}
```

**Example**:
```json
{
  "tool": "grep",
  "input": {
    "pattern": "function login",
    "glob": "**/*.ts",
    "output_mode": "content",
    "-n": true
  }
}
```

**Modes**:
- `content`: Show matching lines
- `files_with_matches`: Just filenames
- `count`: Count of matches per file

---

### WebFetch Tool

**File**: `packages/opencode/src/tool/web-fetch.ts`

**What it does**: Fetches and analyzes web content

**Parameters**:
```typescript
{
  url: string,
  prompt: string              // What to extract from the page
}
```

**Example**:
```json
{
  "tool": "webfetch",
  "input": {
    "url": "https://docs.example.com/api",
    "prompt": "Extract all API endpoint URLs and their methods"
  }
}
```

**What happens**:
1. Fetches URL (converts HTTP→HTTPS)
2. Converts HTML to markdown
3. Sends to small LLM with your prompt
4. Returns extracted info

**Features**:
- 15-minute cache
- Redirect handling
- Markdown conversion for better parsing

---

## Tool Registry

Tools are registered at startup and filtered per agent.

**File**: `packages/opencode/src/tool/registry.ts:20-80`

```typescript
async function tools(providerID: string, modelID: string) {
  const tools = []
  
  // Built-in tools
  tools.push(await BashTool())
  tools.push(await ReadTool())
  tools.push(await EditTool())
  tools.push(await WriteTool())
  tools.push(await GrepTool())
  tools.push(await GlobTool())
  tools.push(await TaskTool())
  // ... etc
  
  // MCP tools (plugins)
  for (const mcp of await MCP.list()) {
    tools.push(...await mcp.tools())
  }
  
  return tools
}
```

### Tool Filtering

**By provider**: Some tools don't work with certain LLMs

```typescript
// Example: WebSearch only for providers that support it
if (providerID === "openai" && !modelID.includes("search")) {
  // Exclude WebSearch tool
}
```

**By agent**: Agents have tool allowlists/denylists

```typescript
// PLAN agent has limited tools
if (agent.name === "plan") {
  tools = {
    read: true,
    grep: true,
    glob: true,
    write: false,    // No writing in plan mode
    bash: false,     // No execution
    edit: false
  }
}
```

**Code**: `packages/opencode/src/tool/registry.ts:82-150`

---

## Permission System

Every tool can have permissions: `allow`, `deny`, or `ask`

**File**: `packages/opencode/src/agent/agent.ts:18-34`

```typescript
permission: {
  bash: {
    mode: "ask",              // Prompt user before running
    patterns: ["rm -rf *"]    // Specific commands to block
  },
  edit: {
    mode: "allow"             // Auto-approve
  },
  write: {
    mode: "deny"              // Block completely
  }
}
```

### Permission Levels

**allow**: Tool executes automatically, no prompt

**ask**: User must approve each usage
```
Agent wants to run: npm install
[Allow] [Deny] [Allow All]
```

**deny**: Tool call fails immediately
```
Error: bash tool is disabled for this agent
```

### Permission Hierarchy

1. **Agent-level** permissions (in agent config)
2. **Tool-level** defaults (hardcoded per tool)
3. **User-level** overrides (in `.opencode/opencode.json`)

**Code**: `packages/opencode/src/permission/permission.ts`

---

## Tool Lifecycle

### 1. Registration (App Startup)

```
App Starts
  ├─ Load built-in tools (registry.ts)
  ├─ Load MCP tools (plugin system)
  └─ Index tools by provider/model
```

### 2. Resolution (Per Message)

```
Agent starts working on message
  ├─ Get agent config
  ├─ Get provider/model capabilities
  ├─ Filter tools:
  │   ├─ Provider compatibility
  │   ├─ Agent allow/deny list
  │   └─ User permissions
  └─ Send tool list to LLM
```

**Code**: `packages/opencode/src/session/prompt.ts:566-626`

### 3. Invocation (During Message)

```
LLM decides to use tool
  ├─ Generates tool call JSON
  ├─ OpenCode validates schema
  ├─ Check permissions
  │   ├─ If "allow" → execute
  │   ├─ If "ask" → prompt user
  │   └─ If "deny" → return error
  ├─ Execute tool
  └─ Return result to LLM
```

**Code**: `packages/opencode/src/session/prompt.ts:1300-1500`

### 4. Result Handling

```
Tool returns result
  ├─ Store as MessageV2.ToolPart
  ├─ Include in next LLM context
  └─ LLM decides what to do next
      ├─ Use another tool
      ├─ Return final text
      └─ Or both
```

---

## Tool Restrictions for Subagents

When agents delegate via Task tool, child agents have restricted tools:

**File**: `packages/opencode/src/tool/task.ts:66-72`

```typescript
tools: {
  todowrite: false,      // Can't manage todos
  todoread: false,
  task: false,           // Can't delegate further (no recursion)
  ...agent.tools         // Agent's configured tools
}
```

**Why**:
- **No todos**: Prevents subagent todos polluting parent
- **No recursion**: Prevents infinite delegation chains
- **Agent-specific**: Subagents can still have specialized toolsets

---

## Custom Tools via MCP

You can add tools using Model Context Protocol:

**Example**: Add a database query tool

```typescript
// .opencode/mcp/database.ts
export const DatabaseTool = {
  name: "query_db",
  description: "Query the application database",
  parameters: z.object({
    sql: z.string(),
    limit: z.number().default(100)
  }),
  async execute(input) {
    const result = await db.query(input.sql).limit(input.limit)
    return {
      title: "Database query",
      output: JSON.stringify(result, null, 2)
    }
  }
}
```

**Registration**: MCP servers automatically register their tools

**Code**: `packages/opencode/src/mcp/mcp.ts`

---

## Tool Development Pattern

### Creating a New Tool

**File**: `packages/opencode/src/tool/your-tool.ts`

```typescript
import { Tool } from "./tool"
import z from "zod"

export const YourTool = Tool.define("your_tool", async () => {
  return {
    description: "What this tool does (shown to LLM)",
    
    parameters: z.object({
      required_param: z.string().describe("What this param does"),
      optional_param: z.number().optional().describe("Optional param")
    }),
    
    async execute(input, context) {
      // input: validated parameters
      // context: { sessionID, messageID, abort, metadata() }
      
      // Do the work
      const result = await doSomething(input.required_param)
      
      // Return
      return {
        title: "Short title for UI",
        output: "Text returned to LLM",
        metadata: {
          // Extra info for UI/debugging
          custom_field: result.data
        }
      }
    }
  }
})
```

### Register the Tool

**File**: `packages/opencode/src/tool/registry.ts`

```typescript
import { YourTool } from "./your-tool"

async function tools(providerID: string, modelID: string) {
  const tools = []
  // ... existing tools
  tools.push(await YourTool())
  return tools
}
```

### Add Tests

**File**: `packages/opencode/test/tool/your-tool.test.ts`

```typescript
import { test, expect } from "bun:test"
import { YourTool } from "../../src/tool/your-tool"

test("your tool works", async () => {
  const tool = await YourTool()
  const result = await tool.execute(
    { required_param: "test" },
    { sessionID: "test_session" }
  )
  expect(result.output).toContain("expected")
})
```

---

## Key Files Reference

### Core Tool System
- **Tool Definition**: `packages/opencode/src/tool/tool.ts`
  - Tool.define() helper (line 10-38)
  - Tool interface

- **Tool Registry**: `packages/opencode/src/tool/registry.ts`
  - tools() - lists all tools (line 20)
  - enabled() - filters by agent (line 82)

### Individual Tools
- **Bash**: `packages/opencode/src/tool/bash.ts`
- **Read**: `packages/opencode/src/tool/read.ts`
- **Edit**: `packages/opencode/src/tool/edit.ts`
- **Write**: `packages/opencode/src/tool/write.ts`
- **Grep**: `packages/opencode/src/tool/grep.ts`
- **Glob**: `packages/opencode/src/tool/glob.ts`
- **Task**: `packages/opencode/src/tool/task.ts`
- **WebFetch**: `packages/opencode/src/tool/web-fetch.ts`
- **WebSearch**: `packages/opencode/src/tool/web-search.ts`

### Execution
- **Tool Invocation**: `packages/opencode/src/session/prompt.ts`
  - Tool resolution (line 566)
  - Tool execution loop (line 1300)

### Permissions
- **Permission System**: `packages/opencode/src/permission/permission.ts`
  - Permission.check()
  - Permission.prompt()

---

## Common Patterns

### Tool with State Tracking

```typescript
export const StatefulTool = Tool.define("stateful", async () => {
  const state = new Map()  // Persist across invocations
  
  return {
    description: "Tool that remembers state",
    parameters: z.object({ key: z.string() }),
    async execute(input, ctx) {
      const value = state.get(input.key)
      state.set(input.key, Date.now())
      return { output: `Last seen: ${value}` }
    }
  }
})
```

### Tool with Streaming

```typescript
export const StreamingTool = Tool.define("streaming", async () => {
  return {
    description: "Tool that streams updates",
    parameters: z.object({ duration: z.number() }),
    async execute(input, ctx) {
      for (let i = 0; i < input.duration; i++) {
        ctx.metadata({
          title: `Progress: ${i}/${input.duration}`,
          metadata: { progress: i / input.duration }
        })
        await new Promise(r => setTimeout(r, 1000))
      }
      return { output: "Done!" }
    }
  }
})
```

### Tool with Abort Handling

```typescript
export const LongTool = Tool.define("long", async () => {
  return {
    description: "Long-running tool that respects abort",
    parameters: z.object({}),
    async execute(input, ctx) {
      const promise = doLongWork()
      
      ctx.abort.addEventListener("abort", () => {
        promise.cancel()
      })
      
      const result = await promise
      return { output: result }
    }
  }
})
```

---

## Debugging Tools

### See Which Tools Were Used

```typescript
const messages = await Session.messages({ sessionID })
for (const msg of messages) {
  const toolParts = msg.parts.filter(p => p.type === "tool")
  for (const tool of toolParts) {
    console.log(tool.tool, tool.state.input)
  }
}
```

### Test a Tool Directly

```typescript
import { ReadTool } from "./src/tool/read"

const tool = await ReadTool()
const result = await tool.execute(
  { file_path: "test.ts" },
  { sessionID: "test", messageID: "test", abort: new AbortController().signal }
)
console.log(result.output)
```

### Check Tool Permissions

```typescript
import { Permission } from "./src/permission/permission"

const allowed = await Permission.check({
  tool: "bash",
  agent: agentConfig,
  input: { command: "rm -rf /" }
})
console.log(allowed)  // true/false
```

---

## FAQ

**Q: Can I disable tools globally?**
A: Yes, in `.opencode/opencode.json`:
```json
{
  "tools": {
    "bash": false,
    "write": false
  }
}
```

**Q: How do I see tool calls in the UI?**
A: They appear as collapsible sections in the TUI. Click to expand.

**Q: Can tools call other tools?**
A: No, only LLMs can orchestrate tool calls. Tools are single-purpose functions.

**Q: What if a tool fails?**
A: Error is returned to LLM as tool result. LLM can retry or take different approach.

**Q: Are tool calls atomic?**
A: No, each tool call is independent. Use transactions in your tool logic if needed.

**Q: Can I rate-limit tools?**
A: Not built-in, but you can implement in your tool's execute() function.

---

## The Mental Model

Think of tools like **API endpoints**:

- **LLM is the client** - Makes requests to tools
- **Tool is the server** - Processes requests, returns results
- **Parameters are the request body** - Validated by Zod schemas
- **Result is the response** - Goes back to LLM for next decision
- **Permissions are middleware** - Check before executing
- **Context is headers** - Session ID, message ID, abort signal

The LLM orchestrates multiple tool calls to accomplish tasks. Like a human using multiple apps to complete a project.

Your role: Building tools that are reliable, safe, and well-documented so LLMs can use them effectively.
