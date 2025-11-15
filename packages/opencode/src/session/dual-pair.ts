import { Session } from "../session"
import { SessionPrompt } from "./prompt"
import { MessageV2 } from "./message-v2"
import { DualPairPerspective } from "./dual-pair-perspective"
import { Identifier } from "../id/id"
import { Log } from "../util/log"

export namespace DualPair {
  const log = Log.create({ service: "dual-pair" })

  export interface Config {
    sessionID: string
    task: string
    maxTurns: number
    executorTurnsBeforeReview?: number
    model?: {
      providerID: string
      modelID: string
    }
  }

  export interface Result {
    sessionID: string
    turnCount: number
    completed: boolean
    summary?: string
  }

  /**
   * Run executor/discriminator dual-pair session
   *
   * The executor (build agent) does the work while the discriminator (supervisor agent)
   * reviews and provides feedback. They share one session but see different perspectives
   * of the conversation through role inversion.
   */
  export async function run(config: Config): Promise<Result> {
    const { sessionID, task, maxTurns, model } = config
    const executorTurnsBeforeReview = config.executorTurnsBeforeReview ?? 2

    log.info("starting dual-pair session", {
      sessionID,
      task: task.slice(0, 100),
      maxTurns,
    })

    let currentAgent: "executor" | "discriminator" = "executor"
    let turnCount = 0
    let executorTurnsSinceReview = 0

    while (turnCount < maxTurns) {
      // Get current conversation state
      const messages = await Session.messages({ sessionID })

      // Check if discriminator marked task as done
      const session = await Session.get(sessionID)
      if ((session.metadata as any)?.dualPairComplete) {
        log.info("dual-pair completed by discriminator", {
          sessionID,
          turnCount,
          summary: (session.metadata as any).completionSummary,
        })
        return {
          sessionID,
          turnCount,
          completed: true,
          summary: (session.metadata as any).completionSummary as string,
        }
      }

      if (currentAgent === "executor") {
        // Executor's turn - do the work
        log.info("executor turn", { sessionID, turnCount })

        const executorView = DualPairPerspective.transformForExecutor(messages)

        const messageID = Identifier.ascending("message")
        await SessionPrompt.prompt({
          sessionID,
          messageID,
          agent: "build", // Executor uses BUILD agent (standard implementation prompt)
          model,
          parts: [
            {
              type: "text",
              text: turnCount === 0 ? task : "Continue working on the task based on feedback",
              metadata: {
                dualPairAgent: "executor",
              },
            },
          ],
        })

        turnCount++
        executorTurnsSinceReview++

        // Switch to discriminator after N executor turns
        if (executorTurnsSinceReview >= executorTurnsBeforeReview) {
          currentAgent = "discriminator"
          executorTurnsSinceReview = 0
        }
      } else {
        // Discriminator's turn - review and provide feedback
        log.info("discriminator turn", { sessionID, turnCount })

        const discriminatorView = DualPairPerspective.transformForDiscriminator(messages)

        const messageID = Identifier.ascending("message")
        await SessionPrompt.prompt({
          sessionID,
          messageID,
          agent: "discriminator", // Discriminator uses DISCRIMINATOR agent (custom review prompt)
          model,
          tools: {
            // Discriminator gets verification + completion tools
            task_done: true,
            todowrite: true,
            todoread: true,
            read: true,
            grep: true,
            bash: true,
            glob: true,
          },
          parts: [
            {
              type: "text",
              text: "Review the executor's work. Provide specific feedback, run tests if needed, or use task_done if everything is satisfactory.",
              metadata: {
                dualPairAgent: "discriminator",
              },
            },
          ],
        })

        turnCount++
        currentAgent = "executor"
      }
    }

    // Max turns reached without completion
    log.warn("dual-pair hit max turns without completion", {
      sessionID,
      maxTurns,
    })

    return {
      sessionID,
      turnCount,
      completed: false,
    }
  }
}
