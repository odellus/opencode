import { Bus } from "../bus"
import { Session } from "../session"
import { Todo } from "../session/todo"
import { MessageV2 } from "../session/message-v2"
import { SessionPrompt } from "../session/prompt"
import { Log } from "../util/log"
import { Identifier } from "../id/id"

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
   * Todo change detection result
   */
  export interface TodoChange {
    type: "added" | "completed" | "started" | "modified" | "all_completed"
    todo: Todo.Info
    previousStatus?: string
  }

  /**
   * Set up orchestrator to monitor a doer session
   */
  export async function supervise(input: {
    orchestratorSessionID: string
    doerSessionID: string
  }): Promise<() => void> {
    log.info("supervising doer session", {
      orchestrator: input.orchestratorSessionID,
      doer: input.doerSessionID,
    })

    const unsubscribers: Array<() => void> = []
    let previousTodos: Todo.Info[] = []
    let lastMessageCount = 0

    // Monitor message updates - check if subagent stopped without tool calls
    const messageUnsub = Bus.subscribe(MessageV2.Event.Updated, async (event) => {
      if (event.properties.info.sessionID !== input.doerSessionID) return
      if (event.properties.info.role !== "assistant") return

      // Get all messages to check conversation state
      const messages: MessageV2.WithParts[] = []
      for await (const msg of MessageV2.stream(input.doerSessionID)) {
        messages.push(msg)
      }

      const currentCount = messages.length
      if (currentCount <= lastMessageCount) return
      lastMessageCount = currentCount

      const lastMessage = messages[messages.length - 1]

      // Check if assistant stopped without tool calls (conversation ended prematurely)
      if (lastMessage.info.role === "assistant" && lastMessage.parts.length > 0) {
        const hasToolUse = lastMessage.parts.some((p) => p.type === "tool")

        if (!hasToolUse) {
          // Check if all todos are complete
          const todos = await Todo.get(input.doerSessionID)
          const allComplete = todos.length > 0 && todos.every((t) => t.status === "completed")

          if (!allComplete) {
            log.warn("subagent stopped without completing todos", {
              doer: input.doerSessionID,
              remainingTodos: todos.filter((t) => t.status !== "completed").length,
            })

            // Build full conversation summary for evaluation
            const conversationSummary = buildConversationSummary(messages, todos)

            // Send continuation prompt with full context and invoke LLM
            const continuationPrompt = `You stopped but still have incomplete todos.

${conversationSummary}

Please continue working on your remaining todos. What's the next step?`

            await sendFeedbackToDoer(input.doerSessionID, continuationPrompt)

            // Invoke the LLM to continue the conversation
            log.info("invoking LLM to continue subagent conversation", {
              doer: input.doerSessionID,
            })

            const lastAssistant = [...messages].reverse().find((m) => m.info.role === "assistant")

            if (lastAssistant && lastAssistant.info.role === "assistant") {
              await SessionPrompt.prompt({
                sessionID: input.doerSessionID,
                model: {
                  providerID: lastAssistant.info.providerID,
                  modelID: lastAssistant.info.modelID,
                },
                parts: [],
              }).catch((error) => {
                log.error("failed to continue subagent conversation", {
                  doer: input.doerSessionID,
                  error,
                })
              })
            }
          }
        }
      }
    })

    unsubscribers.push(messageUnsub)

    // Monitor todo updates with change detection
    const todoUnsub = Bus.subscribe(Todo.Event.Updated, async (event) => {
      if (event.properties.sessionID !== input.doerSessionID) return

      const currentTodos = event.properties.todos

      // Detect what changed
      const changes = detectTodoChanges(previousTodos, currentTodos)

      if (changes.length > 0) {
        log.info("detected todo changes in subagent", {
          doer: input.doerSessionID,
          changes: changes.map((c) => ({ type: c.type, task: c.todo.content })),
        })

        // Handle each change type
        for (const change of changes) {
          await handleTodoChange(input.orchestratorSessionID, input.doerSessionID, change)
        }
      }

      // Detect anti-patterns
      const antiPatterns = detectTodoAntiPatterns(currentTodos)

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

      previousTodos = currentTodos
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
   * Detect changes between previous and current todo lists
   */
  function detectTodoChanges(previous: Todo.Info[], current: Todo.Info[]): TodoChange[] {
    const changes: TodoChange[] = []

    // Check for completed todos
    for (const prevTodo of previous) {
      const currTodo = current.find((t) => t.content === prevTodo.content)
      if (currTodo && prevTodo.status !== "completed" && currTodo.status === "completed") {
        changes.push({
          type: "completed",
          todo: currTodo,
          previousStatus: prevTodo.status,
        })
      }
    }

    // Check for started todos
    for (const prevTodo of previous) {
      const currTodo = current.find((t) => t.content === prevTodo.content)
      if (currTodo && prevTodo.status !== "in_progress" && currTodo.status === "in_progress") {
        changes.push({
          type: "started",
          todo: currTodo,
          previousStatus: prevTodo.status,
        })
      }
    }

    // Check for newly added todos
    for (const currTodo of current) {
      const exists = previous.find((t) => t.content === currTodo.content)
      if (!exists) {
        changes.push({
          type: "added",
          todo: currTodo,
        })
      }
    }

    // Check if all todos are completed
    const allCompleted = current.length > 0 && current.every((t) => t.status === "completed")
    const prevAllCompleted = previous.length > 0 && previous.every((t) => t.status === "completed")
    if (allCompleted && !prevAllCompleted) {
      changes.push({
        type: "all_completed",
        todo: current[current.length - 1], // Use last todo as reference
      })
    }

    return changes
  }

  /**
   * Handle todo change events - orchestrator intervention logic
   */
  async function handleTodoChange(
    orchestratorSessionID: string,
    doerSessionID: string,
    change: TodoChange,
  ): Promise<void> {
    switch (change.type) {
      case "completed":
        log.info("subagent completed task", {
          task: change.todo.content,
        })
        // Orchestrator could verify completion here
        break

      case "started":
        log.info("subagent started task", {
          task: change.todo.content,
        })
        // Orchestrator could provide guidance here
        break

      case "added":
        log.info("subagent added new task", {
          task: change.todo.content,
        })
        // Orchestrator could review if this aligns with plan
        break

      case "all_completed":
        log.info("subagent completed all tasks", {
          doer: doerSessionID,
        })
        // Trigger orchestrator review
        await triggerOrchestratorReview(orchestratorSessionID, doerSessionID)
        break
    }
  }

  /**
   * Trigger orchestrator to review subagent's work
   */
  async function triggerOrchestratorReview(orchestratorSessionID: string, doerSessionID: string): Promise<void> {
    log.info("triggering orchestrator review", {
      orchestrator: orchestratorSessionID,
      doer: doerSessionID,
    })

    // Send review prompt to orchestrator session
    const reviewPrompt = `The subagent (session ${doerSessionID}) has completed all their tasks. Please review their work and verify completion. Check:
- Were all tasks completed correctly?
- Is the implementation quality acceptable?
- Are there any issues that need to be addressed?

If everything looks good, mark your orchestrator task as complete. If issues are found, provide feedback to the subagent.`

    await sendFeedbackToDoer(orchestratorSessionID, reviewPrompt)
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
   * Send feedback message to doer session (bypass plugins, direct message creation)
   */
  async function sendFeedbackToDoer(sessionID: string, feedback: string) {
    log.info("sending feedback to doer", {
      session: sessionID,
      feedback,
    })

    // Create message directly to avoid plugin loading delays
    const messageID = Identifier.ascending("message")
    const partID = Identifier.ascending("part")

    const messageInfo: MessageV2.Info = {
      id: messageID,
      role: "user",
      sessionID,
      time: {
        created: Date.now(),
      },
    }

    const part: MessageV2.TextPart = {
      id: partID,
      messageID,
      sessionID,
      type: "text",
      text: `🔍 Orchestrator Feedback: ${feedback}`,
      synthetic: true,
      time: {
        start: Date.now(),
        end: Date.now(),
      },
    }

    await Session.updateMessage(messageInfo)
    await Session.updatePart(part)

    log.info("feedback sent", {
      session: sessionID,
      messageID,
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
   * Build a comprehensive conversation summary for evaluation
   */
  function buildConversationSummary(messages: MessageV2.WithParts[], todos: Todo.Info[]): string {
    const summaryParts: string[] = []

    // 1. Todo status overview
    const completedTodos = todos.filter((t) => t.status === "completed")
    const inProgressTodos = todos.filter((t) => t.status === "in_progress")
    const pendingTodos = todos.filter((t) => t.status === "pending")

    summaryParts.push("📋 CURRENT TODO STATUS:")
    summaryParts.push(`- Completed: ${completedTodos.length}/${todos.length}`)
    summaryParts.push(`- In Progress: ${inProgressTodos.length}`)
    summaryParts.push(`- Pending: ${pendingTodos.length}`)

    if (inProgressTodos.length > 0) {
      summaryParts.push(`\nCurrent task: ${inProgressTodos[0].content}`)
    }

    if (pendingTodos.length > 0) {
      summaryParts.push(`\nNext tasks:`)
      pendingTodos.slice(0, 3).forEach((t) => summaryParts.push(`  - ${t.content}`))
    }

    // 2. Conversation flow analysis
    summaryParts.push("\n💬 CONVERSATION SUMMARY:")

    const userMessages = messages.filter((m) => m.info.role === "user")
    const assistantMessages = messages.filter((m) => m.info.role === "assistant")

    summaryParts.push(`- Total exchanges: ${Math.min(userMessages.length, assistantMessages.length)}`)
    summaryParts.push(`- User messages: ${userMessages.length}`)
    summaryParts.push(`- Assistant messages: ${assistantMessages.length}`)

    // 3. Tool usage analysis
    const toolUses: Array<{ name: string; count: number }> = []
    for (const msg of assistantMessages) {
      for (const part of msg.parts) {
        if (part.type === "tool") {
          const name = (part as any).name || "unknown"
          const existing = toolUses.find((t) => t.name === name)
          if (existing) {
            existing.count++
          } else {
            toolUses.push({ name, count: 1 })
          }
        }
      }
    }

    if (toolUses.length > 0) {
      summaryParts.push("\n🔧 TOOLS USED:")
      toolUses.forEach((t) => summaryParts.push(`  - ${t.name}: ${t.count}x`))
    }

    // 4. Recent conversation context (last 3 exchanges)
    summaryParts.push("\n📝 RECENT CONVERSATION:")

    const recentMessages = messages.slice(-6) // Last 3 exchanges (6 messages)
    for (const msg of recentMessages) {
      const role = msg.info.role === "user" ? "USER" : "ASSISTANT"
      const text = extractText(msg.parts)
      const toolCalls = msg.parts.filter((p) => p.type === "tool").length

      if (text) {
        const preview = text.substring(0, 150) + (text.length > 150 ? "..." : "")
        summaryParts.push(`\n${role}: ${preview}`)
      }

      if (toolCalls > 0) {
        summaryParts.push(`  [Used ${toolCalls} tool(s)]`)
      }
    }

    // 5. Last assistant message (what they just said)
    const lastAssistant = [...messages].reverse().find((m) => m.info.role === "assistant")
    if (lastAssistant) {
      const lastText = extractText(lastAssistant.parts)
      if (lastText) {
        summaryParts.push("\n🔍 LAST RESPONSE:")
        summaryParts.push(lastText.substring(0, 300) + (lastText.length > 300 ? "..." : ""))
      }
    }

    // 6. Issues detected
    summaryParts.push("\n⚠️ ANALYSIS:")
    const issues: string[] = []

    if (inProgressTodos.length > 1) {
      issues.push("Multiple tasks in progress - should focus on one")
    }

    if (assistantMessages.length > 10 && completedTodos.length === 0) {
      issues.push("Many messages but no completed tasks - possible stuck state")
    }

    const lastFewMessages = messages.slice(-3)
    const hasRecentToolUse = lastFewMessages.some((m) => m.parts.some((p) => p.type === "tool"))
    if (!hasRecentToolUse && todos.length > 0) {
      issues.push("No recent tool use despite pending tasks - may need guidance")
    }

    if (issues.length > 0) {
      issues.forEach((issue) => summaryParts.push(`- ${issue}`))
    } else {
      summaryParts.push("- No critical issues detected")
    }

    return summaryParts.join("\n")
  }

  /**
   * Create supervised session pair (orchestrator + doer)
   */
  export async function createSupervisionSession(input: { projectDescription: string; directory?: string }): Promise<{
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
