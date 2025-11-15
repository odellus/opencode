#!/usr/bin/env bun
/**
 * Simple real test that writes conversation to markdown
 * Run with: bun test/orchestrator/real-test-simple.ts
 */

import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Orchestrator } from "../../src/orchestrator/orchestrator"
import { Todo } from "../../src/session/todo"
import { MessageV2 } from "../../src/session/message-v2"
import { Bus } from "../../src/bus"
import fs from "fs"
import path from "path"

const TEST_MODEL = {
  providerID: "lmstudio",
  modelID: "glm-4.5-air@q4_k_m",
}

const OUTPUT_FILE = "/tmp/orchestrator-test-conversation.md"

function log(message: string) {
  console.log(message)
  fs.appendFileSync(OUTPUT_FILE, message + "\n")
}

async function writeConversationToMarkdown(sessionID: string, title: string) {
  const messages: MessageV2.WithParts[] = []
  for await (const msg of MessageV2.stream(sessionID)) {
    messages.push(msg)
  }

  let md = `# ${title}\n\n`
  md += `Session ID: \`${sessionID}\`\n\n`
  md += `Total Messages: ${messages.length}\n\n`
  md += `Generated: ${new Date().toISOString()}\n\n`
  md += `---\n\n`

  let messageNum = 0
  for (const msg of messages) {
    messageNum++
    const role = msg.info.role === "user" ? "👤 USER" : "🤖 ASSISTANT"
    const timestamp = new Date(msg.info.time.created).toISOString()

    md += `## Message ${messageNum}: ${role}\n\n`
    md += `**Time**: ${timestamp}\n\n`

    if (msg.info.role === "assistant") {
      const assistantInfo = msg.info as any
      md += `**Model**: ${assistantInfo.providerID}/${assistantInfo.modelID}\n\n`
      if (assistantInfo.tokens) {
        md += `**Tokens**: Input=${assistantInfo.tokens.input}, Output=${assistantInfo.tokens.output}\n\n`
      }
    }

    md += `**Parts**: ${msg.parts.length}\n\n`

    for (let i = 0; i < msg.parts.length; i++) {
      const part = msg.parts[i]
      md += `### Part ${i + 1}: ${part.type}\n\n`

      if (part.type === "text") {
        md += `${part.text}\n\n`
      } else if (part.type === "reasoning") {
        const reasoningPart = part as any
        md += `<details>\n<summary>💭 Reasoning (click to expand)</summary>\n\n`
        md += `${reasoningPart.text}\n\n`
        md += `</details>\n\n`
      } else if (part.type === "tool") {
        const toolPart = part as any
        md += `**🔧 Tool**: \`${toolPart.tool}\`\n\n`
        md += `**Call ID**: \`${toolPart.callID}\`\n\n`
        md += `**Status**: ${toolPart.state.status}\n\n`

        if (toolPart.state.input) {
          md += `**Input**:\n\`\`\`json\n${JSON.stringify(toolPart.state.input, null, 2)}\n\`\`\`\n\n`
        }

        if (toolPart.state.status === "completed") {
          if (toolPart.state.title) {
            md += `**Title**: ${toolPart.state.title}\n\n`
          }
          if (toolPart.state.output) {
            const outputStr =
              typeof toolPart.state.output === "string"
                ? toolPart.state.output
                : JSON.stringify(toolPart.state.output, null, 2)

            // Truncate very long output
            const maxLen = 2000
            const truncated =
              outputStr.length > maxLen ? outputStr.substring(0, maxLen) + "\n\n...(truncated)" : outputStr

            md += `**Output**:\n\`\`\`\n${truncated}\n\`\`\`\n\n`
          }
          if (toolPart.state.time) {
            const duration = toolPart.state.time.end - toolPart.state.time.start
            md += `**Duration**: ${duration}ms\n\n`
          }
        } else if (toolPart.state.status === "error") {
          md += `**Error**: ${toolPart.state.error}\n\n`
        } else if (toolPart.state.status === "running") {
          md += `*Tool is still running...*\n\n`
        }
      } else if (part.type === "file") {
        const filePart = part as any
        md += `**📎 File**: ${filePart.filename}\n\n`
        md += `**Type**: ${filePart.mime}\n\n`
      } else {
        // Unknown part type - show raw
        md += `\`\`\`json\n${JSON.stringify(part, null, 2)}\n\`\`\`\n\n`
      }
    }

    md += `---\n\n`
  }

  // Add summary at the end
  md += `## Summary\n\n`
  const userMsgCount = messages.filter((m) => m.info.role === "user").length
  const assistantMsgCount = messages.filter((m) => m.info.role === "assistant").length

  md += `- User messages: ${userMsgCount}\n`
  md += `- Assistant messages: ${assistantMsgCount}\n`

  // Count tool calls
  let toolCallCount = 0
  const toolUsage: Record<string, number> = {}
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool") {
        toolCallCount++
        const toolName = (part as any).tool
        toolUsage[toolName] = (toolUsage[toolName] || 0) + 1
      }
    }
  }

  md += `- Total tool calls: ${toolCallCount}\n`
  if (Object.keys(toolUsage).length > 0) {
    md += `\n**Tools used**:\n`
    for (const [tool, count] of Object.entries(toolUsage)) {
      md += `- ${tool}: ${count}x\n`
    }
  }

  fs.writeFileSync(OUTPUT_FILE, md)
  console.log(`\n📝 Conversation written to: ${OUTPUT_FILE}`)
}

