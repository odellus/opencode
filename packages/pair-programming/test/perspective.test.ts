import { test, expect, describe } from "bun:test"
import { Turn } from "../src/conversation/turn"
import { Perspective } from "../src/agent/perspective"
import { Conversation } from "../src/conversation/storage"

describe("Perspective Transformer", () => {
  test("transforms turns from junior's perspective", () => {
    const turns: Turn.Info[] = [
      {
        id: "turn1",
        agent: "senior",
        timestamp: Date.now(),
        text: "Let's implement authentication",
      },
      {
        id: "turn2",
        agent: "junior",
        timestamp: Date.now(),
        text: "Sure, I'll create the auth module",
        toolCalls: [
          {
            id: "tool1",
            name: "Write",
            input: { file_path: "/auth.ts", content: "export const auth = {}" },
            output: "File written successfully",
            timestamp: Date.now(),
          },
        ],
      },
      {
        id: "turn3",
        agent: "senior",
        timestamp: Date.now(),
        text: "Good, now add tests",
      },
    ]

    const messages = Perspective.transformForAgent(turns, "junior")

    // Junior sees senior's messages as "user"
    expect(messages[0].role).toBe("user")
    expect(messages[0].content).toContain("Let's implement authentication")

    // Junior sees their own messages as "assistant"
    expect(messages[1].role).toBe("assistant")
    expect(messages[1].content).toContain("Sure, I'll create the auth module")
    expect(messages[1].content).toContain("## Tools Used")
    expect(messages[1].content).toContain("### Write")

    // Another senior message as "user"
    expect(messages[2].role).toBe("user")
    expect(messages[2].content).toContain("Good, now add tests")
  })

  test("transforms turns from senior's perspective", () => {
    const turns: Turn.Info[] = [
      {
        id: "turn1",
        agent: "senior",
        timestamp: Date.now(),
        text: "Let's implement authentication",
      },
      {
        id: "turn2",
        agent: "junior",
        timestamp: Date.now(),
        text: "Sure, I'll create the auth module",
        toolCalls: [
          {
            id: "tool1",
            name: "Write",
            input: { file_path: "/auth.ts", content: "export const auth = {}" },
            output: "File written successfully",
            timestamp: Date.now(),
          },
        ],
      },
    ]

    const messages = Perspective.transformForAgent(turns, "senior")

    // Senior sees their own messages as "assistant"
    expect(messages[0].role).toBe("assistant")

    // Senior sees junior's messages as "user" with tool calls rendered as markdown
    expect(messages[1].role).toBe("user")
    expect(messages[1].content).toContain("Sure, I'll create the auth module")
    expect(messages[1].content).toContain("## Tools Used")
    expect(messages[1].content).toContain("### Write")
    expect(messages[1].content).toContain("File written successfully")
  })

  test("handles tool errors in rendered format", () => {
    const turns: Turn.Info[] = [
      {
        id: "turn1",
        agent: "junior",
        timestamp: Date.now(),
        text: "Trying to write file",
        toolCalls: [
          {
            id: "tool1",
            name: "Write",
            input: { file_path: "/invalid", content: "test" },
            error: "Permission denied",
            timestamp: Date.now(),
          },
        ],
      },
    ]

    const messages = Perspective.transformForAgent(turns, "senior")

    // Senior sees junior's error as rendered markdown
    expect(messages[0].role).toBe("user")
    expect(messages[0].content).toContain("**Error:**")
    expect(messages[0].content).toContain("Permission denied")
  })

  test("handles empty conversation", () => {
    const messages = Perspective.transformForAgent([], "junior")
    expect(messages).toEqual([])
  })

  test("handles turn with only text, no tools", () => {
    const turns: Turn.Info[] = [
      {
        id: "turn1",
        agent: "senior",
        timestamp: Date.now(),
        text: "What's the status?",
      },
    ]

    const juniorView = Perspective.transformForAgent(turns, "junior")
    expect(juniorView[0].role).toBe("user")
    expect(juniorView[0].content).toBe("What's the status?")

    const seniorView = Perspective.transformForAgent(turns, "senior")
    expect(seniorView[0].role).toBe("assistant")
  })
})
