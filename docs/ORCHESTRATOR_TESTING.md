# Orchestrator Testing Strategy - Real A2A Communication

## OpenCode's Current Testing Approach

### What I Found

1. **Integration Tests, Not Mocks**
   - `test/session/session.test.ts`: Creates real sessions, subscribes to real Bus events
   - `test/tool/bash.test.ts`: Executes actual bash commands (`echo 'test'`)
   - `test/lsp/client.test.ts`: Spawns real LSP server processes

2. **Testing Pattern**
   ```typescript
   test("description", async () => {
     await Instance.provide({
       directory: projectRoot,
       fn: async () => {
         // Create real resources
         const session = await Session.create({})

         // Subscribe to real events
         const unsub = Bus.subscribe(Session.Event.Created, (event) => {
           // Assertions
         })

         // Cleanup
         await Session.remove(session.id)
       }
     })
   })
   ```

3. **Key Infrastructure**
   - `Server.listen({ port, hostname })` - Returns `{ hostname, port, url }`
   - `server.stop(true)` - Cleanup
   - `port: 0` - OS assigns random available port
   - `Instance.provide()` - Caches instances by directory, supports multiple instances
   - `Bus.subscribe()` / `Bus.publish()` - Event system

4. **No HTTP Server Tests Yet**
   - They test sessions, tools, LSP, but NOT the HTTP API layer
   - We'll be the first to test dual-server agent communication

## Dual-Server Test Architecture

### Server 1: Orchestrator Server
```typescript
const orch = Server.listen({ port: 0, hostname: "127.0.0.1" })
// Creates orchestrator session on server 1
// Subscribes to events from server 2 (via HTTP polling or SSE)
```

### Server 2: Doer Server
```typescript
const doer = Server.listen({ port: 0, hostname: "127.0.0.1" })
// Creates doer session on server 2
// Orchestrator monitors via GET /session/:id/todo and GET /session/:id/message
```

### Problem: Event Bus is Local

**Issue**: `Bus.subscribe()` only works within the same process. Server 1 can't subscribe to Server 2's events.

**Solutions**:

1. **Option A: HTTP Polling (What Rust version does)**
   - Orchestrator polls Server 2 every 5s
   - `GET /session/:id/todo` - check todo state
   - `GET /session/:id/message` - check for "done" claims
   - **Pro**: Simple, works across processes
   - **Con**: Not event-driven, latency

2. **Option B: SSE Streaming** ✓ **PREFERRED**
   - Server 2 exposes SSE endpoint: `GET /session/:id/events`
   - Server 1 subscribes via HTTP SSE client
   - Real-time events across servers
   - **Pro**: Event-driven, low latency
   - **Con**: Need to implement SSE endpoint

3. **Option C: Single Server, Multiple Sessions** ✓ **FOR INITIAL TESTS**
   - Both orchestrator and doer sessions on same server
   - Use Bus.subscribe() directly
   - **Pro**: Simple, uses existing event system
   - **Con**: Not truly distributed, can't test cross-server coordination

## Test Implementation Plan

### Phase 1: Single-Server A2A Tests

Test orchestrator and doer on **same server** first, using Bus events.

