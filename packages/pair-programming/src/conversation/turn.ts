import z from "zod"

export namespace Turn {
  export const ToolCall = z.object({
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.any()),
    output: z.string().optional(),
    error: z.string().optional(),
    timestamp: z.number(),
  })
  export type ToolCall = z.infer<typeof ToolCall>

  export const Info = z.object({
    id: z.string(),
    agent: z.enum(["junior", "senior"]),
    timestamp: z.number(),
    text: z.string().optional(),
    toolCalls: z.array(ToolCall).optional(),
  })
  export type Info = z.infer<typeof Info>

  export function create(input: {
    id: string
    agent: "junior" | "senior"
    text?: string
    toolCalls?: ToolCall[]
  }): Info {
    return {
      id: input.id,
      agent: input.agent,
      timestamp: Date.now(),
      text: input.text,
      toolCalls: input.toolCalls,
    }
  }
}
