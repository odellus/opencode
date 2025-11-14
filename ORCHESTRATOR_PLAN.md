# OpenCode Orchestrator System - Implementation Plan

## Executive Summary

Build a standalone orchestrator that supervises OpenCode sessions via HTTP API. The orchestrator acts as a "project manager agent" that breaks down projects into tasks, monitors a "doer agent" (running in OpenCode), detects anti-patterns, and provides feedback to keep work progressing correctly.

**Key Philosophy:** Human-in-the-Loop (HITL) where the H is another agent with longer-timescale thinking and higher standards.

---

## 1. Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR (Standalone TypeScript App)                   │
│  ┌────────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Task Manager   │  │ Anti-Pattern │  │ LLM Interface  │  │
│  │                │  │ Detector     │  │ (Claude/Qwen)  │  │
│  └────────────────┘  └──────────────┘  └────────────────┘  │
│           │                  │                  │           │
│           └──────────────────┴──────────────────┘           │
│                              │                              │
│                    ┌─────────▼─────────┐                    │
│                    │ OpenCode SDK      │                    │
│                    │ (HTTP Client)     │                    │
│                    └─────────┬─────────┘                    │
└──────────────────────────────┼──────────────────────────────┘
                               │ HTTP/SSE
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  OPENCODE SERVER (localhost:4096)                           │
│  ┌────────────┐  ┌──────────┐  ┌────────────┐              │
│  │ Session    │  │ Messages │  │ File       │              │
│  │ Management │  │ & Events │  │ Operations │              │
│  └────────────┘  └──────────┘  └────────────┘              │
│                       │                                      │
│              ┌────────▼────────┐                            │
│              │ DOER AGENT      │                            │
│              │ (OpenCode Agent)│                            │
│              └─────────────────┘                            │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Orchestrator** → Creates session via `POST /session`
2. **Orchestrator** → Injects task via `POST /session/:id/message`
3. **Doer** → Works, makes tool calls, edits files
4. **Doer** → Asks question or says "done" (text message, no tool calls)
5. **Orchestrator** ← Detects via `GET /event` SSE stream (`session.idle` event)
6. **Orchestrator** → Reads messages via `GET /session/:id/message`
7. **Orchestrator** → Checks changes via `GET /file/status`
8. **Orchestrator** → Uses LLM to analyze work and decide action
9. **Orchestrator** → Injects response/correction via `POST /session/:id/message`
10. **Loop back to step 3**

### Where Things Run

- **Orchestrator**: Separate process, can run anywhere (same machine or remote)
- **OpenCode Server**: Local or remote, exposes HTTP API (default: `http://localhost:4096`)
- **Doer Agent**: Inside OpenCode process, doesn't know it's supervised

---

## 2. File Structure

```
orchestrator/
├── src/
│   ├── index.ts              # Main entry point & CLI
│   ├── orchestrator.ts       # Core orchestration loop
│   ├── session.ts            # OpenCode session management
│   ├── monitor.ts            # SSE event monitoring
│   ├── detector.ts           # Anti-pattern detection
│   ├── analyzer.ts           # LLM-powered work analysis
│   ├── state.ts              # State persistence (JSON/SQLite)
│   ├── prompts.ts            # LLM prompt templates
│   ├── types.ts              # TypeScript interfaces
│   └── config.ts             # Configuration management
├── package.json
├── tsconfig.json
├── orchestrator.config.json  # User configuration
└── README.md
```

---

## 3. Key Interfaces

### TypeScript Types

```typescript
// types.ts

export interface Task {
  id: string
  description: string
  status: "pending" | "active" | "done" | "failed"
  retryCount: number
  sessionID?: string
  startTime?: number
  endTime?: number
  error?: string
}

export interface ProjectState {
  projectDescription: string
  tasks: Task[]
  currentTaskIndex: number
  completedWork: string[]
  antiPatterns: AntiPatternDetection[]
  createdAt: number
  updatedAt: number
}

export interface AntiPatternDetection {
  type: "mock_cascade" | "infinite_loop" | "printless_testing" | "reward_hacking" | "analysis_paralysis"
  taskID: string
  sessionID: string
  timestamp: number
  evidence: string
  intervention: string
}

export interface WorkAnalysis {
  quality: number // 0-100
  hasChanges: boolean
  testsPass: boolean
  antiPatterns: AntiPatternDetection[]
  recommendation: "approve" | "retry" | "escalate"
  feedback?: string
}

export interface OrchestratorConfig {
  opencode: {
    serverUrl: string
    requestTimeout?: number  // milliseconds, 0 = infinite
  }
  model: {
    provider: "anthropic" | "openai" | "openrouter" | "local"
    model: string
    apiKey?: string
    baseUrl?: string  // for local models
  }
  monitoring: {
    pollIntervalSeconds: number
    idleThresholdSeconds: number
    useSSE: boolean  // prefer SSE over polling
  }
  thresholds: {
    maxRetries: number
    loopDetectionCount: number
    qualityScoreMinimum: number
  }
}
```

