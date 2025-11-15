import { MessageV2 } from "./message-v2"

export namespace ToolRenderer {
  /**
   * Renders tool calls as markdown for display in "user" role messages
   * Used in dual-pair to show executor's work to discriminator (and vice versa)
   */
  export function renderAsMarkdown(toolParts: MessageV2.ToolPart[]): string {
    if (toolParts.length === 0) return ""

    let markdown = "\n\n## Tools Used\n\n"

    for (const tool of toolParts) {
      markdown += `### ${tool.tool}\n\n`

      // Input (available in all states)
      if (tool.state.status !== "pending" && "input" in tool.state) {
        markdown += `**Input:**\n\`\`\`json\n${JSON.stringify(tool.state.input, null, 2)}\n\`\`\`\n\n`
      }

      // Output or error depending on state
      if (tool.state.status === "error") {
        markdown += `**Error:**\n\`\`\`\n${tool.state.error}\n\`\`\`\n\n`
      } else if (tool.state.status === "completed") {
        markdown += `**Output:**\n\`\`\`\n${tool.state.output}\n\`\`\`\n\n`
      } else if (tool.state.status === "running") {
        markdown += `**Status:** Running...\n\n`
      }
    }

    return markdown.trim()
  }

  /**
   * Renders a complete message (text + tool calls) as markdown
   */
  export function renderMessage(message: MessageV2.WithParts): string {
    const textParts = message.parts.filter((p) => p.type === "text") as MessageV2.TextPart[]
    const toolParts = message.parts.filter((p) => p.type === "tool") as MessageV2.ToolPart[]

    const text = textParts.map((p) => p.text).join("\n")
    const tools = renderAsMarkdown(toolParts)

    return text + tools
  }
}
