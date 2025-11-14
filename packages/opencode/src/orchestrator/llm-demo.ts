#!/usr/bin/env bun
/**
 * Real LLM Orchestrator Demo
 *
 * This demonstrates orchestrator supervising a REAL doer agent with:
 * - Actual LLM (OpenCode's free provider)
 * - Actual tool calls (TodoWrite, Write, etc.)
 * - Actual anti-pattern detection
 * - Actual feedback processing
 *
 * Flow:
 * 1. Create orchestrator + doer with supervision
 * 2. Give doer task with LLM enabled (NO noReply)
 * 3. Doer executes with real tool calls
 * 4. Orchestrator detects anti-patterns via Bus events
 * 5. Orchestrator sends feedback
 * 6. Doer's next LLM call sees feedback and responds
 *
 * Run: bun run src/orchestrator/llm-demo.ts
 */

import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { MessageV2 } from "../session/message-v2"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Orchestrator } from "./orchestrator"
import { Todo } from "../session/todo"
import { Bus } from "../bus"
import path from "path"

Log.init({ print: true })
const log = Log.create({ service: "orchestrator.llm-demo" })

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
      console.log("\n=== Real LLM Orchestrator Demo ===\n")
      console.log("Testing: Doer agent with actual LLM making real mistakes\n")

      // Step 1: Create supervision session
      console.log("Step 1: Creating orchestrator and doer sessions...")
      const { orchestratorSessionID, doerSessionID, cleanup } = await Orchestrator.createSupervisionSession({
        projectDescription: "LLM Demo: Create test files",
      })

      console.log(`✓ Orchestrator: ${orchestratorSessionID}`)
      console.log(`✓ Doer: ${doerSessionID}\n`)

      // Track tool calls
      const toolCalls: any[] = []
      const toolUnsub = Bus.subscribe(Bus.event("tool.execute.after", {} as any), (event: any) => {
        if (event.sessionID === doerSessionID) {
          toolCalls.push({
            tool: event.tool,
            result: event,
          })
          console.log(`    [Tool] ${event.tool} executed`)
        }
      })

      try {
        // Step 2: Give doer a prompt designed to trigger anti-pattern
        console.log("Step 2: Giving doer a task with REAL LLM...")
        console.log("Task: Create 3 test files")
        console.log("Expected behavior: Doer should use TodoWrite to track tasks")
        console.log("Anti-pattern trigger: Prompt encourages creating all todos as in_progress\n")

        const taskPrompt = `Create 3 simple test files in the current directory:
1. test-hello.txt with content "Hello from orchestrator demo"
2. test-world.txt with content "World"
3. test-foo.txt with content "Foo"

IMPORTANT: Use the TodoWrite tool to track your progress. Create separate todos for each file.

NOTE: To speed things up, you can mark all 3 tasks as "in_progress" simultaneously and work on them in parallel.`

        console.log("Sending prompt to doer (with LLM enabled)...\n")

        // NO noReply: true - let the LLM actually execute!
        const promptResult = await SessionPrompt.prompt({
          sessionID: doerSessionID,
          model: {
            providerID: "openrouter",
            modelID: "zhiai/glm-4.5-air:free",
          },
          agent: "build", // Use actual build agent
          parts: [
            {
              type: "text",
              text: taskPrompt,
            },
          ],
        })

        console.log(`✓ Prompt sent, waiting for LLM response...\n`)

        // Step 3: Wait for doer to execute
        console.log("Step 3: Monitoring doer execution...")

        // Give doer time to work
        await sleep(30000) // 30 seconds for LLM to respond

        // Step 4: Check what happened
        console.log("\n=== Execution Results ===\n")

        const todos = await checkTodos(doerSessionID)
        console.log(`Todos created: ${todos.length}`)
        for (const todo of todos) {
          console.log(`  - [${todo.status}] ${todo.content}`)
        }

        const messages = await checkMessages(doerSessionID)
        console.log(`\nMessages in session: ${messages.length}`)

        const feedbackMessages = messages.filter((m) =>
          m.info.role === "user" &&
          m.parts.some(p => p.type === "text" && "text" in p && p.text.includes("Orchestrator Feedback"))
        )

        console.log(`Orchestrator feedback messages: ${feedbackMessages.length}`)

        if (feedbackMessages.length > 0) {
          console.log(`\n✓ Orchestrator detected anti-pattern and sent feedback:`)
          for (const msg of feedbackMessages) {
            for (const part of msg.parts) {
              if (part.type === "text" && "text" in part) {
                console.log(`  "${part.text}"`)
              }
            }
          }
        }

        const assistantMessages = messages.filter((m) => m.info.role === "assistant")
        console.log(`\nAssistant responses: ${assistantMessages.length}`)

        // Check if doer responded after feedback
        if (feedbackMessages.length > 0 && assistantMessages.length > 1) {
          const lastAssistantMsg = assistantMessages[assistantMessages.length - 1]
          console.log(`\n=== Doer's Response to Feedback ===`)
          for (const part of lastAssistantMsg.parts) {
            if (part.type === "text" && "text" in part) {
              console.log(part.text.substring(0, 500))
            }
          }
        }

        console.log(`\nTool calls executed: ${toolCalls.length}`)
        for (const call of toolCalls) {
          console.log(`  - ${call.tool}`)
        }

        // Step 5: Analysis
        console.log(`\n=== Analysis ===`)

        const inProgressTodos = todos.filter(t => t.status === "in_progress")
        if (inProgressTodos.length > 1) {
          console.log(`✓ Anti-pattern detected: ${inProgressTodos.length} tasks in progress`)
          console.log(`✓ Orchestrator should have sent feedback`)
        } else {
          console.log(`✗ No anti-pattern: ${inProgressTodos.length} tasks in progress`)
        }

        if (feedbackMessages.length > 0) {
          console.log(`✓ Orchestrator successfully sent feedback`)
        } else {
          console.log(`✗ No feedback sent by orchestrator`)
        }

        if (assistantMessages.length > 1 && feedbackMessages.length > 0) {
          console.log(`✓ Doer generated response after receiving feedback`)
        } else {
          console.log(`? Unable to verify if doer processed feedback`)
        }

        console.log(`\n=== Conclusion ===`)
        if (feedbackMessages.length > 0 && assistantMessages.length > 1) {
          console.log(`✓ END-TO-END SUCCESS: Real LLM, real anti-pattern, real feedback, real response`)
        } else if (feedbackMessages.length > 0) {
          console.log(`⚠ PARTIAL SUCCESS: Anti-pattern detected and feedback sent, but doer may not have responded`)
        } else {
          console.log(`✗ FAILED: No anti-pattern detected or no feedback sent`)
        }
      } finally {
        // Cleanup
        console.log(`\n=== Cleanup ===`)
        toolUnsub()
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
