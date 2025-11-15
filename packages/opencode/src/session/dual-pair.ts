import { Session } from "../session"
import { SessionPrompt } from "./prompt"
import { MessageV2 } from "./message-v2"
import { DualPairPerspective } from "./dual-pair-perspective"
import { SessionExport } from "./export"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { Instance } from "../project/instance"

export namespace DualPair {
  const log = Log.create({ service: "dual-pair" })

  export interface Config {
    sessionID: string
    task: string
    maxSteps?: number // Max executor->discriminator cycles (default 50)
    model?: {
      providerID: string
      modelID: string
    }
    exportPath?: string // Optional path for markdown export
  }

  export interface Result {
    sessionID: string
    steps: number // Number of complete executor->discriminator cycles
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
    const { sessionID, task, model } = config
    const maxSteps = config.maxSteps ?? 50

    // Setup markdown export
    const exportPath = config.exportPath ?? SessionExport.getDefaultPath(sessionID, Instance.directory)

    log.info("starting dual-pair session", {
      sessionID,
      task: task.slice(0, 100),
      maxSteps,
      exportPath,
    })

    // Initial export
    await SessionExport.writeToFile(sessionID, exportPath).catch((err) => {
      log.error("failed to export session", { error: err })
    })

    let currentAgent: "executor" | "discriminator" = "executor"
    let steps = 0 // A step = executor work + discriminator review

    while (steps < maxSteps) {
      // Get current conversation state
      const messages = await Session.messages({ sessionID })

      // Check if discriminator marked task as done (happens AFTER discriminator's turn)
      const session = await Session.get(sessionID)
      if ((session.metadata as any)?.dualPairComplete) {
        log.info("dual-pair completed by discriminator", {
          sessionID,
          steps,
        })

        // Get discriminator's final text response as the summary
        const lastMessage = messages[messages.length - 1]
        const summary =
          lastMessage?.parts
            .filter((p) => p.type === "text")
            .map((p) => (p.type === "text" ? p.text : ""))
            .join("\n") || "Task completed"

        // Update export with final state
        await SessionExport.writeToFile(sessionID, exportPath).catch((err) => {
          log.error("failed to export final session", { error: err })
        })

        return {
          sessionID,
          steps,
          completed: true,
          summary,
        }
      }

      if (currentAgent === "executor") {
        // Executor's turn - do the work
        log.info("executor turn", { sessionID, step: steps })

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
              text: steps === 0 ? task : "Continue working on the task based on feedback",
              metadata: {
                dualPairAgent: "executor",
                dualPairStep: steps,
              },
            },
          ],
        })

        // Always switch to discriminator after executor
        currentAgent = "discriminator"
      } else {
        // Discriminator's turn - review and provide feedback
        log.info("discriminator turn", { sessionID, step: steps })

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
                dualPairStep: steps,
              },
            },
          ],
        })

        // Discriminator response completes the step (trae-agent style)
        steps++
        currentAgent = "executor"
      }
    }

    // Max steps reached without completion
    log.warn("dual-pair hit max steps without completion", {
      sessionID,
      maxSteps,
      steps,
    })

    return {
      sessionID,
      steps,
      completed: false,
    }
  }
}
