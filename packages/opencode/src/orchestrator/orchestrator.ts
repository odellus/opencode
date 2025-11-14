import { Bus } from "../bus"
import { Session } from "../session"
import { Todo } from "../session/todo"
import { MessageV2 } from "../session/message-v2"
import { SessionPrompt } from "../session/prompt"
import { Log } from "../util/log"

const log = Log.create({ service: "orchestrator" })

export namespace Orchestrator {
  /**
   * Anti-pattern detection result
   */
  export interface AntiPattern {
    type:
      | "multiple_in_progress"
      | "stuck_task"
      | "mock_cascade"
      | "infinite_loop"
      | "reward_hacking"
      | "analysis_paralysis"
    severity: "low" | "medium" | "high"
    message: string
    taskId?: string
  }

  /**
   * Set up orchestrator to monitor a doer session
   */
  export async function supervise(input: { orchestratorSessionID: string; doerSessionID: string }): Promise<() => void> {
    log.info("supervising doer session", {
      orchestrator: input.orchestratorSessionID,
      doer: input.doerSessionID,
    })

    const unsubscribers: Array<() => void> = []

    // Monitor todo updates
    const todoUnsub = Bus.subscribe(Todo.Event.Updated, async (event) => {
      if (event.properties.sessionID !== input.doerSessionID) return

      const todos = event.properties.todos
      const antiPatterns = detectTodoAntiPatterns(todos)

      if (antiPatterns.length > 0) {
        log.warn("detected anti-patterns in doer todos", {
          doer: input.doerSessionID,
          patterns: antiPatterns,
        })

        // Send feedback to doer
        for (const pattern of antiPatterns) {
          await sendFeedbackToDoer(input.doerSessionID, pattern.message)
        }
      }
    })

    unsubscribers.push(todoUnsub)

    // Monitor session updates (for "done" claims)
    const sessionUnsub = Bus.subscribe(Session.Event.Updated, async (event) => {
      if (event.properties.info.id !== input.doerSessionID) return

      await checkIfClaimingDone(input.orchestratorSessionID, input.doerSessionID)
    })

    unsubscribers.push(sessionUnsub)

    // Return cleanup function
    return () => {
      log.info("stopping supervision", {
        orchestrator: input.orchestratorSessionID,
        doer: input.doerSessionID,
      })
      unsubscribers.forEach((unsub) => unsub())
    }
  }

  /**
   * Detect anti-patterns in todo list
   */
  function detectTodoAntiPatterns(todos: Todo.Info[]): AntiPattern[] {
    const patterns: AntiPattern[] = []

    // Anti-pattern: Multiple tasks in progress
    const inProgress = todos.filter((t) => t.status === "in_progress")
    if (inProgress.length > 1) {
      patterns.push({
        type: "multiple_in_progress",
        severity: "medium",
        message: `You have ${inProgress.length} tasks in progress. Focus on one task at a time for better results.`,
      })
    }

    return patterns
  }

  /**
   * Check if doer is claiming to be done
   */
  async function checkIfClaimingDone(orchestratorSessionID: string, doerSessionID: string) {
    const messages: MessageV2.WithParts[] = []

    // Stream messages and collect them
    for await (const msg of MessageV2.stream(doerSessionID)) {
      messages.push(msg)
    }

    if (messages.length === 0) return

    const lastMsg = messages[messages.length - 1]
    if (lastMsg.info.role !== "assistant") return

    // Check if message contains "done" or "complete"
    const text = extractText(lastMsg.parts)
    if (text.toLowerCase().includes("done") || text.toLowerCase().includes("complete")) {
      log.info("doer claims to be done, reviewing work", {
        doer: doerSessionID,
      })

      // TODO: Implement work review logic
      // - Check file status
      // - Check todos completed
      // - Use role inversion for critique
    }
  }

  /**
   * Send feedback message to doer session
   */
  async function sendFeedbackToDoer(sessionID: string, feedback: string) {
    log.info("sending feedback to doer", {
      session: sessionID,
      feedback,
    })

    await SessionPrompt.prompt({
      sessionID,
      parts: [
        {
          type: "text",
          text: feedback,
        },
      ],
    })
  }

  /**
   * Extract text from message parts
   */
  function extractText(parts: MessageV2.Part[]): string {
    return parts
      .filter((p) => p.type === "text")
      .map((p) => (p as any).text)
      .join(" ")
  }

  /**
   * Create supervised session pair (orchestrator + doer)
   */
  export async function createSupervisionSession(input: {
    projectDescription: string
    directory?: string
  }): Promise<{
    orchestratorSessionID: string
    doerSessionID: string
    cleanup: () => void
  }> {
    log.info("creating supervision session", {
      project: input.projectDescription,
    })

    // Create orchestrator session
    const orchestratorSession = await Session.create({
      title: `Orchestrator: ${input.projectDescription}`,
    })

    // Create doer session as child
    const doerSession = await Session.create({
      title: `Doer: ${input.projectDescription}`,
      parentID: orchestratorSession.id,
    })

    // Set up supervision
    const cleanup = await supervise({
      orchestratorSessionID: orchestratorSession.id,
      doerSessionID: doerSession.id,
    })

    return {
      orchestratorSessionID: orchestratorSession.id,
      doerSessionID: doerSession.id,
      cleanup,
    }
  }
}
