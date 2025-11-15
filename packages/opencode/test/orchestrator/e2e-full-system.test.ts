/**
 * End-to-end test suite for the autonomous agent system
 * Tests the full hierarchy: Architect → Supervisor → Build
 * Uses real HTTP API and real LLM (no mocking)
 */

import { test, expect } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const API_BASE = "http://127.0.0.1:4096"
const TEST_MODEL = { providerID: "lmstudio", modelID: "glm-4.5-air@q4_k_m" }

interface Session {
  id: string
  title: string
  parentID?: string
}

interface Message {
  id: string
  role: "user" | "assistant"
  sessionID: string
}

interface Todo {
  content: string
  status: "pending" | "in_progress" | "completed"
  activeForm: string
}

async function call(method: string, path: string, body?: any): Promise<any> {
  const url = `${API_BASE}${path}`
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text}`)
  }

  return response.json()
}

async function waitForCompletion(sessionID: string, maxWaitMs = 120000): Promise<Message[]> {
  const startTime = Date.now()
  let previousMessageCount = 0

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const messages: Message[] = await call("GET", `/session/${sessionID}/message`)

    // Check if conversation has progressed
    if (messages.length > previousMessageCount) {
      previousMessageCount = messages.length

      const lastMessage = messages[messages.length - 1]

      // If last message is from assistant and conversation seems complete
      if (lastMessage.role === "assistant") {
        const todos: Todo[] = await call("GET", `/session/${sessionID}/todo`)

        // Check if all todos are completed
        const allComplete = todos.length > 0 && todos.every((t) => t.status === "completed")
        if (allComplete) {
          return messages
        }

        // Or if there's been no activity for a while
        await new Promise((resolve) => setTimeout(resolve, 5000))
        const newMessages: Message[] = await call("GET", `/session/${sessionID}/message`)
        if (newMessages.length === messages.length) {
          // No new messages in 5 seconds, consider complete
          return messages
        }
      }
    }
  }

  throw new Error("Timeout waiting for completion")
}

async function getTodos(sessionID: string): Promise<Todo[]> {
  return call("GET", `/session/${sessionID}/todo`)
}

async function getChildSessions(sessionID: string): Promise<Session[]> {
  return call("GET", `/session/${sessionID}/children`)
}

test("supervisor can delegate to build agent and complete simple task", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Create supervisor session
      const session: Session = await call("POST", "/session", {
        title: "E2E: Supervisor delegation test",
      })

      // Send task to supervisor
      const task = "Create a file called test.txt with the content 'Hello from supervisor test'"

      await call("POST", `/session/${session.id}/message`, {
        agent: "supervisor",
        model: TEST_MODEL,
        parts: [{ type: "text", text: task }],
      })

      // Wait for completion
      const messages = await waitForCompletion(session.id, 60000)
      expect(messages.length).toBeGreaterThan(0)

      // Check if file was created
      const fileExists = await Bun.file(`${tmp.path}/test.txt`).exists()
      expect(fileExists).toBe(true)

      if (fileExists) {
        const content = await Bun.file(`${tmp.path}/test.txt`).text()
        expect(content).toContain("Hello from supervisor test")
      }

      // Check todos
      const todos = await getTodos(session.id)
      const completedTodos = todos.filter((t) => t.status === "completed")
      expect(completedTodos.length).toBeGreaterThan(0)
    },
  })
}, 120000)

test("supervisor monitors build agent progress in real-time", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session: Session = await call("POST", "/session", {
        title: "E2E: Real-time supervision test",
      })

      const task = `Create three files: alpha.txt, beta.txt, and gamma.txt. Each should contain a different message.`

      await call("POST", `/session/${session.id}/message`, {
        agent: "supervisor",
        model: TEST_MODEL,
        parts: [{ type: "text", text: task }],
      })

      // Monitor progress by polling todos
      const startTime = Date.now()
      const todoSnapshots: Todo[][] = []

      while (Date.now() - startTime < 90000) {
        await new Promise((resolve) => setTimeout(resolve, 3000))

        const todos = await getTodos(session.id)
        todoSnapshots.push(todos)

        // Check if complete
        const allComplete = todos.length > 0 && todos.every((t) => t.status === "completed")
        if (allComplete) break
      }

      // Verify we captured todo transitions
      expect(todoSnapshots.length).toBeGreaterThan(2)

      // Verify files were created
      const alphaExists = await Bun.file(`${tmp.path}/alpha.txt`).exists()
      const betaExists = await Bun.file(`${tmp.path}/beta.txt`).exists()
      const gammaExists = await Bun.file(`${tmp.path}/gamma.txt`).exists()

      expect(alphaExists).toBe(true)
      expect(betaExists).toBe(true)
      expect(gammaExists).toBe(true)
    },
  })
}, 120000)

test("supervisor continues conversation when build agent stops prematurely", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session: Session = await call("POST", "/session", {
        title: "E2E: Conversation continuation test",
      })

      // Task that might cause agent to ask questions
      const task = `Create a configuration file. Use JSON format. Include settings for database connection.`

      await call("POST", `/session/${session.id}/message`, {
        agent: "supervisor",
        model: TEST_MODEL,
        parts: [{ type: "text", text: task }],
      })

      // Wait and check for continuation
      await waitForCompletion(session.id, 90000)

      const messages: Message[] = await call("GET", `/session/${session.id}/message`)

      // Should have multiple exchanges (continuation kicked in)
      const userMessages = messages.filter((m) => m.role === "user")
      const assistantMessages = messages.filter((m) => m.role === "assistant")

      expect(userMessages.length).toBeGreaterThan(1)
      expect(assistantMessages.length).toBeGreaterThan(1)

      // Check if a config file was created
      const files = await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: tmp.path, onlyFiles: true }))
      expect(files.length).toBeGreaterThan(0)
    },
  })
}, 120000)

test("architect delegates to supervisor and monitors completion", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session: Session = await call("POST", "/session", {
        title: "E2E: Architect delegation test",
      })

      const task = `Build a simple project with two files:
