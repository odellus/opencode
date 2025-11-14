#!/usr/bin/env bun
/**
 * Orchestrator Execution Harness
 *
 * This is a working implementation that demonstrates orchestrator supervision.
 * It simulates a full doer workflow to show how orchestrator monitors and intervenes.
 *
 * Lifecycle:
 * 1. Create orchestrator + doer sessions
 * 2. Set up Bus-based supervision
 * 3. Simulate doer workflow (creating todos, working on tasks)
 * 4. Trigger anti-patterns
 * 5. Orchestrator detects and provides feedback
 * 6. Verify feedback was sent
 *
 * Run: bun run src/orchestrator/demo.ts
 */

import { Session } from "../session"
import { Todo } from "../session/todo"
import { MessageV2 } from "../session/message-v2"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Orchestrator } from "./orchestrator"
import path from "path"

Log.init({ print: true })
const log = Log.create({ service: "orchestrator.demo" })

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

async function main() {
  const projectRoot = path.join(__dirname, "../..")

  await Instance.provide({
    directory: projectRoot,
    fn: async () => {
      console.log("\n=== Orchestrator Execution Harness ===\n")

      // Step 1: Create supervision session
      console.log("Step 1: Creating orchestrator and doer sessions...")
      const { orchestratorSessionID, doerSessionID, cleanup } = await Orchestrator.createSupervisionSession({
        projectDescription: "Demo: Multi-file refactoring",
      })

      console.log(`✓ Orchestrator session: ${orchestratorSessionID}`)
      console.log(`✓ Doer session: ${doerSessionID}\n`)

      // Step 2: Simulate good doer behavior first
      console.log("Step 2: Doer starts with good behavior (one task at a time)...")
      await Todo.update({
        sessionID: doerSessionID,
        todos: [
          {
            id: "task-1",
            content: "Read project structure",
            status: "in_progress",
            priority: "high",
          },
          {
            id: "task-2",
            content: "Refactor auth module",
            status: "pending",
            priority: "high",
          },
          {
            id: "task-3",
            content: "Write tests",
            status: "pending",
            priority: "medium",
          },
        ],
      })

      await sleep(200)
      const messages1 = await checkMessages(doerSessionID)
      console.log(`✓ Doer has ${messages1.length} messages (should be 0 - no anti-patterns)`)

      // Step 3: Doer completes first task
      console.log("\nStep 3: Doer completes first task...")
      await Todo.update({
        sessionID: doerSessionID,
        todos: [
          {
            id: "task-1",
            content: "Read project structure",
            status: "completed",
            priority: "high",
          },
          {
            id: "task-2",
            content: "Refactor auth module",
            status: "in_progress",
            priority: "high",
          },
          {
            id: "task-3",
            content: "Write tests",
            status: "pending",
            priority: "medium",
          },
        ],
      })

      await sleep(200)
      const messages2 = await checkMessages(doerSessionID)
      console.log(`✓ Still ${messages2.length} messages (good behavior continues)\n`)

      // Step 4: Doer exhibits anti-pattern (multiple in-progress)
      console.log("Step 4: Doer exhibits anti-pattern - multiple tasks in progress!")
      await Todo.update({
        sessionID: doerSessionID,
        todos: [
          {
            id: "task-1",
            content: "Read project structure",
            status: "completed",
            priority: "high",
          },
          {
            id: "task-2",
            content: "Refactor auth module",
            status: "in_progress",
            priority: "high",
          },
          {
            id: "task-3",
            content: "Write tests",
            status: "in_progress",
            priority: "high",
          },
          {
            id: "task-4",
            content: "Update documentation",
            status: "in_progress",
            priority: "medium",
          },
        ],
      })

      console.log("✗ Doer now has 3 tasks in progress (anti-pattern!)")

      // Step 5: Wait for orchestrator to detect and respond
      console.log("\nStep 5: Waiting for orchestrator to detect and respond...")
      await sleep(2000) // Longer wait to allow message creation to complete

      const messages3 = await checkMessages(doerSessionID)
      const feedbackMessages = messages3.filter((m) => m.info.role === "user")

      console.log(`\nDEBUG: All messages:`)
      for (const msg of messages3) {
        console.log(`  - Role: ${msg.info.role}, Parts: ${msg.parts.length}`)
        for (const part of msg.parts) {
          if (part.type === "text" && "text" in part) {
            console.log(`    Text: ${part.text.substring(0, 100)}`)
          }
        }
      }

      console.log(`\n=== Results ===`)
      console.log(`Total messages in doer session: ${messages3.length}`)
      console.log(`Feedback messages from orchestrator: ${feedbackMessages.length}`)

      if (feedbackMessages.length > 0) {
        console.log(`\n✓ Orchestrator successfully detected anti-pattern and sent feedback:`)
        for (const msg of feedbackMessages) {
          const textParts = msg.parts.filter((p) => p.type === "text")
          for (const part of textParts) {
            if ("text" in part) {
              console.log(`  "${part.text}"`)
            }
          }
        }
      } else {
        console.log(`\n✗ No feedback received - orchestrator may not be working correctly`)
      }

      // Cleanup
      console.log(`\n=== Cleanup ===`)
      cleanup()
      await Session.remove(doerSessionID)
      await Session.remove(orchestratorSessionID)
      console.log(`✓ Sessions cleaned up\n`)
    },
  })
}

main().catch((error) => {
  console.error("\n✗ Demo failed:", error)
  process.exit(1)
})
