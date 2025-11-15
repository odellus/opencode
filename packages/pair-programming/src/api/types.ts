import { z } from "zod"
import { Turn } from "../conversation/turn"

export namespace DualSessionAPI {
  // Request to create a new dual-agent session
  export const CreateRequest = z.object({
    initialPrompt: z.string().describe("The initial task/prompt to give to the junior agent"),
    maxTurns: z.number().min(1).max(100).default(20).describe("Maximum number of turns before stopping"),
    juniorTurnsBeforeSeniorIntercept: z
      .number()
      .min(1)
      .max(10)
      .default(2)
      .describe("How many junior turns before senior intercepts"),
    workingDirectory: z.string().optional().describe("Working directory for file operations"),
  })

  export type CreateRequest = z.infer<typeof CreateRequest>

  // Response when creating a session
  export const CreateResponse = z.object({
    conversationId: z.string().describe("Unique ID for this dual-agent conversation"),
    status: z.enum(["started"]).describe("Status of the session"),
  })

  export type CreateResponse = z.infer<typeof CreateResponse>

  // Turn in the API response (perspective-transformed)
  export const TurnView = z.object({
    id: z.string().describe("Turn ID"),
    role: z.enum(["build", "supervise"]).describe("Agent role shown to humans"),
    timestamp: z.number().describe("Unix timestamp"),
    content: z.string().describe("Rendered content including tool calls as markdown"),
  })

  export type TurnView = z.infer<typeof TurnView>

  // Response when getting conversation state
  export const GetResponse = z.object({
    conversationId: z.string().describe("Conversation ID"),
    turns: z.array(TurnView).describe("All turns with tool calls rendered as markdown"),
    status: z.enum(["running", "completed", "aborted"]).describe("Current status"),
    currentAgent: z.enum(["junior", "senior"]).optional().describe("Which agent is currently acting"),
  })

  export type GetResponse = z.infer<typeof GetResponse>

  // Abort request
  export const AbortRequest = z.object({
    conversationId: z.string().describe("Conversation ID to abort"),
  })

  export type AbortRequest = z.infer<typeof AbortRequest>
}
