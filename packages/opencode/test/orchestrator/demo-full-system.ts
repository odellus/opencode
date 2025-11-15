#!/usr/bin/env bun
/**
 * Full system demo: Architect → Supervisor → Build
 * Tests the complete 3-tier autonomous agent hierarchy
 * Run with: bun ./src/orchestrator/demo-full-system.ts
 */

const API_BASE = "http://127.0.0.1:4096"
const MODEL = { providerID: "lmstudio", modelID: "glm-4.5-air@q4_k_m" }

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

async function pollSession(sessionID: string, intervalMs = 3000, maxIterations = 60) {
  console.log(`\n📊 Monitoring session ${sessionID}...`)

  let previousMessageCount = 0
  let previousTodoSnapshot = ""

  for (let i = 0; i < maxIterations; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))

    // Get messages
    const messages: Message[] = await call("GET", `/session/${sessionID}/message`)

    // Get todos
    const todos: Todo[] = await call("GET", `/session/${sessionID}/todo`)

    // Display updates
    if (messages.length > previousMessageCount) {
      const newMessages = messages.slice(previousMessageCount)
      for (const msg of newMessages) {
        const role = msg.role.toUpperCase()
        console.log(`\n💬 [${role}] in session ${sessionID}`)
      }
      previousMessageCount = messages.length
    }

    // Display todo changes
    const todoSnapshot = JSON.stringify(todos)
    if (todoSnapshot !== previousTodoSnapshot) {
      console.log(`\n📋 Todos for ${sessionID}:`)
      todos.forEach((todo) => {
        const icon = todo.status === "completed" ? "✅" : todo.status === "in_progress" ? "🔄" : "⏳"
        console.log(`   ${icon} ${todo.content} [${todo.status}]`)
      })
      previousTodoSnapshot = todoSnapshot
    }

    // Check completion
    const allComplete = todos.length > 0 && todos.every((t) => t.status === "completed")
    if (allComplete) {
      console.log(`\n✨ All todos completed for session ${sessionID}`)
      return { messages, todos }
    }

    // Check if conversation seems stuck
    if (i > 10 && messages.length === previousMessageCount) {
      console.log(`\n⚠️  No activity detected for ${i} iterations, stopping monitoring`)
      return { messages, todos }
    }
  }

  console.log(`\n⏱️  Max iterations reached for ${sessionID}`)
  const messages: Message[] = await call("GET", `/session/${sessionID}/message`)
  const todos: Todo[] = await call("GET", `/session/${sessionID}/todo`)
  return { messages, todos }
}

async function monitorHierarchy(rootSessionID: string, depth = 0) {
  const indent = "  ".repeat(depth)

  // Get session info
  const session: Session = await call("GET", `/session/${rootSessionID}`)
  console.log(`${indent}📁 Session: ${session.title} (${session.id})`)

  // Get todos
  const todos: Todo[] = await call("GET", `/session/${rootSessionID}/todo`)
  if (todos.length > 0) {
    console.log(
      `${indent}   Todos: ${todos.length} (${todos.filter((t) => t.status === "completed").length} completed)`,
    )
  }

  // Get children
  const children: Session[] = await call("GET", `/session/${rootSessionID}/children`)
  if (children.length > 0) {
    console.log(`${indent}   Children: ${children.length}`)
    for (const child of children) {
      await monitorHierarchy(child.id, depth + 1)
    }
  }
}

async function demoSupervisor() {
  console.log("=" + "=".repeat(70))
  console.log("DEMO 1: Supervisor → Build Agent Delegation")
  console.log("=" + "=".repeat(70))

  const session: Session = await call("POST", "/session", {
    title: "Demo: Supervisor delegation",
  })

  const task = `Create three files:
1. config.json - with basic app configuration
2. README.md - explaining the project
3. main.ts - with a hello world function

Use proper formatting and complete all files.`

  console.log(`\n📤 Sending task to supervisor (session ${session.id})`)
  console.log(`Task: ${task}`)

  await call("POST", `/session/${session.id}/message`, {
    agent: "supervisor",
    model: MODEL,
    parts: [{ type: "text", text: task }],
  })

  const result = await pollSession(session.id, 3000, 60)

  console.log(`\n📊 Session hierarchy:`)
  await monitorHierarchy(session.id)

  console.log(`\n✅ Demo 1 complete!`)
  console.log(`   Messages: ${result.messages.length}`)
  console.log(
    `   Todos: ${result.todos.length} (${result.todos.filter((t) => t.status === "completed").length} completed)`,
  )

  return session.id
}

