import { Turn } from "./turn"

export namespace Renderer {
  export function renderTurnAsMarkdown(turn: Turn.Info): string {
    let output = turn.text || ""

    if (turn.toolCalls?.length) {
      output += "\n\n## Tools Used\n\n"

      for (const toolCall of turn.toolCalls) {
        output += `### ${toolCall.name}\n\n`
        output += `**Input:**\n\`\`\`json\n${JSON.stringify(toolCall.input, null, 2)}\n\`\`\`\n\n`

        if (toolCall.error) {
          output += `**Error:**\n\`\`\`\n${toolCall.error}\n\`\`\`\n\n`
        } else if (toolCall.output) {
          output += `**Output:**\n\`\`\`\n${toolCall.output}\n\`\`\`\n\n`
        }
      }
    }

    return output.trim()
  }
}
