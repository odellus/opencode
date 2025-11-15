import { test, expect, describe } from "bun:test"
import { Renderer } from "../src/conversation/renderer"
import { Turn } from "../src/conversation/turn"

describe("Tool Call Renderer", () => {
  test("renders turn with text only", () => {
    const turn = Turn.create({
      id: "turn1",
      agent: "junior",
      text: "I'm working on authentication",
    })

    const rendered = Renderer.renderTurnAsMarkdown(turn)
    expect(rendered).toBe("I'm working on authentication")
  })

  test("renders turn with tool calls", () => {
    const turn = Turn.create({
      id: "turn1",
      agent: "junior",
      text: "Let me create the file",
      toolCalls: [
        {
          id: "tool1",
          name: "Write",
          input: { file_path: "/auth.ts", content: "export const auth = {}" },
          output: "File written successfully",
          timestamp: Date.now(),
        },
      ],
    })

    const rendered = Renderer.renderTurnAsMarkdown(turn)

    expect(rendered).toContain("Let me create the file")
    expect(rendered).toContain("## Tools Used")
    expect(rendered).toContain("### Write")
    expect(rendered).toContain("**Input:**")
    expect(rendered).toContain('"file_path": "/auth.ts"')
    expect(rendered).toContain("**Output:**")
    expect(rendered).toContain("File written successfully")
  })

  test("renders tool call with error", () => {
    const turn = Turn.create({
      id: "turn1",
      agent: "junior",
      toolCalls: [
        {
          id: "tool1",
          name: "Write",
          input: { file_path: "/invalid" },
          error: "Permission denied",
          timestamp: Date.now(),
        },
      ],
    })

    const rendered = Renderer.renderTurnAsMarkdown(turn)

    expect(rendered).toContain("### Write")
    expect(rendered).toContain("**Error:**")
    expect(rendered).toContain("Permission denied")
    expect(rendered).not.toContain("**Output:**")
  })

  test("renders multiple tool calls", () => {
    const turn = Turn.create({
      id: "turn1",
      agent: "junior",
      text: "Creating files",
      toolCalls: [
        {
          id: "tool1",
          name: "Write",
          input: { file_path: "/file1.ts" },
          output: "Success",
          timestamp: Date.now(),
        },
        {
          id: "tool2",
          name: "Write",
          input: { file_path: "/file2.ts" },
          output: "Success",
          timestamp: Date.now(),
        },
      ],
    })

    const rendered = Renderer.renderTurnAsMarkdown(turn)

    expect(rendered).toContain("Creating files")
    expect(rendered).toContain("## Tools Used")
    // Should contain both tool calls
    expect(rendered.match(/### Write/g)).toHaveLength(2)
    expect(rendered).toContain('"/file1.ts"')
    expect(rendered).toContain('"/file2.ts"')
  })

  test("handles turn with no text and no tool calls", () => {
    const turn = Turn.create({
      id: "turn1",
      agent: "junior",
    })

    const rendered = Renderer.renderTurnAsMarkdown(turn)
    expect(rendered).toBe("")
  })

  test("handles tool call with no output or error", () => {
    const turn = Turn.create({
      id: "turn1",
      agent: "junior",
      toolCalls: [
        {
          id: "tool1",
          name: "Read",
          input: { file_path: "/test.ts" },
          timestamp: Date.now(),
        },
      ],
    })

    const rendered = Renderer.renderTurnAsMarkdown(turn)

    expect(rendered).toContain("### Read")
    expect(rendered).toContain("**Input:**")
    // Should not crash, just skip output/error sections
  })
})