---

## 4. Detection Logic

### Anti-Pattern Detectors

```typescript
// detector.ts

export class AntiPatternDetector {

  // Mock Cascade: Multiple mocks without real implementation
  detectMockCascade(messages: Message[]): AntiPatternDetection | null {
    const recentEdits = this.getRecentToolCalls(messages, "Edit", 10)
    const mockCount = recentEdits.filter(edit =>
      /mock\(|stub\(|jest\.fn\(|vi\.fn\(/i.test(edit.input.new_string)
    ).length

    if (mockCount >= 5) {
      return {
        type: "mock_cascade",
        evidence: `${mockCount} consecutive edits adding mocks/stubs`,
        intervention: "Stop mocking everything. Implement the actual functionality first. Tests should verify real behavior, not mocks."
      }
    }
    return null
  }

  // Infinite Loop: Same command repeatedly
  detectInfiniteLoop(messages: Message[]): AntiPatternDetection | null {
    const recentBash = this.getRecentToolCalls(messages, "Bash", 10)
    if (recentBash.length < 5) return null

    const commands = recentBash.map(b => b.input.command)
    const uniqueCommands = new Set(commands)

    // Same command 5+ times in a row
    if (uniqueCommands.size === 1 && commands.length >= 5) {
      return {
        type: "infinite_loop",
        evidence: `Command "${commands[0]}" run ${commands.length} times`,
        intervention: "You're running the same command repeatedly. READ THE ERROR MESSAGE. What needs to change in the code?"
      }
    }
    return null
  }

  // Printless Testing: Test edits without debug output
  detectPrintlessTesting(messages: Message[]): AntiPatternDetection | null {
    const recentEdits = this.getRecentToolCalls(messages, "Edit", 5)
    const testFileEdits = recentEdits.filter(edit =>
      /test|spec/i.test(edit.input.file_path)
    )

    if (testFileEdits.length === 0) return null

    const hasDebugOutput = testFileEdits.some(edit =>
      /console\.log|print\(|println!|fmt\.Println|Debug\.|log\./i.test(edit.input.new_string)
    )

    if (!hasDebugOutput) {
      return {
        type: "printless_testing",
        evidence: `${testFileEdits.length} test file edits without debug output`,
        intervention: "Add debug output to see what's actually happening. Don't guess - inspect the data with console.log/print/println."
      }
    }
    return null
  }

  // Reward Hacking: Claims done but no changes
  detectRewardHacking(
    messages: Message[],
    fileStatus: FileStatus[]
  ): AntiPatternDetection | null {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role !== "assistant") return null

    const claimsDone = /done|complete|finished|implemented/i.test(
      this.getTextContent(lastMessage)
    )

    if (!claimsDone) return null

    const meaningfulChanges = fileStatus.filter(f =>
      f.status === "modified" || f.status === "added"
    ).length

    if (meaningfulChanges === 0) {
      return {
        type: "reward_hacking",
        evidence: "Claims task complete but no file changes detected",
        intervention: "I don't see the changes. Show me what you actually implemented. Run git diff or describe the specific files modified."
      }
    }
    return null
  }

  // Analysis Paralysis: Lots of talking, no doing
  detectAnalysisParalysis(messages: Message[]): AntiPatternDetection | null {
    const recent = messages.slice(-10)
    const assistantMessages = recent.filter(m => m.role === "assistant")

    if (assistantMessages.length < 5) return null

    const hasToolCalls = assistantMessages.some(m =>
      m.parts.some(p => p.type === "tool")
    )

    if (!hasToolCalls) {
      return {
        type: "analysis_paralysis",
        evidence: "5+ assistant messages without any tool calls",
        intervention: "Enough planning. Write code. Make changes now. Stop thinking and start doing."
      }
    }
    return null
  }

  private getRecentToolCalls(
    messages: Message[],
    toolName: string,
    limit: number
  ): any[] {
    const toolCalls = []
    for (let i = messages.length - 1; i >= 0 && toolCalls.length < limit; i--) {
      const msg = messages[i]
      if (msg.role === "assistant") {
        const tools = msg.parts.filter(p =>
          p.type === "tool" && p.tool === toolName
        )
        toolCalls.push(...tools)
      }
    }
    return toolCalls.slice(0, limit)
  }
}
```

