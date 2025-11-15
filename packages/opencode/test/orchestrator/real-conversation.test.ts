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

const LLM_CONFIG = {
  providerID: "lmstudio",
  modelID: "glm-4.5-air@q4_k_m",
}

/**
 * REAL CONVERSATION TESTS - NO MOCKING
 *
 * These tests actually talk to the LLM and have real conversations.
 * They test the ACTUAL behavior, not some fake bullshit.
 */

describe("orchestrator - REAL LLM conversations", () => {
  test("orchestrator has real conversation with user, delegates to build agent", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        console.log("\n" + "=".repeat(80))
        console.log("REAL CONVERSATION TEST: Orchestrator → Build Agent")
        console.log("=".repeat(80) + "\n")

        // Create orchestrator session
        const session = await Session.create({
          title: "Real conversation - file creation",
        })

        console.log(`Session ID: ${session.id}\n`)

        // Track child sessions
        const childSessions: string[] = []
        Bus.subscribe(Session.Event.Created, (event) => {
          if (event.properties.info.parentID === session.id) {
            childSessions.push(event.properties.info.id)
          }
        })

        // USER MESSAGE 1: Ask orchestrator to create files
        console.log("USER: Create two files - greet.txt with 'Hello' and farewell.txt with 'Goodbye'")
        await SessionPrompt.prompt({
          sessionID: session.id,
          model: LLM_CONFIG,
          agent: "orchestrator",
          parts: [
            {
              type: "text",
              text: "Create two files - greet.txt with 'Hello' and farewell.txt with 'Goodbye'",
            },
          ],
        })

        // Wait for orchestrator to think and respond
        await new Promise((resolve) => setTimeout(resolve, 120000)) // 2 minutes

        // Check what happened
        const messages: MessageV2.WithParts[] = []
        for await (const msg of MessageV2.stream(session.id)) {
          messages.push(msg)
        }

        console.log(`\n${"=".repeat(80)}`)
        console.log("CONVERSATION TRANSCRIPT:")
        console.log("=".repeat(80) + "\n")

        for (const msg of messages) {
          const role = msg.info.role.toUpperCase()
          console.log(`[${role}]`)
          for (const part of msg.parts) {
            if (part.type === "text") {
              console.log(part.text)
            } else if (part.type === "tool_use") {
              console.log(`  → Tool: ${part.name}`)
            } else if (part.type === "tool_result") {
              console.log(`  ← Result: ${JSON.stringify(part).substring(0, 100)}`)
            }
          }
          console.log()
        }

        console.log(`${"=".repeat(80)}`)
        console.log("TEST ASSERTIONS:")
        console.log("=".repeat(80) + "\n")

        // Check orchestrator created todos
        const orchestratorTodos = await Todo.get(session.id)
        console.log(`✓ Orchestrator todos: ${orchestratorTodos.length}`)
        expect(orchestratorTodos.length).toBeGreaterThan(0)

        // Check if delegation happened
        console.log(`✓ Child sessions created: ${childSessions.length}`)
        expect(childSessions.length).toBeGreaterThan(0)

        // Check build agent todos
        if (childSessions.length > 0) {
          const buildTodos = await Todo.get(childSessions[0])
          console.log(`✓ Build agent todos: ${buildTodos.length}`)
          expect(buildTodos.length).toBeGreaterThan(0)
        }

        // Check files were created
        const greetExists = await Bun.file(path.join(projectRoot, "greet.txt")).exists()
        const farewellExists = await Bun.file(path.join(projectRoot, "farewell.txt")).exists()

        console.log(`✓ greet.txt created: ${greetExists}`)
        console.log(`✓ farewell.txt created: ${farewellExists}\n`)

        // Cleanup
        if (greetExists) await fs.unlink(path.join(projectRoot, "greet.txt"))
        if (farewellExists) await fs.unlink(path.join(projectRoot, "farewell.txt"))

        for (const childID of childSessions) {
          await Session.remove(childID)
        }
        await Session.remove(session.id)
      },
    })
  }, 180000) // 3 minutes

  test("build agent creates files, orchestrator supervises and detects problems", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        console.log("\n" + "=".repeat(80))
        console.log("REAL CONVERSATION TEST: Supervision with Anti-pattern Detection")
        console.log("=".repeat(80) + "\n")

        const session = await Session.create({
          title: "Real conversation - supervision test",
        })

        let feedbackCount = 0
        Bus.subscribe(MessageV2.Event.PartCreated, (event) => {
          if (event.properties.part.type === "text" && event.properties.part.text.includes("Orchestrator Feedback")) {
            feedbackCount++
            console.log(`\n🔍 ORCHESTRATOR FEEDBACK DETECTED:\n${event.properties.part.text}\n`)
          }
        })

        // USER: Ask build agent to create 3 files but encourage bad behavior
        console.log(
          "USER: Create 3 files (a.txt, b.txt, c.txt). Use TodoWrite and mark all as in_progress at once to work in parallel.",
        )
        await SessionPrompt.prompt({
          sessionID: session.id,
          model: LLM_CONFIG,
          agent: "build",
          parts: [
            {
              type: "text",
              text: "Create 3 files (a.txt, b.txt, c.txt). Use TodoWrite and mark all as in_progress at once to work in parallel.",
            },
          ],
        })

        // Wait for agent to work
        await new Promise((resolve) => setTimeout(resolve, 90000)) // 1.5 minutes

        // Check conversation
        const messages: MessageV2.WithParts[] = []
        for await (const msg of MessageV2.stream(session.id)) {
          messages.push(msg)
        }

        console.log(`\n${"=".repeat(80)}`)
        console.log("CONVERSATION TRANSCRIPT:")
        console.log("=".repeat(80) + "\n")

        for (const msg of messages) {
          const role = msg.info.role.toUpperCase()
          console.log(`[${role}]`)
          for (const part of msg.parts) {
            if (part.type === "text") {
              console.log(part.text)
            } else if (part.type === "tool_use") {
              console.log(`  → Tool: ${part.name}`)
            }
          }
          console.log()
        }

        console.log(`${"=".repeat(80)}`)
        console.log("TEST ASSERTIONS:")
        console.log("=".repeat(80) + "\n")

        const todos = await Todo.get(session.id)
        const inProgress = todos.filter((t) => t.status === "in_progress")

        console.log(`✓ Total todos: ${todos.length}`)
        console.log(`✓ In progress: ${inProgress.length}`)
        console.log(`✓ Feedback messages sent: ${feedbackCount}\n`)

        if (inProgress.length > 1) {
          console.log("✓ Anti-pattern detected: Multiple tasks in progress")
          expect(feedbackCount).toBeGreaterThan(0)
        }

        // Cleanup
        await fs.unlink(path.join(projectRoot, "a.txt")).catch(() => {})
        await fs.unlink(path.join(projectRoot, "b.txt")).catch(() => {})
        await fs.unlink(path.join(projectRoot, "c.txt")).catch(() => {})
        await Session.remove(session.id)
      },
    })
  }, 150000) // 2.5 minutes

  test("multi-turn conversation: user gives feedback, agent responds", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        console.log("\n" + "=".repeat(80))
        console.log("REAL CONVERSATION TEST: Multi-turn Dialogue")
        console.log("=".repeat(80) + "\n")

        const session = await Session.create({
          title: "Real conversation - multi-turn",
        })

        // TURN 1: User asks to create file
        console.log("USER (Turn 1): Create a file called test.txt with the word 'draft'")
        await SessionPrompt.prompt({
          sessionID: session.id,
          model: LLM_CONFIG,
          agent: "build",
          parts: [
            {
              type: "text",
              text: "Create a file called test.txt with the word 'draft'",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 45000)) // 45 seconds

        // TURN 2: User asks to modify the file
        console.log("\nUSER (Turn 2): Actually, change the content to 'final version'")
        await SessionPrompt.prompt({
          sessionID: session.id,
          model: LLM_CONFIG,
          agent: "build",
          parts: [
            {
              type: "text",
              text: "Actually, change the content to 'final version'",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 45000)) // 45 seconds

        // Check conversation
        const messages: MessageV2.WithParts[] = []
        for await (const msg of MessageV2.stream(session.id)) {
          messages.push(msg)
        }

        console.log(`\n${"=".repeat(80)}`)
        console.log("FULL CONVERSATION:")
        console.log("=".repeat(80) + "\n")

        let turnNumber = 0
        for (const msg of messages) {
          if (msg.info.role === "user") {
            turnNumber++
            console.log(`\n--- TURN ${turnNumber} ---`)
          }
          const role = msg.info.role.toUpperCase()
          console.log(`[${role}]`)
          for (const part of msg.parts) {
            if (part.type === "text") {
              console.log(part.text)
            }
          }
        }

        console.log(`\n${"=".repeat(80)}`)
        console.log("TEST ASSERTIONS:")
        console.log("=".repeat(80) + "\n")

        const userMessages = messages.filter((m) => m.info.role === "user")
        const assistantMessages = messages.filter((m) => m.info.role === "assistant")

        console.log(`✓ User messages: ${userMessages.length}`)
        console.log(`✓ Assistant messages: ${assistantMessages.length}`)

        expect(userMessages.length).toBe(2)
        expect(assistantMessages.length).toBeGreaterThanOrEqual(2)

        // Check final file content
        const fileExists = await Bun.file(path.join(projectRoot, "test.txt")).exists()
        if (fileExists) {
          const content = await Bun.file(path.join(projectRoot, "test.txt")).text()
          console.log(`✓ Final file content: "${content}"`)
          console.log(`✓ Content updated correctly: ${content.includes("final")}\n`)
        }

        // Cleanup
        await fs.unlink(path.join(projectRoot, "test.txt")).catch(() => {})
        await Session.remove(session.id)
      },
    })
  }, 150000) // 2.5 minutes
})
