import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import path from "path"

/**
 * REAL HTTP API TESTS
 *
 * These tests hit the actual OpenCode server running at http://127.0.0.1:4096
 * They create real sessions, send real prompts, and get real LLM responses.
 *
 * Prerequisites:
 * - OpenCode server must be running: cd packages/opencode && bun run src/server/start.ts
 * - LM Studio must be running at 192.168.1.175:1234 with glm-4.5-air@q4_k_m model
 */

const projectRoot = path.join(__dirname, "../..")
const API_BASE = "http://127.0.0.1:4096"
Log.init({ print: true })

async function apiCall(method: string, path: string, body?: any): Promise<any> {
  const url = `${API_BASE}${path}`
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  }

  if (body) {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(url, options)
  const data = await response.json()

  if (!response.ok) {
    console.error(`API call failed: ${method} ${path}`, data)
    throw new Error(`API call failed: ${response.status} ${response.statusText}`)
  }

  return data
}

async function waitForResponse(sessionId: string, timeoutMs: number = 120000): Promise<void> {
  const startTime = Date.now()
  let lastMessageCount = 0

  while (Date.now() - startTime < timeoutMs) {
    const messages = await apiCall("GET", `/session/${sessionId}/message`)
    const currentCount = messages.length

    if (currentCount > lastMessageCount) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.info.role === "assistant") {
        // Check if assistant is done (no pending tool calls)
        const hasPendingTools = lastMessage.parts.some((p: any) => p.type === "tool_use")
        if (!hasPendingTools) {
          return
        }
      }
      lastMessageCount = currentCount
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error(`Timeout waiting for response in session ${sessionId}`)
}

