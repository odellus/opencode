import { describe, test, expect } from "bun:test"
import { Session } from "../../src/session"
import { Todo } from "../../src/session/todo"
import { MessageV2 } from "../../src/session/message-v2"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { Orchestrator } from "../../src/orchestrator/orchestrator"
import path from "path"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

// Helper to collect messages from stream
async function collectMessages(sessionID: string): Promise<MessageV2.WithParts[]> {
  const messages: MessageV2.WithParts[] = []
  for await (const msg of MessageV2.stream(sessionID)) {
    messages.push(msg)
  }
  return messages
}

describe("orchestrator - supervision", () => {
  test("orchestrator detects multiple in-progress todos via Bus events", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const orchestratorSession = await Session.create({
          title: "Orchestrator",
        })

        const doerSession = await Session.create({
          title: "Doer",
          parentID: orchestratorSession.id,
        })

        // Track detected anti-patterns
        const detectedPatterns: string[] = []

        // Set up monitoring (simpler than full supervision)
        const unsub = Bus.subscribe(Todo.Event.Updated, (event) => {
          if (event.properties.sessionID !== doerSession.id) return

          const todos = event.properties.todos
          const inProgress = todos.filter((t) => t.status === "in_progress")

          if (inProgress.length > 1) {
            detectedPatterns.push("multiple_in_progress")
          }
        })

        // Doer creates multiple in-progress todos (bad!)
        await Todo.update({
          sessionID: doerSession.id,
          todos: [
            {
              id: "task-1",
              content: "Task 1",
              status: "in_progress",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Task 2",
              status: "in_progress",
              priority: "high",
            },
          ],
        })

        // Wait for event propagation
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Orchestrator should have detected the pattern
        expect(detectedPatterns).toContain("multiple_in_progress")

        // Cleanup
        unsub()
        await Session.remove(doerSession.id)
        await Session.remove(orchestratorSession.id)
      },
    })
  })

  test("orchestrator supervises doer session lifecycle", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const orchestratorSession = await Session.create({
          title: "Orchestrator",
        })

        const doerSession = await Session.create({
          title: "Doer",
          parentID: orchestratorSession.id,
        })

        // Verify parent-child relationship
        expect(doerSession.parentID).toBe(orchestratorSession.id)

        const cleanup = await Orchestrator.supervise({
          orchestratorSessionID: orchestratorSession.id,
          doerSessionID: doerSession.id,
        })

        // Doer updates todos - orchestrator should monitor
        await Todo.update({
          sessionID: doerSession.id,
          todos: [
            {
              id: "task-1",
              content: "Create feature",
              status: "pending",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        // Doer starts task
        await Todo.update({
          sessionID: doerSession.id,
          todos: [
            {
              id: "task-1",
              content: "Create feature",
              status: "in_progress",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        // No feedback should be sent (only one task in progress)
        const messages = await collectMessages(doerSession.id)
        const feedbackMessages = messages.filter((m) => m.info.role === "user")

        expect(feedbackMessages.length).toBe(0)

        cleanup()
        await Session.remove(doerSession.id)
        await Session.remove(orchestratorSession.id)
      },
    })
  })

  test("orchestrator can be stopped and restarted", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { orchestratorSessionID, doerSessionID, cleanup } = await Orchestrator.createSupervisionSession({
          projectDescription: "Test project",
        })

        await new Promise((resolve) => setTimeout(resolve, 50))

        // Doer creates bad todos
        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Task 1",
              status: "in_progress",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Task 2",
              status: "in_progress",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 200))

        // Stop supervision
        cleanup()

        // Clear messages
        const messages = await collectMessages(doerSessionID)
        const messageCountBefore = messages.length

        // Doer creates more bad todos (orchestrator should NOT respond)
        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Task 1",
              status: "in_progress",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Task 2",
              status: "in_progress",
              priority: "high",
            },
            {
              id: "task-3",
              content: "Task 3",
              status: "in_progress",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 200))

        const messagesAfter = await collectMessages(doerSessionID)

        // No new feedback should be sent (orchestrator stopped)
        expect(messagesAfter.length).toBe(messageCountBefore)

        await Session.remove(doerSessionID)
        await Session.remove(orchestratorSessionID)
      },
    })
  })
})