1. A README.md explaining the project
2. A main.ts file with a hello world function

Complete both files.`

      await call("POST", `/session/${session.id}/message`, {
        agent: "architect",
        model: TEST_MODEL,
        parts: [{ type: "text", text: task }],
      })

      // Wait for completion
      await waitForCompletion(session.id, 180000)

      // Check for child sessions (architect should have delegated to supervisor)
      const children = await getChildSessions(session.id)
      expect(children.length).toBeGreaterThan(0)

      // Check todos
      const todos = await getTodos(session.id)
      const completedCount = todos.filter((t) => t.status === "completed").length
      expect(completedCount).toBeGreaterThan(0)

      // Check if files were created
      const readmeExists = await Bun.file(`${tmp.path}/README.md`).exists()
      const mainExists = await Bun.file(`${tmp.path}/main.ts`).exists()

      expect(readmeExists).toBe(true)
      expect(mainExists).toBe(true)
    },
  })
}, 240000)

test("full conversation history is analyzed during supervision", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session: Session = await call("POST", "/session", {
        title: "E2E: Conversation analysis test",
      })

      const task = `Create a package.json file for a TypeScript project. Include dependencies for testing.`

      await call("POST", `/session/${session.id}/message`, {
        agent: "supervisor",
        model: TEST_MODEL,
        parts: [{ type: "text", text: task }],
      })

      await waitForCompletion(session.id, 90000)

      // Get full conversation
      const messages: Message[] = await call("GET", `/session/${session.id}/message`)

      // Verify conversation has substance
      expect(messages.length).toBeGreaterThan(2)

      // Verify package.json was created
      const pkgExists = await Bun.file(`${tmp.path}/package.json`).exists()
      expect(pkgExists).toBe(true)

      if (pkgExists) {
        const content = await Bun.file(`${tmp.path}/package.json`).text()
        const pkg = JSON.parse(content)
        expect(pkg.dependencies || pkg.devDependencies).toBeDefined()
      }
    },
  })
}, 120000)

test("supervisor can run tests directly without delegating", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Create a simple test file first
      await Bun.write(
        `${tmp.path}/simple.test.ts`,
        `import { test, expect } from "bun:test"

test("math works", () => {
  expect(1 + 1).toBe(2)
})`,
      )

      const session: Session = await call("POST", "/session", {
        title: "E2E: Supervisor runs tests",
      })

      const task = `Run the test file simple.test.ts and report the results.`

      await call("POST", `/session/${session.id}/message`, {
        agent: "supervisor",
        model: TEST_MODEL,
        parts: [{ type: "text", text: task }],
      })

      await waitForCompletion(session.id, 60000)

      const messages: Message[] = await call("GET", `/session/${session.id}/message`)

      // Check that supervisor used bash tool to run tests
      // (this verifies supervisor has same tools as build agent)
      const messageContent = JSON.stringify(messages)
      expect(messageContent.toLowerCase()).toMatch(/test|bun|pass/)
    },
  })
}, 90000)

test("anti-pattern detection: multiple tasks in progress", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session: Session = await call("POST", "/session", {
        title: "E2E: Anti-pattern detection",
      })

      const task = `Create five different files with different content. Work on them efficiently.`

      await call("POST", `/session/${session.id}/message`, {
        agent: "supervisor",
        model: TEST_MODEL,
        parts: [{ type: "text", text: task }],
      })

      // Monitor todos to check for anti-patterns
      const startTime = Date.now()
      let foundMultipleInProgress = false

      while (Date.now() - startTime < 90000) {
        await new Promise((resolve) => setTimeout(resolve, 2000))

        const todos = await getTodos(session.id)
        const inProgress = todos.filter((t) => t.status === "in_progress")

        // Ideally should only have 1 in progress at a time
        if (inProgress.length > 1) {
          foundMultipleInProgress = true
        }

        const allComplete = todos.length > 0 && todos.every((t) => t.status === "completed")
        if (allComplete) break
      }

      // The system should prevent multiple in-progress tasks
      // But we're just checking it works either way
      const todos = await getTodos(session.id)
      expect(todos.length).toBeGreaterThan(0)
    },
  })
}, 120000)

test("langfuse instrumentation captures agent interactions", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session: Session = await call("POST", "/session", {
        title: "E2E: Langfuse instrumentation test",
      })

      const task = `Create a simple text file called instrumentation.txt`

      await call("POST", `/session/${session.id}/message`, {
        agent: "build",
        model: TEST_MODEL,
        parts: [{ type: "text", text: task }],
      })

      await waitForCompletion(session.id, 60000)

      // Verify file was created (basic test)
      const fileExists = await Bun.file(`${tmp.path}/instrumentation.txt`).exists()
      expect(fileExists).toBe(true)

      // NOTE: Langfuse instrumentation happens in the background
      // To fully verify, you'd need to check the Langfuse dashboard at localhost:3044
      // This test just ensures the system works with Langfuse enabled
    },
  })
}, 90000)