async function demoArchitect() {
  console.log("\n" + "=" + "=".repeat(70))
  console.log("DEMO 2: Architect → Supervisor → Build Hierarchy")
  console.log("=" + "=".repeat(70))

  const session: Session = await call("POST", "/session", {
    title: "Demo: Architect multi-phase project",
  })

  const task = `Build a simple TypeScript project with these components:

Phase 1: Project setup
- Create package.json with TypeScript dependencies
- Create tsconfig.json with strict settings

Phase 2: Implementation
- Create src/utils.ts with helper functions
- Create src/main.ts that uses the utilities

Complete each phase fully before moving to the next.`

  console.log(`\n📤 Sending task to architect (session ${session.id})`)
  console.log(`Task: ${task}`)

  await call("POST", `/session/${session.id}/message`, {
    agent: "architect",
    model: MODEL,
    parts: [{ type: "text", text: task }],
  })

  const result = await pollSession(session.id, 4000, 90)

  console.log(`\n📊 Full session hierarchy:`)
  await monitorHierarchy(session.id)

  console.log(`\n✅ Demo 2 complete!`)
  console.log(`   Messages: ${result.messages.length}`)
  console.log(
    `   Todos: ${result.todos.length} (${result.todos.filter((t) => t.status === "completed").length} completed)`,
  )

  return session.id
}

async function demoConversationContinuation() {
  console.log("\n" + "=" + "=".repeat(70))
  console.log("DEMO 3: Conversation Continuation (Premature Stop)")
  console.log("=" + "=".repeat(70))

  const session: Session = await call("POST", "/session", {
    title: "Demo: Conversation continuation",
  })

  const task = `Create a database schema file. Include tables for users and posts.`

  console.log(`\n📤 Sending task to supervisor (session ${session.id})`)
  console.log(`Task: ${task}`)

  await call("POST", `/session/${session.id}/message`, {
    agent: "supervisor",
    model: MODEL,
    parts: [{ type: "text", text: task }],
  })

  // Monitor for continuation behavior
  let continuationDetected = false
  const startTime = Date.now()

  while (Date.now() - startTime < 90000) {
    await new Promise((resolve) => setTimeout(resolve, 3000))

    const messages: Message[] = await call("GET", `/session/${session.id}/message`)
    const todos: Todo[] = await call("GET", `/session/${session.id}/todo`)

    // Look for orchestrator feedback messages (indication of continuation)
    const feedbackMessages = messages.filter((m) => m.role === "user")
    if (feedbackMessages.length > 1) {
      continuationDetected = true
      console.log(`\n🔄 Continuation detected! Supervisor sent feedback to keep conversation going.`)
    }

    const allComplete = todos.length > 0 && todos.every((t) => t.status === "completed")
    if (allComplete) break
  }

  const result = await call("GET", `/session/${session.id}/message`)
  const todos = await call("GET", `/session/${session.id}/todo`)

  console.log(`\n✅ Demo 3 complete!`)
  console.log(`   Continuation detected: ${continuationDetected}`)
  console.log(`   Messages: ${result.length}`)
  console.log(`   Todos: ${todos.length} (${todos.filter((t: Todo) => t.status === "completed").length} completed)`)

  return session.id
}

async function main() {
  console.log("\n🚀 Starting full system demo...")
  console.log(`API: ${API_BASE}`)
  console.log(`Model: ${MODEL.providerID}/${MODEL.modelID}`)

  try {
    // Run demos sequentially
    await demoSupervisor()
    await new Promise((resolve) => setTimeout(resolve, 2000))

    await demoArchitect()
    await new Promise((resolve) => setTimeout(resolve, 2000))

    await demoConversationContinuation()

    console.log("\n" + "=" + "=".repeat(70))
    console.log("🎉 ALL DEMOS COMPLETE!")
    console.log("=" + "=".repeat(70))

    console.log("\n📝 Check the following:")
    console.log("   1. Files were created in the working directory")
    console.log("   2. Langfuse dashboard at http://localhost:3044 for traces")
    console.log("   3. Session hierarchies show parent-child relationships")
    console.log("   4. Todos show progression through tasks")
  } catch (error) {
    console.error("\n❌ Demo failed:", error)
    process.exit(1)
  }
}

main()
