#!/usr/bin/env bun
/**
 * MIDDLE MANAGER DEMO
 *
 * Shows the full 3-tier autonomous agent hierarchy:
 *
 * USER → MANAGER → ORCHESTRATOR → BUILD AGENT
 *
 * The manager:
 * - Reads project spec from user
 * - Breaks into phases
 * - Delegates phases to orchestrator
 * - Monitors orchestrator's progress
 * - Reports back to user
 *
 * Prerequisites:
 * - OpenCode server running: opencode serve
 * - LM Studio at 192.168.1.175:1234 with glm-4.5-air@q4_k_m
 *
 * Run: bun run src/orchestrator/demo-manager.ts
 */

const API = "http://127.0.0.1:4096"

async function call(method: string, path: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${method} ${path} failed: ${res.status}\n${text}`)
  }

  return res.json()
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function pollForCompletion(sessionId: string, maxWaitMs = 600000) {
  console.log(`\n⏳ Polling session ${sessionId.substring(0, 20)}... (max ${maxWaitMs / 1000}s)`)
  const start = Date.now()
  let lastMsgCount = 0
  let dots = 0

  while (Date.now() - start < maxWaitMs) {
    const messages = await call("GET", `/session/${sessionId}/message`)

    if (messages.length > lastMsgCount) {
      console.log(`\n  📨 ${messages.length} messages`)
      lastMsgCount = messages.length
      dots = 0

      const last = messages[messages.length - 1]

      if (last.info.role === "assistant" && last.parts.length > 0) {
        const hasToolUse = last.parts.some((p: any) => p.type === "tool_use")

        if (!hasToolUse) {
          console.log(`  ✓ Complete!\n`)
          return messages
        }
      }
    } else {
      // Show progress dots
      process.stdout.write(".")
      dots++
      if (dots >= 20) {
        process.stdout.write("\n  ")
        dots = 0
      }
    }

    await sleep(3000)
  }

  throw new Error(`Timeout after ${maxWaitMs}ms`)
}

async function showTodos(sessionId: string, title: string) {
  const todos = await call("GET", `/session/${sessionId}/todo`)

  console.log(`\n${title}:`)
  if (todos.length === 0) {
    console.log("  (no todos)")
  } else {
    for (const todo of todos) {
      const icon = todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "→" : "○"
      console.log(`  ${icon} [${todo.status}] ${todo.content}`)
    }
  }
}

async function showHierarchy(managerSessionId: string, depth = 0) {
  const indent = "  ".repeat(depth)
  const session = await call("GET", `/session/${managerSessionId}`)

  console.log(`${indent}📁 ${session.title} (${session.id})`)
  await showTodos(session.id, `${indent}   Todos`)

  // Get children
  const children = await call("GET", `/session/${session.id}/children`)

  for (const child of children) {
    await showHierarchy(child.id, depth + 1)
  }
}

async function main() {
  console.log("\n" + "=".repeat(80))
  console.log("MIDDLE MANAGER AUTONOMOUS DEMO")
  console.log("=".repeat(80))
  console.log("\nHierarchy: USER → MANAGER → ORCHESTRATOR → BUILD AGENT\n")

  // Create manager session
  const session = await call("POST", "/session", {
    title: "Demo: Autonomous Manager",
  })

  console.log(`✓ Created manager session: ${session.id}`)

  try {
    // Give manager a project spec
    const projectSpec = `Build a simple calculator library.

Requirements:
1. Create a calculator module with basic operations (add, subtract, multiply, divide)
2. Write unit tests for each operation
3. Create a README with usage examples

Work autonomously - break this into phases, delegate to orchestrators, and manage the whole project yourself.`

    console.log(`\n📋 Project Spec:`)
    console.log(`${projectSpec}\n`)
    console.log("=".repeat(80))

    // Send to manager
    await call("POST", `/session/${session.id}/message`, {
      agent: "manager",
      model: {
        providerID: "lmstudio",
        modelID: "glm-4.5-air@q4_k_m",
      },
      parts: [{ type: "text", text: projectSpec }],
    })

    console.log("\n🚀 Manager is working autonomously...")
    console.log("   Manager will delegate to orchestrator")
    console.log("   Orchestrator will delegate to build agent")
    console.log("   This is the full 3-tier hierarchy!\n")

    // Wait for manager to complete
    await pollForCompletion(session.id)

    // Show full hierarchy
    console.log("\n" + "=".repeat(80))
    console.log("FINAL HIERARCHY")
    console.log("=".repeat(80) + "\n")

    await showHierarchy(session.id)

    console.log("\n" + "=".repeat(80))
    console.log("✅ DEMO COMPLETE - Manager operated autonomously!")
    console.log("=".repeat(80) + "\n")

    // Cleanup all sessions recursively
    async function cleanupSession(sessionId: string) {
      const children = await call("GET", `/session/${sessionId}/children`)
      for (const child of children) {
        await cleanupSession(child.id)
      }
      await call("DELETE", `/session/${sessionId}`)
    }

    console.log("🗑️  Cleaning up all sessions...")
    await cleanupSession(session.id)
    console.log("✓ Cleanup complete\n")

  } catch (error) {
    console.error("\n❌ DEMO FAILED:", error)

    // Try to cleanup anyway
    try {
      const children = await call("GET", `/session/${session.id}/children`)
      for (const child of children) {
        await call("DELETE", `/session/${child.id}`).catch(() => {})
      }
      await call("DELETE", `/session/${session.id}`).catch(() => {})
    } catch {}

    throw error
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
