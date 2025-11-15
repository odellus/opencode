import { Tool } from "./tool"
import z from "zod"
import { Session } from "../session"

/**
 * task_done - Signals that a dual-pair session has completed successfully
 *
 * Only available to discriminator agent in dual-pair sessions.
 * When called, marks the session as complete and exits the dual-pair loop.
 */
export const TaskDoneTool = Tool.define("task_done", async () => {
  return {
    description: `Signal that the task is complete and satisfactory. Use this when all requirements are met, tests pass, and code quality is good. Only use this when you're confident the work is done correctly.`,
    parameters: z.object({
      summary: z.string().describe("Brief summary of what was accomplished"),
      quality_notes: z.string().optional().describe("Any notes about code quality or areas for future improvement"),
    }),
    async execute(params, ctx) {
      // Mark session metadata to signal completion
      await Session.update(ctx.sessionID, (session) => {
        ;(session.metadata as any).dualPairComplete = true
        ;(session.metadata as any).completionSummary = params.summary
        ;(session.metadata as any).qualityNotes = params.quality_notes
        ;(session.metadata as any).completedAt = Date.now()
      })

      return {
        title: "Task Complete",
        metadata: {},
        output: `Task marked as complete: ${params.summary}`,
      }
    },
  }
})
