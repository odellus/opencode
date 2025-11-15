import { test, expect, describe } from "bun:test"
import { DualSession } from "../src/session/dual-session"
import { LocalProvider } from "../src/provider/local"
import { Conversation } from "../src/conversation/storage"

describe("End-to-End Dual Agent Conversation", () => {
  test("junior and senior collaborate on simple task", async () => {
    const conversationId = Conversation.generateId()

    try {
      const model = LocalProvider.create()

      const result = await DualSession.run({
        conversationId,
        initialPrompt: "Write a hello world function in TypeScript",
        maxTurns: 6,
        model,
        juniorTurnsBeforeSeniorIntercept: 2,
        workingDirectory: process.cwd(),
      })

      console.log("\n=== CONVERSATION TRANSCRIPT ===\n")
      for (const turn of result.turns) {
        console.log(`[${turn.agent.toUpperCase()}]: ${turn.text}`)
        console.log("")
      }
      console.log("=== END TRANSCRIPT ===\n")

      // Verify conversation structure
      expect(result.turns.length).toBeGreaterThan(1)

      // Should have both agent types
      const agents = new Set(result.turns.map((t) => t.agent))
      expect(agents.has("junior")).toBe(true)
      expect(agents.has("senior")).toBe(true)

      // First turn is initial prompt (junior)
      expect(result.turns[0].agent).toBe("junior")
      expect(result.turns[0].text).toContain("hello world")

      // Second turn should be senior responding
      expect(result.turns[1].agent).toBe("senior")

      // Clean up
      Conversation.clear(conversationId)
    } catch (error) {
      // Clean up on error
      if (Conversation.exists(conversationId)) {
        Conversation.clear(conversationId)
      }
      throw error
    }
  }, 600000) // 10 minute timeout - this is an AUTONOMOUS system, we wait

  test("agents alternate correctly based on interception pattern", async () => {
    const conversationId = Conversation.generateId()

    try {
      const model = LocalProvider.create()

      const result = await DualSession.run({
        conversationId,
        initialPrompt: "Count to 5",
        maxTurns: 8,
        model,
        juniorTurnsBeforeSeniorIntercept: 2,
        workingDirectory: process.cwd(),
      })

      console.log("\n=== TURN PATTERN ===")
      for (let i = 0; i < result.turns.length; i++) {
        console.log(`Turn ${i}: ${result.turns[i].agent}`)
      }
      console.log("=== END PATTERN ===\n")

      // Pattern should be:
      // 0: junior (initial)
      // 1: senior (responds)
      // 2: junior
      // 3: junior
      // 4: senior (intercept after 2 junior turns)
      // etc...

      expect(result.turns[0].agent).toBe("junior")
      expect(result.turns[1].agent).toBe("senior")

      // Clean up
      Conversation.clear(conversationId)
    } catch (error) {
      if (Conversation.exists(conversationId)) {
        Conversation.clear(conversationId)
      }
      throw error
    }
  }, 600000) // 10 minute timeout - this is an AUTONOMOUS system, we wait
})
