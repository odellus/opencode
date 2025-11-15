import { test, expect } from "bun:test"
import { Server } from "../../../opencode/src/server/server"
import { DualSessionAPI } from "../../src/api/types"

test("dual-session create endpoint starts a session", async () => {
  const server = Server.listen({
    port: 9878,
    hostname: "localhost",
  })

  try {
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Create a dual-agent session
    const createResponse = await fetch(`http://localhost:9878/dual-session?directory=${process.cwd()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        initialPrompt: "Say hello",
        maxTurns: 2,
        juniorTurnsBeforeSeniorIntercept: 1,
        workingDirectory: process.cwd(),
      } satisfies DualSessionAPI.CreateRequest),
    })

    expect(createResponse.status).toBe(200)
    const createData = (await createResponse.json()) as DualSessionAPI.CreateResponse
    expect(createData.conversationId).toBeDefined()
    expect(createData.status).toBe("started")

    console.log(`Created dual-session: ${createData.conversationId}`)

    // Wait a bit then check status
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const getResponse = await fetch(
      `http://localhost:9878/dual-session/${createData.conversationId}?directory=${process.cwd()}`,
    )
    expect(getResponse.status).toBe(200)

    const state = (await getResponse.json()) as DualSessionAPI.GetResponse
    console.log(`Status: ${state.status}, Turns: ${state.turns.length}`)

    // Should have at least the initial turn
    expect(state.turns.length).toBeGreaterThanOrEqual(1)
  } finally {
    server.stop(true)
  }
}, 60000)