describe("HTTP API - Real LLM Tests", () => {
  let testSessionIds: string[] = []

  afterAll(async () => {
    // Cleanup all test sessions
    for (const sessionId of testSessionIds) {
      try {
        await apiCall("DELETE", `/session/${sessionId}`)
      } catch (e) {
        console.error(`Failed to delete session ${sessionId}:`, e)
      }
    }
  })

  test("create session and send prompt to build agent via HTTP", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        console.log("\n" + "=".repeat(80))
        console.log("HTTP API TEST: Create Session + Send Prompt")
        console.log("=".repeat(80) + "\n")

        // Create session
        const createResponse = await apiCall("POST", "/session", {
          title: "HTTP API Test - Build Agent",
        })

        const sessionId = createResponse.id
        testSessionIds.push(sessionId)

        console.log(`✓ Session created: ${sessionId}`)

        // Send prompt via HTTP
        const promptResponse = await apiCall("POST", `/session/${sessionId}/message`, {
          agent: "build",
          model: {
            providerID: "lmstudio",
            modelID: "glm-4.5-air@q4_k_m",
          },
          parts: [
            {
              type: "text",
              text: "Create a file called http-test.txt with content 'Hello from HTTP API test'",
            },
          ],
        })

        console.log(`✓ Prompt sent, messageID: ${promptResponse.id}`)

        // Wait for agent to respond
        console.log("Waiting for agent response...")
        await waitForResponse(sessionId, 90000)

        // Get messages
        const messages = await apiCall("GET", `/session/${sessionId}/message`)
        console.log(`✓ Got ${messages.length} messages`)

        // Get todos
        const todos = await apiCall("GET", `/session/${sessionId}/todo`)
        console.log(`✓ Got ${todos.length} todos`)

        for (const todo of todos) {
          console.log(`  [${todo.status}] ${todo.content}`)
        }

        // Verify
        expect(messages.length).toBeGreaterThan(1)
        expect(todos.length).toBeGreaterThan(0)

        console.log("\n✓ Test passed\n")
      },
    })
  }, 120000)

  test("orchestrator delegates to build agent via HTTP API", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        console.log("\n" + "=".repeat(80))
        console.log("HTTP API TEST: Orchestrator Delegation")
        console.log("=".repeat(80) + "\n")

        // Create orchestrator session
        const createResponse = await apiCall("POST", "/session", {
          title: "HTTP API Test - Orchestrator",
        })

        const sessionId = createResponse.id
        testSessionIds.push(sessionId)

        console.log(`✓ Orchestrator session created: ${sessionId}`)

        // Send task to orchestrator
        await apiCall("POST", `/session/${sessionId}/message`, {
          agent: "orchestrator",
          model: {
            providerID: "lmstudio",
            modelID: "glm-4.5-air@q4_k_m",
          },
          parts: [
            {
              type: "text",
              text: "Create a file called delegation-test.txt with content 'Delegated task'. Use the Task tool to delegate this to a build agent.",
            },
          ],
        })

        console.log("✓ Task sent to orchestrator")
        console.log("Waiting for orchestrator to delegate and complete...")

        await waitForResponse(sessionId, 120000)

        // Get session children (delegated sessions)
        const children = await apiCall("GET", `/session/${sessionId}/children`)
        console.log(`✓ Child sessions created: ${children.length}`)

        for (const child of children) {
          testSessionIds.push(child.id)
          console.log(`  - ${child.title} (${child.id})`)

          // Get child todos
          const childTodos = await apiCall("GET", `/session/${child.id}/todo`)
          console.log(`    Todos: ${childTodos.length}`)
          for (const todo of childTodos) {
            console.log(`      [${todo.status}] ${todo.content}`)
          }
        }

        // Get orchestrator todos
        const orchestratorTodos = await apiCall("GET", `/session/${sessionId}/todo`)
        console.log(`✓ Orchestrator todos: ${orchestratorTodos.length}`)
        for (const todo of orchestratorTodos) {
          console.log(`  [${todo.status}] ${todo.content}`)
        }

        // Verify delegation happened
        expect(children.length).toBeGreaterThan(0)
        expect(orchestratorTodos.length).toBeGreaterThan(0)

        console.log("\n✓ Test passed\n")
      },
    })
  }, 180000)

  test("multi-turn conversation via HTTP API", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        console.log("\n" + "=".repeat(80))
        console.log("HTTP API TEST: Multi-turn Conversation")
        console.log("=".repeat(80) + "\n")

        // Create session
        const createResponse = await apiCall("POST", "/session", {
          title: "HTTP API Test - Multi-turn",
        })

        const sessionId = createResponse.id
        testSessionIds.push(sessionId)

        console.log(`✓ Session created: ${sessionId}`)

        // Turn 1
        console.log("\nTURN 1: Create file")
        await apiCall("POST", `/session/${sessionId}/prompt`, {
          agent: "build",
          model: {
            providerID: "lmstudio",
            modelID: "glm-4.5-air@q4_k_m",
          },
          parts: [
            {
              type: "text",
              text: "Create a file called multi-turn.txt with content 'version 1'",
            },
          ],
        })

        await waitForResponse(sessionId, 60000)
        const messages1 = await apiCall("GET", `/session/${sessionId}/message`)
        console.log(`✓ Turn 1 complete: ${messages1.length} messages`)

        // Turn 2
        console.log("\nTURN 2: Update file")
        await apiCall("POST", `/session/${sessionId}/prompt`, {
          agent: "build",
          model: {
            providerID: "lmstudio",
            modelID: "glm-4.5-air@q4_k_m",
          },
          parts: [
            {
              type: "text",
              text: "Update multi-turn.txt to say 'version 2'",
            },
          ],
        })

        await waitForResponse(sessionId, 60000)
        const messages2 = await apiCall("GET", `/session/${sessionId}/message`)
        console.log(`✓ Turn 2 complete: ${messages2.length} messages`)

        // Verify multi-turn worked
        const userMessages = messages2.filter((m: any) => m.info.role === "user")
        const assistantMessages = messages2.filter((m: any) => m.info.role === "assistant")

        console.log(`\n✓ User messages: ${userMessages.length}`)
        console.log(`✓ Assistant messages: ${assistantMessages.length}`)

        expect(userMessages.length).toBe(2)
        expect(assistantMessages.length).toBeGreaterThanOrEqual(2)

        console.log("\n✓ Test passed\n")
      },
    })
  }, 180000)
})