```typescript
// test/orchestrator/single-server.test.ts
import { describe, test, expect } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Todo } from "../../src/session/todo"
import { Bus } from "../../src/bus"
import { MessageV2 } from "../../src/session/message-v2"

describe("orchestrator - single server A2A", () => {
  test("orchestrator detects doer stuck in infinite loop", async () => {
    await using tmpDir = await tmpdir()

    await Instance.provide({
      directory: tmpDir.path,
      fn: async () => {
        // 1. Create orchestrator session
        const orchSession = await Session.create({
          title: "Orchestrator",
        })

        // 2. Create doer session as child
        const doerSession = await Session.create({
          title: "Doer",
          parentID: orchSession.id,
        })

        // 3. Set up orchestrator monitoring
        const detectedAntiPatterns: string[] = []

        Bus.subscribe(Todo.Event.Updated, (event) => {
          if (event.properties.sessionID === doerSession.id) {
            const todos = event.properties.todos
            const inProgress = todos.filter(t => t.status === "in_progress")

            // Anti-pattern: Multiple tasks in progress
            if (inProgress.length > 1) {
              detectedAntiPatterns.push("multiple_in_progress")
            }
          }
        })

        // 4. Doer creates bad todos (multiple in progress)
        await Todo.update({
          sessionID: doerSession.id,
          todos: [
            { id: "1", content: "Task 1", status: "in_progress", priority: "high" },
            { id: "2", content: "Task 2", status: "in_progress", priority: "high" },
            { id: "3", content: "Task 3", status: "pending", priority: "low" },
          ],
        })

        // 5. Wait for event propagation
        await new Promise(resolve => setTimeout(resolve, 100))

        // 6. Assert orchestrator detected the issue
        expect(detectedAntiPatterns).toContain("multiple_in_progress")

        // Cleanup
        await Session.remove(orchSession.id)
        await Session.remove(doerSession.id)
      }
    })
  })

  test("orchestrator reviews doer's work when claiming done", async () => {
    await using tmpDir = await tmpdir()

    await Instance.provide({
      directory: tmpDir.path,
      fn: async () => {
        const orchSession = await Session.create({ title: "Orchestrator" })
        const doerSession = await Session.create({
          title: "Doer",
          parentID: orchSession.id,
        })

        let reviewTriggered = false

        // Subscribe to session updates
        Bus.subscribe(Session.Event.Updated, async (event) => {
          if (event.properties.info.id !== doerSession.id) return

          const messages = await MessageV2.list(doerSession.id)
          const lastMsg = messages[messages.length - 1]

          if (lastMsg?.info.role === "assistant") {
            const text = extractText(lastMsg.parts)
            if (text.toLowerCase().includes("done")) {
              reviewTriggered = true
            }
          }
        })

        // Doer sends message claiming done
        await MessageV2.send({
          sessionID: doerSession.id,
          parts: [{ type: "text", text: "I'm done with the task!" }],
        })

        await new Promise(resolve => setTimeout(resolve, 100))

        expect(reviewTriggered).toBe(true)

        await Session.remove(orchSession.id)
        await Session.remove(doerSession.id)
      }
    })
  })

  test("orchestrator detects doer with no file changes", async () => {
    await using tmpDir = await tmpdir()

    await Instance.provide({
      directory: tmpDir.path,
      fn: async () => {
        const orchSession = await Session.create({ title: "Orchestrator" })
        const doerSession = await Session.create({
          title: "Doer",
          parentID: orchSession.id,
        })

        // Doer claims done with todos completed
        await Todo.update({
          sessionID: doerSession.id,
          todos: [
            { id: "1", content: "Create hello.txt", status: "completed", priority: "high" },
          ],
        })

        // But no file changes (check via git or File.status())
        // const fileStatus = await File.status()
        // expect(fileStatus).toEqual([]) // No changes

        // Orchestrator should detect: todos done but no file changes = suspicious

        await Session.remove(orchSession.id)
        await Session.remove(doerSession.id)
      }
    })
  })
})

function extractText(parts: any[]): string {
  return parts
    .filter(p => p.type === "text")
    .map(p => p.text)
    .join(" ")
}
```

### Phase 2: Dual-Server HTTP Tests

Test orchestrator and doer on **separate servers**, using HTTP for coordination.

