#!/usr/bin/env bun
/**
 * ORCHESTRATOR DELEGATION DEMO
 *
 * Proves that orchestrator can delegate to build agent via HTTP API.
 * This is a REAL implementation, not a test.
 *
 * Prerequisites:
 * - OpenCode server running: opencode serve
 * - LM Studio at 192.168.1.175:1234 with glm-4.5-air@q4_k_m
 *
 * Run: bun run src/orchestrator/demo-delegation.ts
 */

const API = "http://127.0.0.1:4096"

async function call(method: string, path: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    throw new Error(`${method} ${path} failed: ${res.status}`)
  }

  return res.json()
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function pollUntilDone(sessionId: string, maxWaitMs = 300000) {
  console.log(`\n⏳ Waiting for session to complete (max ${maxWaitMs / 1000}s)...`)
  const start = Date.now()
  let lastMsgCount = 0

  while (Date.now() - start < maxWaitMs) {
    const messages = await call("GET", `/session/${sessionId}/message`)

    // Check if we have new messages
    if (messages.length > lastMsgCount) {
      console.log(`  📨 ${messages.length} messages (${messages.length - lastMsgCount} new)`)
      lastMsgCount = messages.length

      const last = messages[messages.length - 1]

      // If last message is from assistant and has content
      if (last.info.role === "assistant" && last.parts.length > 0) {
        const hasToolUse = last.parts.some((p: any) => p.type === "tool_use")

        if (!hasToolUse) {
          console.log(`✓ Session complete!\n`)
          return messages
        }
      }
    }

    await sleep(3000)
  }

  throw new Error(`Timeout after ${maxWaitMs}ms`)
}

async function showConversation(messages: any[]) {
  console.log("=".repeat(80))
  console.log("CONVERSATION")
  console.log("=".repeat(80))

  for (const msg of messages) {
    console.log(`\n[${msg.info.role.toUpperCase()}]`)

    for (const part of msg.parts) {
      if (part.type === "text") {
        console.log(part.text)
      } else if (part.type === "tool_use") {
        console.log(`\n🔧 Tool: ${part.name}`)
        if (part.input) {
          console.log(`   Input: ${JSON.stringify(part.input).substring(0, 100)}`)
        }
      } else if (part.type === "tool_result") {
        console.log(`\n✓ Tool result`)
      }
    }
  }

  console.log("\n" + "=".repeat(80))
}

async function showTodos(sessionId: string, title: string) {
  const todos = await call("GET", `/session/${sessionId}/todo`)

  console.log(`\n${title}:`)
  if (todos.length === 0) {
    console.log("  (no todos)")
  } else {
    for (const todo of todos) {
      console.log(`  [${todo.status}] ${todo.content}`)
    }
  }
}

async function main() {
  console.log("\n" + "=".repeat(80))
  console.log("ORCHESTRATOR DELEGATION DEMO")
  console.log("=".repeat(80))

  // Create orchestrator session
  const session = await call("POST", "/session", {
    title: "Demo: Orchestrator Delegation",
  })

  console.log(`\n✓ Created session: ${session.id}`)

  try {
    // Send task to orchestrator
    const task = `Create two text files:
1. alpha.txt containing "First file"
2. beta.txt containing "Second file"

Use the Task tool to delegate this work to a build agent. Monitor their progress.`

    console.log(`\n📝 Task:\n${task}`)

    await call("POST", `/session/${session.id}/message`, {
      agent: "orchestrator",
      model: {
        providerID: "lmstudio",
        modelID: "glm-4.5-air@q4_k_m",
      },
      parts: [{ type: "text", text: task }],
    })

    // Wait for completion
    const messages = await pollUntilDone(session.id)

    // Show results
    await showConversation(messages)
    await showTodos(session.id, "ORCHESTRATOR TODOS")

    // Check for child sessions (delegated work)
    const children = await call("GET", `/session/${session.id}/children`)

    console.log(`\n🔀 Child sessions: ${children.length}`)

    for (const child of children) {
      console.log(`\n  → ${child.title} (${child.id})`)
      await showTodos(child.id, `    BUILD AGENT TODOS`)

      // Cleanup child
      await call("DELETE", `/session/${child.id}`)
    }

    console.log("\n✅ DEMO COMPLETE\n")

  } catch (error) {
    console.error("\n❌ DEMO FAILED:", error)
    throw error
  } finally {
    // Cleanup
    await call("DELETE", `/session/${session.id}`)
    console.log(`🗑️  Cleaned up session\n`)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
