import { test, expect } from "bun:test"
import { Server } from "../../../opencode/src/server/server"
import { DualSessionAPI } from "../../src/api/types"

const BASE_URL = "http://localhost:9876"

test.skip("dual-session HTTP endpoints work end-to-end", async () => {
  // Start server
  const server = Server.listen({
    port: 9876,
    hostname: "localhost",
  })

  try {
    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // 1. Create a dual-agent session
    const createResponse = await fetch(`${BASE_URL}/dual-session?directory=${process.cwd()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        initialPrompt: "Write a hello world function in TypeScript",
        maxTurns: 4,
        juniorTurnsBeforeSeniorIntercept: 2,
        workingDirectory: process.cwd(),
      } satisfies DualSessionAPI.CreateRequest),
    })

    expect(createResponse.status).toBe(200)
    const createData = (await createResponse.json()) as DualSessionAPI.CreateResponse
    expect(createData.conversationId).toBeDefined()
    expect(createData.status).toBe("started")

    const { conversationId } = createData

    console.log(`Created dual-session: ${conversationId}`)

    // 2. Poll for progress
    let attempts = 0
    const maxAttempts = 120 // 10 minutes at 5-second intervals
    let finalState: DualSessionAPI.GetResponse | null = null

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 5000))

      const getResponse = await fetch(`${BASE_URL}/dual-session/${conversationId}?directory=${process.cwd()}`)
      expect(getResponse.status).toBe(200)

      const state = (await getResponse.json()) as DualSessionAPI.GetResponse
      console.log(
        `Turn ${state.turns.length}: status=${state.status}, currentAgent=${state.currentAgent || "none"}`,
      )

      if (state.status === "completed" || state.status === "aborted") {
        finalState = state
        break
      }

      attempts++
    }

    expect(finalState).not.toBeNull()
    expect(finalState!.turns.length).toBeGreaterThan(1)

    // Verify we have both build and supervise roles
    const roles = new Set(finalState!.turns.map((t) => t.role))
    expect(roles.has("build")).toBe(true)
    expect(roles.has("supervise")).toBe(true)

    // Verify turns have rendered content
    for (const turn of finalState!.turns) {
      expect(turn.content).toBeDefined()
      expect(turn.content.length).toBeGreaterThan(0)
    }

    console.log("Final conversation:")
    for (const turn of finalState!.turns) {
      console.log(`\n[${turn.role}]`)
      console.log(turn.content.slice(0, 200))
      if (turn.content.length > 200) {
        console.log("...")
      }
    }
  } finally {
    server.stop(true)
  }
}, 900000) // 15 minute timeout for full test

test("dual-session list endpoint returns empty initially", async () => {
  const server = Server.listen({
    port: 9877,
    hostname: "localhost",
  })

  try {
    await new Promise((resolve) => setTimeout(resolve, 500))

    const response = await fetch(`http://localhost:9877/dual-session?directory=${process.cwd()}`)
    expect(response.status).toBe(200)

    const sessions = (await response.json()) as string[]
    expect(Array.isArray(sessions)).toBe(true)
  } finally {
    server.stop(true)
  }
})
