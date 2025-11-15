#!/usr/bin/env bun
/**
 * Test dual-pair executor/discriminator
 *
 * This creates a session and uses the Task tool to invoke dual-pair on a simple task
 */

import { Session } from "./src/session"
import { SessionPrompt } from "./src/session/prompt"
import { Instance } from "./src/project/instance"
import { InstanceBootstrap } from "./src/project/bootstrap"

async function testDualPair() {
  console.log("Starting dual-pair test...")

  await Instance.provide({
    directory: process.cwd(),
    init: InstanceBootstrap,
    async fn() {
      // Create a parent session
      const parentSession = await Session.create({
        title: "Test dual-pair invocation",
      })

      console.log(`Parent session created: ${parentSession.id}`)

      // Invoke dual-pair via Task tool
      console.log("Invoking dual-pair via Task tool...")

      const result = await SessionPrompt.prompt({
        sessionID: parentSession.id,
        agent: "build",
        model: {
          providerID: "lmstudio",
          modelID:
            "/home/thomas-wood/.cache/llama.cpp/unsloth_GLM-4.5-Air-GGUF_Q4_K_M_GLM-4.5-Air-Q4_K_M-00001-of-00002.gguf",
        },
        parts: [
          {
            type: "text",
            text: "Use the Task tool to delegate this to dual-pair: Write a simple fibonacci function in Python with type hints and a docstring",
          },
        ],
        tools: {
          task: true,
        },
      })

      console.log("\n=== Result ===")
      console.log(JSON.stringify(result, null, 2))

      // Get child sessions (the dual-pair session)
      const children = await Session.children(parentSession.id)
      console.log(`\nChild sessions: ${children.length}`)

      if (children.length > 0) {
        const childSession = children[0]
        console.log(`Child session ID: ${childSession.id}`)
        console.log(`Child session title: ${childSession.title}`)

        // Get messages from dual-pair session
        const messages = await Session.messages({ sessionID: childSession.id })
        console.log(`\nDual-pair conversation (${messages.length} messages):`)

        for (const msg of messages) {
          console.log(`\n--- ${msg.info.role} ---`)
          for (const part of msg.parts) {
            if (part.type === "text") {
              console.log(part.text.slice(0, 200))
            } else if (part.type === "tool") {
              console.log(`[Tool: ${part.tool}]`)
            }
          }
        }
      }
    },
  })
}

testDualPair().catch(console.error)
