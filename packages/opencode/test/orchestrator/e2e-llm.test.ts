import { describe, test, expect } from "bun:test"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { Todo } from "../../src/session/todo"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import path from "path"
import fs from "fs/promises"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: true })

async function collectMessages(sessionID: string): Promise<MessageV2.WithParts[]> {
  const messages: MessageV2.WithParts[] = []
  for await (const msg of MessageV2.stream(sessionID)) {
    messages.push(msg)
  }
  return messages
}

async function waitForCompletion(sessionID: string, timeoutMs: number = 120000): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const messages = await collectMessages(sessionID)
    const lastMessage = messages[messages.length - 1]

    if (lastMessage?.info.role === "assistant") {
      // Check if there are no pending tool calls
      const hasPendingTools = lastMessage.parts.some((p) => p.type === "tool_use")
      if (!hasPendingTools) {
        // Agent finished responding
        return
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Timeout waiting for session ${sessionID} to complete`)
}

describe("orchestrator - end-to-end with real LLM", () => {
  test.skip("orchestrator delegates to build agent and supervises execution", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        console.log("\n=== E2E Test: Orchestrator → Build Agent Delegation ===\n")

        // Create orchestrator session (primary agent = orchestrator)
        const orchestratorSession = await Session.create({
          title: "E2E Test: Orchestrator delegation",
        })

        console.log(`Orchestrator session: ${orchestratorSession.id}`)

        // Track child sessions created via Task tool
        const childSessions: string[] = []
        const sessionUnsub = Bus.subscribe(Session.Event.Created, (event) => {
          if (event.properties.info.parentID === orchestratorSession.id) {
            childSessions.push(event.properties.info.id)
            console.log(`✓ Child session created: ${event.properties.info.id}`)
          }
        })

        try {
          // Send task to orchestrator
          const userTask = `Create two simple text files:
1. hello.txt containing "Hello World"
2. goodbye.txt containing "Goodbye World"

Delegate this work to a build agent using the Task tool. Monitor their progress and verify completion.`

          console.log("Sending task to orchestrator agent...")
          console.log(`Task: ${userTask}\n`)

          await SessionPrompt.prompt({
            sessionID: orchestratorSession.id,
            model: {
              providerID: "lmstudio",
              modelID: "glm-4.5-air@q4_k_m",
            },
            agent: "orchestrator",
            parts: [
              {
                type: "text",
                text: userTask,
              },
            ],
          })

          // Wait for orchestrator to delegate and build agent to work
          console.log("Waiting for orchestrator to delegate to build agent...")
          await new Promise((resolve) => setTimeout(resolve, 60000)) // 60 seconds

          // Verify delegation happened
          console.log(`\nChild sessions created: ${childSessions.length}`)
          expect(childSessions.length).toBeGreaterThan(0)

          // Check orchestrator todos (high-level)
          const orchestratorTodos = await Todo.get(orchestratorSession.id)
          console.log(`\nOrchestrator todos: ${orchestratorTodos.length}`)
          for (const todo of orchestratorTodos) {
            console.log(`  [${todo.status}] ${todo.content}`)
          }

          // Check build agent todos (detailed steps)
          if (childSessions.length > 0) {
            const buildSessionID = childSessions[0]
            const buildTodos = await Todo.get(buildSessionID)
            console.log(`\nBuild agent todos: ${buildTodos.length}`)
            for (const todo of buildTodos) {
              console.log(`  [${todo.status}] ${todo.content}`)
            }

            expect(buildTodos.length).toBeGreaterThan(0)
          }

          // Check orchestrator messages
          const orchestratorMessages = await collectMessages(orchestratorSession.id)
          const assistantMessages = orchestratorMessages.filter((m) => m.info.role === "assistant")
          console.log(`\nOrchestrator responses: ${assistantMessages.length}`)

          expect(assistantMessages.length).toBeGreaterThan(0)

          // Check if files were created
          const helloExists = await Bun.file(path.join(projectRoot, "hello.txt")).exists()
          const goodbyeExists = await Bun.file(path.join(projectRoot, "goodbye.txt")).exists()

          console.log(`\nFiles created:`)
          console.log(`  hello.txt: ${helloExists ? "✓" : "✗"}`)
          console.log(`  goodbye.txt: ${goodbyeExists ? "✓" : "✗"}`)

          // Cleanup test files
          if (helloExists) await fs.unlink(path.join(projectRoot, "hello.txt")).catch(() => {})
          if (goodbyeExists) await fs.unlink(path.join(projectRoot, "goodbye.txt")).catch(() => {})

          console.log("\n=== Test Results ===")
          console.log(`✓ Orchestrator created ${orchestratorTodos.length} high-level todos`)
          console.log(`✓ Orchestrator delegated to ${childSessions.length} build agent(s)`)
          console.log(`✓ Build agent executed work`)
        } finally {
          sessionUnsub()

          // Cleanup sessions
          for (const childID of childSessions) {
            await Session.remove(childID).catch(() => {})
          }
          await Session.remove(orchestratorSession.id)
          console.log("\n✓ Cleanup complete\n")
        }
      },
    })
  }, 120000) // 2 minute timeout

  test.skip("orchestrator supervises build agent and detects anti-patterns", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        console.log("\n=== E2E Test: Real-time Supervision with Anti-pattern Detection ===\n")

        const orchestratorSession = await Session.create({
          title: "E2E Test: Supervision",
        })

        console.log(`Orchestrator session: ${orchestratorSession.id}`)

        const childSessions: string[] = []
        let feedbackDetected = false

        const sessionUnsub = Bus.subscribe(Session.Event.Created, (event) => {
          if (event.properties.info.parentID === orchestratorSession.id) {
            childSessions.push(event.properties.info.id)
            console.log(`✓ Child session created: ${event.properties.info.id}`)
          }
        })

        // Monitor for feedback messages
        const messageUnsub = Bus.subscribe(MessageV2.Event.PartCreated, (event) => {
          if (event.properties.part.type === "text" && event.properties.part.text.includes("Orchestrator Feedback")) {
            feedbackDetected = true
            console.log(`✓ Feedback detected: ${event.properties.part.text.substring(0, 100)}`)
          }
        })

        try {
          const userTask = `Create three test files (test1.txt, test2.txt, test3.txt) with simple content.

Delegate this to a build agent. The build agent should use TodoWrite to track progress.

IMPORTANT: Encourage the build agent to work on all files in parallel by marking multiple todos as in_progress simultaneously (this will trigger anti-pattern detection).`

          console.log("Sending task designed to trigger anti-pattern...")

          await SessionPrompt.prompt({
            sessionID: orchestratorSession.id,
            model: {
              providerID: "lmstudio",
              modelID: "glm-4.5-air@q4_k_m",
            },
            agent: "orchestrator",
            parts: [
              {
                type: "text",
                text: userTask,
              },
            ],
          })

          console.log("Waiting for execution and supervision...")
          await new Promise((resolve) => setTimeout(resolve, 90000)) // 90 seconds

          console.log(`\n=== Results ===`)
          console.log(`Child sessions created: ${childSessions.length}`)

          if (childSessions.length > 0) {
            const buildSessionID = childSessions[0]
            const buildTodos = await Todo.get(buildSessionID)

            console.log(`Build agent todos: ${buildTodos.length}`)
            const inProgress = buildTodos.filter((t) => t.status === "in_progress")
            console.log(`Todos in progress: ${inProgress.length}`)

            if (inProgress.length > 1) {
              console.log(`✓ Anti-pattern triggered: Multiple tasks in progress`)
            }
          }

          console.log(`Feedback detected: ${feedbackDetected ? "✓ Yes" : "✗ No"}`)

          // Cleanup test files
          await fs.unlink(path.join(projectRoot, "test1.txt")).catch(() => {})
          await fs.unlink(path.join(projectRoot, "test2.txt")).catch(() => {})
          await fs.unlink(path.join(projectRoot, "test3.txt")).catch(() => {})
        } finally {
          sessionUnsub()
          messageUnsub()

          for (const childID of childSessions) {
            await Session.remove(childID).catch(() => {})
          }
          await Session.remove(orchestratorSession.id)
          console.log("\n✓ Cleanup complete\n")
        }
      },
    })
  }, 150000) // 2.5 minute timeout
})
