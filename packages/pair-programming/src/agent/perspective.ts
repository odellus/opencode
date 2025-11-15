import { Turn } from "../conversation/turn"
import { Renderer } from "../conversation/renderer"

export namespace Perspective {
  export interface Message {
    role: "user" | "assistant"
    content: string
  }

  /**
   * Transforms neutral conversation turns into role-inverted messages for a specific agent.
   *
   * Key insight: Each agent sees the OTHER agent's messages as role="user" and their own as role="assistant".
   * This makes the LLM think it's having a conversation with a user, when it's actually talking to another agent.
   *
   * @param turns - Neutral conversation history
   * @param agentPerspective - Which agent's perspective to use ("junior" or "senior")
   * @returns Array of messages with inverted roles
   */
  export function transformForAgent(turns: Turn.Info[], agentPerspective: "junior" | "senior"): Message[] {
    return turns.map((turn) => {
      if (turn.agent === agentPerspective) {
        // This is MY turn - I'm the assistant
        // Render everything as text for now
        return {
          role: "assistant" as const,
          content: Renderer.renderTurnAsMarkdown(turn),
        }
      }

      // This is the OTHER agent's turn - they're the "user" from my perspective
      // Render their tool calls as markdown text
      return {
        role: "user" as const,
        content: Renderer.renderTurnAsMarkdown(turn),
      }
    })
  }
}
