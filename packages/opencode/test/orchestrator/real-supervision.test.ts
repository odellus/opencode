/**
 * REAL supervision tests - NO MOCKING
 * Tests the actual orchestrator with real LLM calls
 */

import { test, expect } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Orchestrator } from "../../src/orchestrator/orchestrator"
import { Todo } from "../../src/session/todo"
import { MessageV2 } from "../../src/session/message-v2"
import { tmpdir } from "../fixture/fixture"
import { Bus } from "../../src/bus"

// Users can override with environment variables
// Default to lmstudio if configured in this project
const TEST_MODEL = {
  providerID: process.env.TEST_PROVIDER_ID || "lmstudio",
  modelID: process.env.TEST_MODEL_ID || "glm-4.5-air@q4_k_m",
}

console.log(`\n🧪 Running real LLM tests with:`)
console.log(`  Provider: ${TEST_MODEL.providerID}`)
console.log(`  Model: ${TEST_MODEL.modelID}`)
console.log(`  Note: Set TEST_PROVIDER_ID and TEST_MODEL_ID to use different model\n`)

test("real orchestrator supervises real build agent creating files", async () => {
  await using tmp = await tmpdir()
  // Use current directory for config, tmp for file operations
  await Instance.provide({
    directory: process.cwd(), // Use real project directory for provider config
    fn: async () => {
      // Create supervisor session
      const supervisorSession = await Session.create({
        title: "Real Supervisor Test",
      })

      // Create build agent session as child
      const buildSession = await Session.create({
        title: "Real Build Agent",
        parentID: supervisorSession.id,
      })

      // Track events
      const todoChanges: Array<{ type: string; todos: Todo.Info[] }> = []
      const messageEvents: Array<{ role: string; sessionID: string }> = []

      const todoUnsub = Bus.subscribe(Todo.Event.Updated, (event) => {
        if (event.properties.sessionID === buildSession.id) {
          todoChanges.push({
            type: "todo_updated",
            todos: [...event.properties.todos],
          })
        }
      })

      const msgUnsub = Bus.subscribe(MessageV2.Event.Updated, (event) => {
        if (event.properties.info.sessionID === buildSession.id) {
          messageEvents.push({
            role: event.properties.info.role,
            sessionID: event.properties.info.sessionID,
          })
        }
      })

      // Start supervision
      const cleanup = await Orchestrator.supervise({
        orchestratorSessionID: supervisorSession.id,
        doerSessionID: buildSession.id,
      })

      // Give the build agent a REAL task
      const task = "Create two files: alpha.txt with content 'First file' and beta.txt with content 'Second file'"

      await SessionPrompt.prompt({
        sessionID: buildSession.id,
        model: TEST_MODEL,
        parts: [
          {
            type: "text",
            text: task,
          },
        ],
      })

      // Wait for completion (real LLM takes time)
      let attempts = 0
      const maxAttempts = 60 // 2 minutes max
      let completed = false

      while (attempts < maxAttempts && !completed) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        attempts++

        const todos = await Todo.get(buildSession.id)
        const allComplete = todos.length > 0 && todos.every((t) => t.status === "completed")

        if (allComplete) {
          completed = true
          break
        }

        // Check if conversation stopped (no new messages for a while)
        const messages: MessageV2.WithParts[] = []
        for await (const msg of MessageV2.stream(buildSession.id)) {
          messages.push(msg)
        }

        if (messages.length > 0) {
          const lastMsg = messages[messages.length - 1]
          // If last message is assistant and we've been waiting, might be stuck
          if (lastMsg.info.role === "assistant" && attempts > 5) {
            // Give it a bit more time
            if (attempts > 10) {
              console.log("Conversation may be stuck, ending test")
              break
            }
          }
        }
      }

      // Verify files were created
      const alphaExists = await Bun.file(`${tmp.path}/alpha.txt`).exists()
      const betaExists = await Bun.file(`${tmp.path}/beta.txt`).exists()

      console.log(`\n📊 Test Results:`)
      console.log(`  Todo changes detected: ${todoChanges.length}`)
      console.log(`  Message events detected: ${messageEvents.length}`)
      console.log(`  Alpha file created: ${alphaExists}`)
      console.log(`  Beta file created: ${betaExists}`)

      if (alphaExists) {
        const alphaContent = await Bun.file(`${tmp.path}/alpha.txt`).text()
        console.log(`  Alpha content: "${alphaContent.trim()}"`)
      }

      if (betaExists) {
        const betaContent = await Bun.file(`${tmp.path}/beta.txt`).text()
        console.log(`  Beta content: "${betaContent.trim()}"`)
      }

      // Assertions
      expect(todoChanges.length).toBeGreaterThan(0) // Should have detected todo changes
      expect(messageEvents.length).toBeGreaterThan(0) // Should have detected messages
      expect(alphaExists).toBe(true) // File should exist
      expect(betaExists).toBe(true) // File should exist

      // Cleanup
      cleanup()
      todoUnsub()
      msgUnsub()
    },
  })
}, 300000) // 5 minute timeout for slow local LLM