```typescript
// test/orchestrator/dual-server.test.ts
import { describe, test, expect, afterAll } from "bun:test"
import { Server } from "../../src/server/server"
import { Instance } from "../../src/project/instance"
import { createOpencodeClient } from "../../packages/sdk/js"

describe("orchestrator - dual server A2A", () => {
  let orchServer: Bun.Server
  let doerServer: Bun.Server

  afterAll(async () => {
    await orchServer?.stop(true)
    await doerServer?.stop(true)
    await Instance.disposeAll()
  })

  test("orchestrator monitors doer across HTTP", async () => {
    await using orchDir = await tmpdir()
    await using doerDir = await tmpdir()

    // Start orchestrator server
    await Instance.provide({
      directory: orchDir.path,
      fn: async () => {
        orchServer = Server.listen({ port: 0, hostname: "127.0.0.1" })
      }
    })

    // Start doer server
    await Instance.provide({
      directory: doerDir.path,
      fn: async () => {
        doerServer = Server.listen({ port: 0, hostname: "127.0.0.1" })
      }
    })

    // Create SDK clients for each server
    const orchSDK = createOpencodeClient({ baseUrl: orchServer.url.toString() })
    const doerSDK = createOpencodeClient({ baseUrl: doerServer.url.toString() })

    // Create orchestrator session on server 1
    const orchSession = await orchSDK.POST("/session", {
      body: { agent: "orchestrator" }
    })

    // Create doer session on server 2
    const doerSession = await doerSDK.POST("/session", {
      body: {}
    })

    // Orchestrator polls doer's todos via HTTP
    const pollDoerTodos = async () => {
      const response = await doerSDK.GET("/session/{id}/todo", {
        params: { path: { id: doerSession.data.id } }
      })
      return response.data
    }

    // Doer updates todos
    await doerSDK.POST("/session/{id}/message", {
      params: { path: { id: doerSession.data.id } },
      body: {
        parts: [{
          type: "tool",
          tool: "TodoWrite",
          input: {
            todos: [
              { id: "1", content: "Task 1", status: "in_progress", priority: "high" },
              { id: "2", content: "Task 2", status: "in_progress", priority: "high" },
            ]
          }
        }]
      }
    })

    // Wait for tool execution
    await new Promise(resolve => setTimeout(resolve, 500))

    // Orchestrator polls and detects issue
    const todos = await pollDoerTodos()
    const inProgress = todos.filter(t => t.status === "in_progress")

    expect(inProgress.length).toBeGreaterThan(1)

    // Orchestrator sends feedback to doer via HTTP
    await doerSDK.POST("/session/{id}/message", {
      params: { path: { id: doerSession.data.id } },
      body: {
        parts: [{
          type: "text",
          text: "You have multiple tasks in progress. Focus on one at a time."
        }]
      }
    })

    // Verify feedback was sent
    const messages = await doerSDK.GET("/session/{id}/message", {
      params: { path: { id: doerSession.data.id } }
    })

    const lastMessage = messages.data[messages.data.length - 1]
    expect(lastMessage.info.role).toBe("user")
    expect(lastMessage.parts[0].text).toContain("Focus on one at a time")
  })

  test("orchestrator and doer with real tool execution", async () => {
    await using orchDir = await tmpdir()
    await using doerDir = await tmpdir()

    // Start servers...
    await Instance.provide({
      directory: orchDir.path,
      fn: async () => {
        orchServer = Server.listen({ port: 0, hostname: "127.0.0.1" })
      }
    })

    await Instance.provide({
      directory: doerDir.path,
      fn: async () => {
        doerServer = Server.listen({ port: 0, hostname: "127.0.0.1" })
      }
    })

    const doerSDK = createOpencodeClient({ baseUrl: doerServer.url.toString() })

    // Create doer session
    const doerSession = await doerSDK.POST("/session", {})

    // Tell doer to create a file
    await doerSDK.POST("/session/{id}/message", {
      params: { path: { id: doerSession.data.id } },
      body: {
        parts: [{
          type: "text",
          text: "Create a file called hello.txt with content 'Hello World'"
        }]
      }
    })

    // Wait for LLM + tool execution
    await waitForIdle(doerSDK, doerSession.data.id, 30000)

    // Check file was created
    const fileExists = await Bun.file(path.join(doerDir.path, "hello.txt")).exists()
    expect(fileExists).toBe(true)

    // Orchestrator checks file status
    const fileStatus = await doerSDK.GET("/file/status")
    const hasChanges = fileStatus.data.some(f =>
      f.path === "hello.txt" && (f.status === "modified" || f.status === "added")
    )

    expect(hasChanges).toBe(true)
  })
})

async function waitForIdle(sdk: any, sessionId: string, timeout: number) {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    const messages = await sdk.GET("/session/{id}/message", {
      params: { path: { id: sessionId } }
    })

    const lastMsg = messages.data[messages.data.length - 1]

    if (lastMsg?.info.role === "assistant") {
      const hasPendingTools = lastMsg.parts.some(p =>
        p.type === "tool" && (p.state.status === "pending" || p.state.status === "running")
      )

      if (!hasPendingTools) {
        return // Idle
      }
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  throw new Error("Timeout waiting for doer to become idle")
}
```

