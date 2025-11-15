import { MessageV2 } from "./message-v2"
import { ToolRenderer } from "./tool-renderer"

export namespace DualPairPerspective {
  /**
   * Transform conversation history for executor's perspective
   *
   * Executor sees:
   * - Their own messages as "assistant"
   * - Discriminator's messages as "user" (with tool calls rendered)
   * - Original user messages as "user"
   *
   * We identify which agent sent which message by checking message parts metadata
   */
  export function transformForExecutor(messages: MessageV2.WithParts[]): Array<{
    role: "user" | "assistant"
    content: string
  }> {
    const transformed: Array<{ role: "user" | "assistant"; content: string }> = []

    for (const msg of messages) {
      if (msg.info.role === "user") {
        // Original user message
        transformed.push({
          role: "user",
          content: ToolRenderer.renderMessage(msg),
        })
      } else if (msg.info.role === "assistant") {
        // Check if this is executor or discriminator by looking at parts metadata
        // We set dualPairAgent in metadata when creating the message
        const agentType = getDualPairAgent(msg)

        if (agentType === "executor") {
          // My own messages = assistant
          transformed.push({
            role: "assistant",
            content: ToolRenderer.renderMessage(msg),
          })
        } else if (agentType === "discriminator") {
          // Discriminator's messages = user (feedback from supervisor)
          transformed.push({
            role: "user",
            content: ToolRenderer.renderMessage(msg),
          })
        } else {
          // Fallback for messages without agent metadata
          transformed.push({
            role: msg.info.role,
            content: ToolRenderer.renderMessage(msg),
          })
        }
      }
    }

    return transformed
  }

  /**
   * Transform conversation history for discriminator's perspective
   *
   * Discriminator sees:
   * - Their own messages as "assistant"
   * - Executor's messages as "user" (showing what work was done)
   * - Original user messages as "user"
   */
  export function transformForDiscriminator(messages: MessageV2.WithParts[]): Array<{
    role: "user" | "assistant"
    content: string
  }> {
    const transformed: Array<{ role: "user" | "assistant"; content: string }> = []

    for (const msg of messages) {
      if (msg.info.role === "user") {
        // Original user message
        transformed.push({
          role: "user",
          content: ToolRenderer.renderMessage(msg),
        })
      } else if (msg.info.role === "assistant") {
        const agentType = getDualPairAgent(msg)

        if (agentType === "discriminator") {
          // My own messages = assistant
          transformed.push({
            role: "assistant",
            content: ToolRenderer.renderMessage(msg),
          })
        } else if (agentType === "executor") {
          // Executor's work = user (here's what they did)
          const rendered = ToolRenderer.renderMessage(msg)
          transformed.push({
            role: "user",
            content: `## Executor's Work\n\n${rendered}`,
          })
        } else {
          // Fallback
          transformed.push({
            role: msg.info.role,
            content: ToolRenderer.renderMessage(msg),
          })
        }
      }
    }

    return transformed
  }

  /**
   * Helper to get dual-pair agent type from message parts metadata
   */
  function getDualPairAgent(msg: MessageV2.WithParts): "executor" | "discriminator" | null {
    // Check tool parts for metadata
    for (const part of msg.parts) {
      if (part.type === "tool" && part.metadata?.dualPairAgent) {
        return part.metadata.dualPairAgent as "executor" | "discriminator"
      }
    }
    // Check text parts for metadata
    for (const part of msg.parts) {
      if (part.type === "text" && part.metadata?.dualPairAgent) {
        return part.metadata.dualPairAgent as "executor" | "discriminator"
      }
    }
    return null
  }
}