test("real supervisor delegates to real build agent", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      // Create supervisor session
      const session = await Session.create({
        title: "Real Supervisor Delegation Test",
      })

      // Track child sessions created
      let childSessionCreated = false
      const sessionUnsub = Bus.subscribe(Session.Event.Created, (event) => {
        if (event.properties.info.parentID === session.id) {
          childSessionCreated = true
          console.log(`  Child session created: ${event.properties.info.id}`)
        }
      })

      // Send task to supervisor agent
      const task = "Create a file called test.txt with the content 'Hello from real supervisor'"

      await SessionPrompt.prompt({
        sessionID: session.id,
        model: TEST_MODEL,
        parts: [
          {
            type: "text",
            text: `You are the supervisor agent. ${task}`,
          },
        ],
      })

      // Wait for completion
      let attempts = 0
      const maxAttempts = 60
      let completed = false

      while (attempts < maxAttempts && !completed) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        attempts++

        const todos = await Todo.get(session.id)
        const allComplete = todos.length > 0 && todos.every((t) => t.status === "completed")

        if (allComplete) {
          completed = true
          break
        }

        // Check for file creation
        const fileExists = await Bun.file(`${tmp.path}/test.txt`).exists()
        if (fileExists) {
          completed = true
          break
        }

        if (attempts > 30) {
          console.log(`  Attempt ${attempts}/${maxAttempts}...`)
        }
      }

      // Verify results
      const fileExists = await Bun.file(`${tmp.path}/test.txt`).exists()

      console.log(`\n📊 Test Results:`)
      console.log(`  Child session created: ${childSessionCreated}`)
      console.log(`  File created: ${fileExists}`)

      if (fileExists) {
        const content = await Bun.file(`${tmp.path}/test.txt`).text()
        console.log(`  File content: "${content.trim()}"`)
        expect(content).toContain("Hello")
      }

      expect(fileExists).toBe(true)

      // Cleanup
      sessionUnsub()
    },
  })
}, 300000)

test("real conversation continuation when agent stops early", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      // Create supervisor and build sessions
      const supervisorSession = await Session.create({
        title: "Continuation Test Supervisor",
      })

      const buildSession = await Session.create({
        title: "Continuation Test Build",
        parentID: supervisorSession.id,
      })

      // Track continuation attempts
      let continuationAttempts = 0

      const msgUnsub = Bus.subscribe(MessageV2.Event.Updated, (event) => {
        if (event.properties.info.sessionID === buildSession.id) {
          if (event.properties.info.role === "user") {
            // Check if this is a continuation message from orchestrator
            MessageV2.get({ sessionID: buildSession.id, messageID: event.properties.info.id }).then((msg) => {
              const textParts = msg.parts.filter((p) => p.type === "text")
              for (const part of textParts) {
                if (part.type === "text" && part.text.includes("Orchestrator Feedback")) {
                  continuationAttempts++
                  console.log(`  🔄 Continuation attempt #${continuationAttempts}`)
                }
              }
            })
          }
        }
      })

      // Start supervision
      const cleanup = await Orchestrator.supervise({
        orchestratorSessionID: supervisorSession.id,
        doerSessionID: buildSession.id,
      })

      // Give a task that might cause early stopping
      const task = "Create a configuration file. Make it a JSON file with some settings."

      await SessionPrompt.prompt({
        sessionID: buildSession.id,
        model: TEST_MODEL,
        parts: [{ type: "text", text: task }],
      })

      // Wait and monitor
      let attempts = 0
      const maxAttempts = 45

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        attempts++

        // Check if any JSON file was created
        const files = await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: tmp.path }))

        if (files.length > 0) {
          console.log(`  ✅ JSON file created: ${files[0]}`)
          break
        }

        if (attempts > 20) {
          console.log(`  Waiting... attempt ${attempts}/${maxAttempts}`)
        }
      }

      // Results
      const files = await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: tmp.path }))

      console.log(`\n📊 Test Results:`)
      console.log(`  Continuation attempts: ${continuationAttempts}`)
      console.log(`  Files created: ${files.length}`)

      if (files.length > 0) {
        console.log(`  File: ${files[0]}`)
        const content = await Bun.file(`${tmp.path}/${files[0]}`).text()
        console.log(`  Content length: ${content.length} bytes`)
      }

      expect(files.length).toBeGreaterThan(0)

      // Cleanup
      cleanup()
      msgUnsub()
    },
  })
}, 300000)
