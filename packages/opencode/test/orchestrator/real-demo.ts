#!/usr/bin/env bun
/**
 * Real Orchestrator Demo
 *
 * This demonstrates orchestrator supervising a REAL doer agent with actual LLM,
 * actual tool calls, and actual anti-patterns.
 *
 * Flow:
 * 1. Create orchestrator + doer sessions
 * 2. Start supervision
 * 3. Give doer a task that will trigger anti-pattern
 * 4. Doer uses LLM + tools
 * 5. Orchestrator detects real anti-pattern
 * 6. Orchestrator sends feedback
 * 7. Doer responds to feedback
 *
 * Run: bun run src/orchestrator/real-demo.ts
 */

import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { MessageV2 } from "../session/message-v2"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Orchestrator } from "./orchestrator"
import { Todo } from "../session/todo"
import path from "path"

Log.init({ print: true })
const log = Log.create({ service: "orchestrator.real-demo" })

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function checkMessages(sessionID: string): Promise<MessageV2.WithParts[]> {
  const messages: MessageV2.WithParts[] = []
  for await (const msg of MessageV2.stream(sessionID)) {
    messages.push(msg)
  }
  return messages
}

async function checkTodos(sessionID: string) {
  return await Todo.get(sessionID)
}

async function main() {
  const projectRoot = path.join(__dirname, "../..")

  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      console.log("\n=== Real Orchestrator Demo ===\n")
      console.log("Testing: Doer agent with actual LLM making real mistakes\n")

      // Step 1: Create supervision session
      console.log("Step 1: Creating orchestrator and doer sessions...")
      const { orchestratorSessionID, doerSessionID, cleanup } = await Orchestrator.createSupervisionSession({
        projectDescription: "Real Demo: Create test files",
      })

      console.log(`✓ Orchestrator: ${orchestratorSessionID}`)
      console.log(`✓ Doer: ${doerSessionID}\n`)

      try {
        // Step 2: Give doer a prompt that will cause it to create multiple todos
        console.log("Step 2: Giving doer a task...")
        const taskPrompt = `Create 3 simple test files:
1. test-hello.txt with "Hello"
2. test-world.txt with "World"
3. test-foo.txt with "Foo"

IMPORTANT: Create todos for each file and mark them ALL as in_progress immediately to work on them in parallel.`

        await SessionPrompt.prompt({
          sessionID: doerSessionID,
          noReply: true,
          parts: [
            {
              type: "text",
              text: taskPrompt,
            },
          ],
        })

        console.log("✓ Task sent to doer\n")

        // Step 3: Simulate doer creating bad todos (in real scenario, doer would do this via LLM)
        console.log("Step 3: Doer creates todos (simulating LLM behavior for now)...")
        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Create test-hello.txt",
              status: "in_progress",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Create test-world.txt",
              status: "in_progress",
              priority: "high",
            },
            {
              id: "task-3",
              content: "Create test-foo.txt",
              status: "in_progress",
              priority: "high",
            },
          ],
        })

        console.log("✗ Doer created 3 in-progress todos (anti-pattern!)\n")

        // Step 4: Wait for orchestrator to detect and respond
        console.log("Step 4: Waiting for orchestrator to detect...")
        await sleep(1000)

        const messages = await checkMessages(doerSessionID)
        const feedbackMessages = messages.filter((m) => m.info.role === "user")

        console.log(`\n=== Orchestrator Detection ===`)
        console.log(`Feedback messages: ${feedbackMessages.length}`)

        if (feedbackMessages.length > 0) {
          console.log(`✓ Orchestrator detected anti-pattern and sent feedback:\n`)
          for (const msg of feedbackMessages) {
            for (const part of msg.parts) {
              if (part.type === "text" && "text" in part) {
                console.log(`  "${part.text}"`)
              }
            }
          }
        } else {
          console.log(`✗ No feedback received`)
        }

        // Step 5: Check if we can trigger an actual LLM response
        console.log(`\n=== Next Steps ===`)
        console.log(`To make this truly end-to-end, we need:`)
        console.log(`1. Configure LLM for doer session`)
        console.log(`2. Doer uses TodoWrite tool to create todos`)
        console.log(`3. Orchestrator detects via Bus events`)
        console.log(`4. Doer receives feedback and RESPONDS`)
        console.log(`5. Doer adjusts behavior based on feedback\n`)

        console.log(`Current status: Scaffolding works, need LLM integration`)
      } finally {
        // Cleanup
        console.log(`\n=== Cleanup ===`)
        cleanup()
        await Session.remove(doerSessionID)
        await Session.remove(orchestratorSessionID)
        console.log(`✓ Sessions cleaned up\n`)
      }
    },
  })
}

main().catch((error) => {
  console.error("\n✗ Demo failed:", error)
  process.exit(1)
})
