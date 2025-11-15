#!/usr/bin/env bun
/**
 * SIMPLEST POSSIBLE TEST
 * Just send one message to build agent and see what happens
 */

const API = "http://127.0.0.1:4096"

async function call(method: string, path: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`)
  return res.json()
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function main() {
  console.log("\n=== SIMPLEST TEST ===\n")

  // Create session
  const session = await call("POST", "/session", { title: "Simple test" })
  console.log(`Session: ${session.id}`)

  // Send message
  console.log("\nSending: 'say hello'")
  await call("POST", `/session/${session.id}/message`, {
    agent: "build",
    model: { providerID: "lmstudio", modelID: "glm-4.5-air@q4_k_m" },
    parts: [{ type: "text", text: "say hello" }],
  })

  // Poll for response
  console.log("\nWaiting for response...")
  for (let i = 0; i < 60; i++) {
    const messages = await call("GET", `/session/${session.id}/message`)
    const last = messages[messages.length - 1]

    if (last.info.role === "assistant" && last.parts.length > 0) {
      console.log("\n✓ Got response!")
      console.log("\nAssistant said:")
      for (const part of last.parts) {
        if (part.type === "text") {
          console.log(part.text)
        }
      }

      await call("DELETE", `/session/${session.id}`)
      console.log("\n✓ Test passed!\n")
      return
    }

    process.stdout.write(".")
    await sleep(2000)
  }

  console.log("\n✗ Timeout - no response\n")
  await call("DELETE", `/session/${session.id}`)
  process.exit(1)
}

main()