### Quality Scoring

```typescript
// analyzer.ts

export class WorkAnalyzer {

  async scoreTaskCompletion(
    task: Task,
    messages: Message[],
    fileStatus: FileStatus[],
    llm: LLMClient
  ): Promise<WorkAnalysis> {

    // Quick checks first
    const hasChanges = fileStatus.some(f =>
      f.status === "modified" || f.status === "added"
    )

    const testsPass = await this.checkTestResults(messages)
    const antiPatterns = this.detectAllPatterns(messages, fileStatus)

    // Use LLM for quality assessment
    const quality = await this.assessQuality(task, messages, llm)

    let recommendation: "approve" | "retry" | "escalate"
    let feedback: string | undefined

    if (quality >= 70 && hasChanges && testsPass && antiPatterns.length === 0) {
      recommendation = "approve"
    } else if (task.retryCount >= 3) {
      recommendation = "escalate"
      feedback = "Task failed 3 times. Human intervention needed."
    } else {
      recommendation = "retry"
      feedback = this.generateFeedback(quality, hasChanges, testsPass, antiPatterns)
    }

    return {
      quality,
      hasChanges,
      testsPass,
      antiPatterns,
      recommendation,
      feedback
    }
  }

  private async assessQuality(
    task: Task,
    messages: Message[],
    llm: LLMClient
  ): Promise<number> {
    const prompt = `
Task: ${task.description}

Recent work:
${this.summarizeMessages(messages)}

Score this work from 0-100 based on:
- Does it address the task?
- Is the implementation correct?
- Are edge cases handled?
- Is the code quality good?

Respond with ONLY a number 0-100.
`
    const response = await llm.generate(prompt)
    return parseInt(response.trim()) || 0
  }

  private checkTestResults(messages: Message[]): boolean {
    // Look for bash tool outputs with test results
    const bashOutputs = messages
      .filter(m => m.role === "assistant")
      .flatMap(m => m.parts)
      .filter(p => p.type === "tool" && p.tool === "Bash")
      .map(p => p.state.status === "completed" ? p.state.output : "")

    // Check for test failure indicators
    const hasFailures = bashOutputs.some(output =>
      /FAIL|ERROR|failed|error/i.test(output) &&
      /test|spec|jest|vitest|pytest/i.test(output)
    )

    return !hasFailures
  }
}
```

---

## 5. Monitoring Strategy

### SSE Event Monitoring (Primary)

```typescript
// monitor.ts

export class SessionMonitor {
  private eventSource: EventSource | null = null
  private listeners: Map<string, (event: any) => void> = new Map()

  async startSSE(baseUrl: string): Promise<void> {
    this.eventSource = new EventSource(`${baseUrl}/event`)

    this.eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)

      // Key event: session.idle - doer is waiting for user
      if (data.type === "session.idle") {
        const handler = this.listeners.get(data.properties.sessionID)
        if (handler) handler(data)
      }

      // Other useful events
      if (data.type === "message.updated") {
        // Message was added/updated
      }
      if (data.type === "session.error") {
        // Error occurred
      }
    }

    this.eventSource.onerror = () => {
      console.error("SSE connection lost, reconnecting...")
      setTimeout(() => this.startSSE(baseUrl), 5000)
    }
  }

  onSessionIdle(sessionID: string, handler: () => void): void {
    this.listeners.set(sessionID, handler)
  }

  stop(): void {
    this.eventSource?.close()
    this.listeners.clear()
  }
}
```

### Polling Fallback

```typescript
export class SessionPoller {
  private intervals: Map<string, NodeJS.Timeout> = new Map()

  startPolling(
    sessionID: string,
    sdk: OpencodeClient,
    onIdle: () => void,
    intervalMs: number = 5000
  ): void {
    const interval = setInterval(async () => {
      const messages = await sdk.session.messages({ path: { id: sessionID } })
      const lastMsg = messages.data[messages.data.length - 1]

      // Doer is idle if last message is from assistant with no pending tools
      if (lastMsg.role === "assistant") {
        const hasPendingTools = lastMsg.parts.some(p =>
          p.type === "tool" &&
          (p.state.status === "pending" || p.state.status === "running")
        )

        if (!hasPendingTools) {
          onIdle()
        }
      }
    }, intervalMs)

    this.intervals.set(sessionID, interval)
  }

  stop(sessionID: string): void {
    const interval = this.intervals.get(sessionID)
    if (interval) {
      clearInterval(interval)
      this.intervals.delete(sessionID)
    }
  }
}
```

---

## 6. Intervention Protocol

### Message Injection Examples