async function main() {
  // Clear output file
  fs.writeFileSync(OUTPUT_FILE, "")

  log("=" + "=".repeat(70))
  log("REAL ORCHESTRATOR TEST - Full Conversation Log")
  log("=" + "=".repeat(70))
  log("")
  log(`Provider: ${TEST_MODEL.providerID}`)
  log(`Model: ${TEST_MODEL.modelID}`)
  log(`Output: ${OUTPUT_FILE}`)
  log("")

  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      log("Creating supervisor and build sessions...")

      const supervisorSession = await Session.create({
        title: "Test Supervisor",
      })

      const buildSession = await Session.create({
        title: "Test Build Agent",
        parentID: supervisorSession.id,
      })

      log(`✅ Supervisor session: ${supervisorSession.id}`)
      log(`✅ Build session: ${buildSession.id}`)
      log("")

      // Track events
      const events: Array<{ type: string; time: number; data: any }> = []

      Bus.subscribe(Todo.Event.Updated, (event) => {
        if (event.properties.sessionID === buildSession.id) {
          events.push({
            type: "todo_updated",
            time: Date.now(),
            data: event.properties.todos,
          })
          log(`📋 Todo updated: ${event.properties.todos.length} todos`)
        }
      })

      Bus.subscribe(MessageV2.Event.Updated, (event) => {
        if (event.properties.info.sessionID === buildSession.id) {
          events.push({
            type: "message_updated",
            time: Date.now(),
            data: { role: event.properties.info.role },
          })
          log(`💬 Message from ${event.properties.info.role}`)
        }
      })

      // Start supervision
      log("Starting supervision...")
      const cleanup = await Orchestrator.supervise({
        orchestratorSessionID: supervisorSession.id,
        doerSessionID: buildSession.id,
      })
      log("✅ Supervision active")
      log("")

      // Give the build agent a task
      const task =
        "Create two files: test-alpha.txt with content 'First file' and test-beta.txt with content 'Second file'"

      log(`📤 Sending task to build agent...`)
      log(`Task: "${task}"`)
      log("")

      await SessionPrompt.prompt({
        sessionID: buildSession.id,
        model: TEST_MODEL,
        parts: [{ type: "text", text: task }],
      })

      log("⏳ Waiting for build agent to complete task...")
      log("")

      // Wait for completion
      let attempts = 0
      const maxAttempts = 120 // 4 minutes max
      let completed = false

      while (attempts < maxAttempts && !completed) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        attempts++

        const todos = await Todo.get(buildSession.id)
        const allComplete = todos.length > 0 && todos.every((t) => t.status === "completed")

        if (allComplete) {
          completed = true
          log(`✅ All todos completed!`)
          break
        }

        // Check for file creation
        const alphaExists = await Bun.file("/tmp/test-alpha.txt").exists()
        const betaExists = await Bun.file("/tmp/test-beta.txt").exists()

        if (alphaExists && betaExists) {
          completed = true
          log(`✅ Both files created!`)
          break
        }

        if (attempts % 10 === 0) {
          log(`⏳ Still waiting... (${attempts * 2}s elapsed)`)
        }
      }

      log("")
      log("=" + "=".repeat(70))
      log("RESULTS")
      log("=" + "=".repeat(70))
      log("")

      // Check files
      const alphaExists = await Bun.file("/tmp/test-alpha.txt").exists()
      const betaExists = await Bun.file("/tmp/test-beta.txt").exists()

      log(`Alpha file exists: ${alphaExists}`)
      if (alphaExists) {
        const content = await Bun.file("/tmp/test-alpha.txt").text()
        log(`  Content: "${content.trim()}"`)
      }

      log(`Beta file exists: ${betaExists}`)
      if (betaExists) {
        const content = await Bun.file("/tmp/test-beta.txt").text()
        log(`  Content: "${content.trim()}"`)
      }

      log("")
      log(`Total events captured: ${events.length}`)
      log(`  Todo events: ${events.filter((e) => e.type === "todo_updated").length}`)
      log(`  Message events: ${events.filter((e) => e.type === "message_updated").length}`)

      // Get todos
      const todos = await Todo.get(buildSession.id)
      log(``)
      log(`Final todos: ${todos.length}`)
      todos.forEach((t) => {
        log(`  - [${t.status}] ${t.content}`)
      })

      log("")
      log("Writing full conversation to markdown...")
      await writeConversationToMarkdown(buildSession.id, "Build Agent Conversation")

      log("")
      log("=" + "=".repeat(70))
      log("TEST COMPLETE")
      log("=" + "=".repeat(70))

      // Cleanup
      cleanup()

      if (alphaExists && betaExists) {
        log("✅ TEST PASSED")
        process.exit(0)
      } else {
        log("❌ TEST FAILED - Files not created")
        process.exit(1)
      }
    },
  })
}

main().catch((error) => {
  console.error("❌ Test failed with error:", error)
  process.exit(1)
})
