#!/usr/bin/env bun
/**
 * SIMPLE HTTP API TEST - ONE TEST AT A TIME
 *
 * Prerequisites:
 * - OpenCode server running at http://127.0.0.1:4096
 * - LM Studio running at 192.168.1.175:1234 with glm-4.5-air@q4_k_m
 *
 * Run: bun run test/orchestrator/simple-http-test.ts
 */

const API_BASE = "http://127.0.0.1:4096"

async function api(method: string, path: string, body?: any): Promise<any> {
  const url = `${API_BASE}${path}`
  console.log(`${method} ${path}`)

  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  }

  if (body) {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(url, options)

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`API call failed: ${response.status}\n${text}`)
  }

  return await response.json()
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForResponse(sessionId: string, timeoutMs: number = 120000) {
  console.log(`Waiting for agent response (timeout: ${timeoutMs}ms)...`)
  const startTime = Date.now()
  let lastCount = 0

  while (Date.now() - startTime < timeoutMs) {
    const messages = await api("GET", `/session/${sessionId}/message`)

    if (messages.length > lastCount) {
      const last = messages[messages.length - 1]
      if (last.info.role === "assistant" && last.parts.length > 0) {
        // Check if done (no pending tool calls)
        const hasPendingTools = last.parts.some((p: any) => p.type === "tool_use")
        if (!hasPendingTools) {
          console.log(`✓ Agent finished (${messages.length} messages total)`)
          return messages
        }
      }
      lastCount = messages.length
    }

    await sleep(2000)
  }

  throw new Error(`Timeout waiting for response`)
}

async function testBuildAgent() {
  console.log("\n" + "=".repeat(80))
  console.log("TEST: Build Agent - Create File")
  console.log("=".repeat(80) + "\n")

  // Create session
  const session = await api("POST", "/session", {
    title: "Simple test - build agent",
  })

  console.log(`✓ Session created: ${session.id}\n`)

  try {
    // Send message
    console.log("Sending message to build agent...")
    await api("POST", `/session/${session.id}/message`, {
      agent: "build",
      model: {
        providerID: "lmstudio",
        modelID: "glm-4.5-air@q4_k_m",
      },
      parts: [
        {
          type: "text",
          text: "Create a file called simple-test.txt with the content 'Hello from simple test'",
        },
      ],
    })

    // Wait for response
    const messages = await waitForResponse(session.id)

    // Show conversation
    console.log("\n" + "=".repeat(80))
    console.log("CONVERSATION:")
    console.log("=".repeat(80) + "\n")

    for (const msg of messages) {
      console.log(`[${msg.info.role.toUpperCase()}]`)
      for (const part of msg.parts) {
        if (part.type === "text") {
          console.log(part.text.substring(0, 200))
        } else if (part.type === "tool_use") {
          console.log(`  → Tool: ${part.name}`)
        }
      }
      console.log()
    }

    // Get todos
    const todos = await api("GET", `/session/${session.id}/todo`)
    console.log("=".repeat(80))
    console.log("TODOS:")
    console.log("=".repeat(80) + "\n")

    for (const todo of todos) {
      console.log(`[${todo.status}] ${todo.content}`)
    }

    console.log("\n✓ TEST PASSED\n")
  } finally {
    // Cleanup
    await api("DELETE", `/session/${session.id}`)
    console.log(`✓ Cleaned up session ${session.id}\n`)
  }
}

async function testOrchestrator() {
  console.log("\n" + "=".repeat(80))
  console.log("TEST: Orchestrator - Delegation")
  console.log("=".repeat(80) + "\n")

  // Create session
  const session = await api("POST", "/session", {
    title: "Simple test - orchestrator",
  })

  console.log(`✓ Session created: ${session.id}\n`)

  try {
    // Send message
    console.log("Sending task to orchestrator...")
    await api("POST", `/session/${session.id}/message`, {
      agent: "orchestrator",
      model: {
        providerID: "lmstudio",
        modelID: "glm-4.5-air@q4_k_m",
      },
      parts: [
        {
          type: "text",
          text: "Create a file called orchestrated.txt with content 'Orchestrator test'. Delegate this to a build agent using the Task tool.",
        },
      ],
    })

    // Wait for response
    const messages = await waitForResponse(session.id, 180000) // 3 minutes

    // Check for child sessions
    const children = await api("GET", `/session/${session.id}/children`)

    console.log("\n" + "=".repeat(80))
    console.log(`DELEGATION: ${children.length} child session(s) created`)
    console.log("=".repeat(80) + "\n")

    // Show orchestrator todos
    const orchestratorTodos = await api("GET", `/session/${session.id}/todo`)
    console.log("ORCHESTRATOR TODOS:")
    for (const todo of orchestratorTodos) {
      console.log(`  [${todo.status}] ${todo.content}`)
    }

    // Show child session todos
    for (const child of children) {
      console.log(`\nCHILD SESSION: ${child.title} (${child.id})`)
      const childTodos = await api("GET", `/session/${child.id}/todo`)
      for (const todo of childTodos) {
        console.log(`  [${todo.status}] ${todo.content}`)
      }

      // Cleanup child
      await api("DELETE", `/session/${child.id}`)
    }

    console.log("\n✓ TEST PASSED\n")
  } finally {
    // Cleanup
    await api("DELETE", `/session/${session.id}`)
    console.log(`✓ Cleaned up session ${session.id}\n`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const testName = args[0] || "build"

  console.log(`\nRunning test: ${testName}\n`)

  try {
    if (testName === "build") {
      await testBuildAgent()
    } else if (testName === "orchestrator") {
      await testOrchestrator()
    } else {
      console.error(`Unknown test: ${testName}`)
      console.error(`Usage: bun run simple-http-test.ts [build|orchestrator]`)
      process.exit(1)
    }
  } catch (error) {
    console.error("\n✗ TEST FAILED:", error)
    process.exit(1)
  }
}

main()