```typescript
// orchestrator.ts

export class Orchestrator {

  private async injectTask(sessionID: string, task: Task): Promise<void> {
    await this.sdk.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [
          {
            type: "text",
            text: `${task.description}\n\nAsk me if you're unsure about anything. I'm here to help keep you on track.`
          }
        ]
      }
    })
  }

  private async injectCorrection(
    sessionID: string,
    antiPattern: AntiPatternDetection
  ): Promise<void> {
    // Be harsh - this is about effectiveness, not politeness
    const messages = {
      mock_cascade: "Stop mocking everything. Implement the actual functionality first. Tests should verify real behavior.",

      infinite_loop: `You're running the same command repeatedly. READ THE ERROR MESSAGE. What needs to change in the code?`,

      printless_testing: "Add debug output to see what's actually happening. Don't guess - inspect the data with console.log/print.",

      reward_hacking: "I don't see the changes. Show me what you actually implemented.",

      analysis_paralysis: "Enough planning. Write code. Make changes now."
    }

    await this.sdk.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [
          { type: "text", text: messages[antiPattern.type] }
        ]
      }
    })
  }

  private async answerQuestion(
    sessionID: string,
    question: string,
    task: Task
  ): Promise<void> {
    // Use LLM to answer doer's question
    const answer = await this.llm.generate(`
You are supervising an AI agent working on: ${task.description}

The agent asks: ${question}

Provide a helpful, concise answer that keeps work flowing. Don't do the work for them - guide them.
`)

    await this.sdk.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [{ type: "text", text: answer }]
      }
    })
  }
}
```

---

## 7. Example Session Flow

```
ORCHESTRATOR:
├─ Breaks project into 5 tasks
├─ Creates OpenCode session: sess_abc123
├─ Injects Task 1: "Implement user authentication"
└─ Starts monitoring (SSE subscribed)

DOER (OpenCode):
├─ Reads task
├─ Uses Read tool to examine codebase
├─ Uses Edit tool to add auth.ts
├─ Uses Bash tool to run tests
├─ Test fails
├─ Asks: "Should I use JWT or sessions?"

ORCHESTRATOR:
├─ Receives session.idle event
├─ Reads messages via GET /session/sess_abc123/message
├─ Detects question
├─ Uses LLM to answer: "Use JWT - it's stateless and scales better"
├─ Injects answer
└─ Continues monitoring

DOER:
├─ Implements JWT auth
├─ Runs tests - all pass
├─ Runs same test command 6 times (nervous?)

ORCHESTRATOR:
├─ Receives session.idle event
├─ Detects infinite_loop anti-pattern
├─ Injects: "You're running tests repeatedly. They passed. Move on."
└─ Continues monitoring

DOER:
├─ Says: "Done with authentication"

ORCHESTRATOR:
├─ Receives session.idle event
├─ Calls GET /file/status - sees auth.ts modified
├─ Reads full conversation
├─ Uses LLM to score quality: 85/100
├─ All checks pass ✓
├─ Marks Task 1 as "done"
├─ Injects Task 2: "Add password reset endpoint"
└─ Continues monitoring

[Repeat until all tasks complete]
```

---

## 8. Implementation Roadmap

### Phase 1: MVP (Week 1)
**Goal:** Basic working orchestrator

1. **Project Setup** (Day 1)
   - Initialize TypeScript project
   - Install OpenCode SDK: `npm install @opencode-ai/sdk`
   - Add dependencies: `zod`, `ai` SDK
   - Configure infinite timeout in SDK client

2. **Core Orchestration** (Day 2-3)
   - Implement `state.ts` with JSON persistence
   - Implement `session.ts` for OpenCode interaction
   - Basic `orchestrator.ts` with task injection
   - Simple polling monitor

3. **Detection Logic** (Day 4-5)
   - Implement 2-3 anti-pattern detectors
   - Basic quality scoring
   - Message parsing utilities

4. **Testing** (Day 6-7)
   - Manual test with simple project
   - Fix bugs, tune thresholds
   - Document learnings

### Phase 2: Production Ready (Week 2)

1. **SSE Monitoring** (Day 1-2)
   - Implement `monitor.ts` with EventSource
   - Fall back to polling if SSE fails
   - Handle reconnections

2. **LLM Integration** (Day 3-4)
   - Implement `analyzer.ts` with prompt templates
   - Add project breakdown capability
   - Question answering system

3. **All Anti-Patterns** (Day 5)
   - Complete all 5 detectors
   - Tune detection thresholds
   - Add intervention messages

4. **Polish** (Day 6-7)
   - Better logging
   - Config file support
   - CLI interface
   - Error handling

### Phase 3: Advanced Features (Week 3+)

- SQLite persistence
- Multi-project support
- Web dashboard for monitoring
- Retry strategies (exponential backoff)
- Learning from past anti-patterns
- Integration with issue trackers

---

## 9. Package.json

```json
{
  "name": "opencode-orchestrator",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@opencode-ai/sdk": "^1.0.65",
    "ai": "^5.0.8",
    "zod": "^4.1.8",
    "eventsource": "^2.0.2"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.8.2",
    "bun-types": "^1.3.0"
  }
}
```

## 10. Configuration File

```json
{
  "opencode": {
    "serverUrl": "http://localhost:4096",
    "requestTimeout": 0
  },
  "model": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5-20250929",
    "apiKey": "${ANTHROPIC_API_KEY}"
  },
  "monitoring": {
    "pollIntervalSeconds": 5,
    "idleThresholdSeconds": 30,
    "useSSE": true
  },
  "thresholds": {
    "maxRetries": 3,
    "loopDetectionCount": 5,
    "qualityScoreMinimum": 70
  }
}
```

## 11. SDK Usage with Infinite Timeout

```typescript
// session.ts