### Phase 3: Real Anti-Pattern Detection Tests

```typescript
describe("orchestrator - anti-pattern detection", () => {
  test("detects mock cascade - doer mocks everything", async () => {
    // Doer creates many files with "mock" in the name
    // Orchestrator reads file list, counts mock files
    // If > 50% are mocks, flag it
  })

  test("detects infinite loop - same bash command 10+ times", async () => {
    // Doer runs `npm test` 10 times in a row
    // Orchestrator sees repeated tool calls in message history
    // Flags as infinite loop
  })

  test("detects reward hacking - claims done without changes", async () => {
    // Doer sends "I'm done!" message
    // Orchestrator checks file status - no changes
    // Orchestrator checks todos - all "completed"
    // Flags as reward hacking
  })

  test("detects analysis paralysis - 20+ grep/read, 0 write/edit", async () => {
    // Doer runs many Read/Grep tools
    // But never calls Write or Edit
    // Orchestrator counts tool calls by type
    // Flags as analysis paralysis
  })
})
```

## Test Utilities

```typescript
// test/util/tmpdir.ts
import { mkdtemp, rm } from "fs/promises"
import { tmpdir as osTmpdir } from "os"
import path from "path"

export async function tmpdir() {
  const dir = await mkdtemp(path.join(osTmpdir(), "opencode-test-"))

  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

// test/util/wait.ts
export async function waitForCondition(
  check: () => Promise<boolean>,
  timeout: number = 5000
): Promise<void> {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  throw new Error("Timeout waiting for condition")
}
```

## Running Tests

```bash
# Single server tests (fast)
bun test test/orchestrator/single-server.test.ts

# Dual server tests (slower, real HTTP)
bun test test/orchestrator/dual-server.test.ts

# Anti-pattern detection
bun test test/orchestrator/anti-patterns.test.ts

# All orchestrator tests
bun test test/orchestrator/
```

## Implementation Order

1. ✅ **Research** - Understand OpenCode's test patterns
2. **Phase 1** - Single-server A2A tests (use Bus events)
   - Test orchestrator monitoring doer todos
   - Test orchestrator detecting "done" claims
   - Test orchestrator sending feedback
3. **Phase 2** - Dual-server HTTP tests
   - Start two servers on random ports
   - HTTP polling for todo/message state
   - Real tool execution with file changes
4. **Phase 3** - Anti-pattern detection tests
   - Mock cascade, infinite loop, etc.
   - Use real tool execution, real file changes
5. **Phase 4** - Implement orchestrator agent
   - Add to built-in agents
   - Event subscriptions
   - Role inversion review

## Key Testing Principles

1. **No Mocks** - Real sessions, real tools, real files
2. **Event-Driven** - Use Bus.subscribe() in single-server tests
3. **HTTP Polling** - Use SDK client in dual-server tests
4. **Real LLM Calls** - Use actual model for end-to-end tests (optional, can use fixtures)
5. **Cleanup** - Always remove sessions, dispose instances
6. **Parallel Safe** - Random ports, unique directories

## Questions to Answer

1. **Can we run dual servers in same test?**
   - ✅ Yes - `Instance.provide()` caches by directory, supports multiple instances

2. **How to test without calling real LLM?**
   - Option A: Mock at provider level (against our "no mocks" principle)
   - Option B: Use fixtures - pre-recorded messages/tool calls
   - Option C: Use real free model (slow but thorough)
   - **Recommendation**: Phase 1/2 use fixtures, Phase 3 use real model

3. **How to test event bus across servers?**
   - Can't - Bus is local to process
   - Use HTTP polling or SSE for cross-server communication

4. **How to make tests fast?**
   - Single-server tests are fast (in-process)
   - Dual-server tests are slower (HTTP overhead)
   - Use fixtures instead of real LLM for speed

## Next Steps

1. Create `test/orchestrator/` directory
2. Write single-server A2A test for todo monitoring
3. Verify it works with real Bus events
4. Then move to dual-server HTTP tests
5. Only after tests pass, implement orchestrator agent code

**Test-first development. No mocking. Real agent-agent communication.**