import { createOpencodeClient } from "@opencode-ai/sdk/client"

export function createSDK(baseUrl: string) {
  return createOpencodeClient({
    baseUrl,
    // CRITICAL: Override fetch to disable timeout for local LLMs
    fetch: (req) => {
      // @ts-ignore
      req.timeout = 0  // Infinite timeout
      return fetch(req)
    }
  })
}
```

---

## 12. Risks & Open Questions

### Risks

1. **Infinite Loops in Orchestrator**
   - Orchestrator could get into correction loops
   - Mitigation: Max retry limit (3), then escalate to human

2. **Context Length**
   - Long sessions may exceed context limits
   - Mitigation: Use OpenCode's compaction feature

3. **False Positives**
   - Anti-pattern detection may fire incorrectly
   - Mitigation: Tune thresholds, allow override

4. **Doer Ignores Feedback**
   - Doer might not follow orchestrator's instructions
   - Mitigation: Stronger prompts, abort session if stuck

### Open Questions

1. **How to tell doer to ask questions?**
   - Answer: Include in task prompt: "Ask me if you're unsure"
   - Or: Configure OpenCode agent with instruction

2. **What if doer never stops?**
   - Use `POST /session/:id/abort` after timeout
   - Or: Monitor tool call count, abort if excessive

3. **How to handle long-running commands?**
   - Bash tool calls may block
   - Monitor with timeout, kill if needed

4. **Should orchestrator modify OpenCode config?**
   - Probably not - keep it stateless
   - User configures OpenCode separately

---

## 13. Getting Started

### Quick Start

```bash
# 1. Start OpenCode server
cd /path/to/project
opencode --server --port 4096

# 2. Create orchestrator project
mkdir orchestrator && cd orchestrator
npm init -y
npm install @opencode-ai/sdk ai zod eventsource

# 3. Create minimal orchestrator
# (Copy code from orchestrator.ts)

# 4. Run it
export ANTHROPIC_API_KEY=your_key
bun run src/index.ts --project "Build a TODO app"
```

### MVP Orchestrator Code

```typescript
// src/index.ts
import { createOpencodeClient } from "@opencode-ai/sdk/client"

const sdk = createOpencodeClient({
  baseUrl: "http://localhost:4096",
  fetch: (req) => { req.timeout = 0; return fetch(req) }
})

// Create session
const session = await sdk.session.create()
console.log("Session:", session.data.id)

// Inject task
await sdk.session.prompt({
  path: { id: session.data.id },
  body: {
    parts: [
      {
        type: "text",
        text: "Create a simple TODO app in TypeScript. Ask me if unsure."
      }
    ]
  }
})

// Monitor (simple polling)
setInterval(async () => {
  const msgs = await sdk.session.messages({ path: { id: session.data.id } })
  const last = msgs.data[msgs.data.length - 1]

  if (last.role === "assistant") {
    const pending = last.parts.some(p =>
      p.type === "tool" && p.state.status !== "completed"
    )

    if (!pending) {
      console.log("Doer is idle:", last.parts[0]?.text)
      // Respond here...
    }
  }
}, 5000)
```

---

## Summary

The orchestrator is a **standalone supervisor** that uses OpenCode like a human would:
- Breaks projects into tasks
- Monitors doer agent via SSE events
- Detects when doer is stuck or doing dumb things
- Injects corrections/answers to keep work flowing
- Has higher standards (longer timescale thinking)
- Isn't afraid to be harsh when needed

**Next Step:** Build Phase 1 MVP in 1 week, then iterate based on real usage.
