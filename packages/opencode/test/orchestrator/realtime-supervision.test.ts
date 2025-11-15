import { describe, test, expect } from "bun:test"
import { Session } from "../../src/session"
import { Todo } from "../../src/session/todo"
import { MessageV2 } from "../../src/session/message-v2"
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

describe("orchestrator - real-time supervision integration", () => {
  test("orchestrator monitors subagent todo changes in real-time", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { orchestratorSessionID, doerSessionID, cleanup } = await Orchestrator.createSupervisionSession({
          projectDescription: "Test real-time supervision",
        })

        // Verify parent-child relationship
        const doerSession = await Session.get(doerSessionID)
        expect(doerSession.parentID).toBe(orchestratorSessionID)

        // Subagent adds tasks
        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Implement feature",
              status: "pending",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Write tests",
              status: "pending",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        // Subagent starts first task
        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Implement feature",
              status: "in_progress",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Write tests",
              status: "pending",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        // Subagent completes first task
        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Implement feature",
              status: "completed",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Write tests",
              status: "pending",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        // Orchestrator should be monitoring these changes
        // No feedback should be sent yet (only one task in progress at a time)
        const messages = await collectMessages(doerSessionID)
        const feedbackMessages = messages.filter((m) => m.info.role === "user")

        expect(feedbackMessages.length).toBe(0)

        cleanup()
        await Session.remove(doerSessionID)
        await Session.remove(orchestratorSessionID)
      },
    })
  })

  test("orchestrator intervenes when subagent violates anti-patterns", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { orchestratorSessionID, doerSessionID, cleanup } = await Orchestrator.createSupervisionSession({
          projectDescription: "Test anti-pattern detection",
        })

        // Subagent creates multiple in-progress tasks (violation!)
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

        // Orchestrator should send feedback
        const messages = await collectMessages(doerSessionID)
        const feedbackMessages = messages.filter(
          (m) => m.info.role === "user" && m.parts.some((p) => p.type === "text" && p.text.includes("Orchestrator Feedback")),
        )

        expect(feedbackMessages.length).toBeGreaterThan(0)

        // Check feedback content mentions multiple in-progress tasks
        const feedbackText = feedbackMessages
          .flatMap((m) => m.parts)
          .filter((p) => p.type === "text")
          .map((p) => (p as any).text)
          .join(" ")

        expect(feedbackText).toContain("in progress")

        cleanup()
        await Session.remove(doerSessionID)
        await Session.remove(orchestratorSessionID)
      },
    })
  })

  test("orchestrator triggers review when subagent completes all tasks", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { orchestratorSessionID, doerSessionID, cleanup } = await Orchestrator.createSupervisionSession({
          projectDescription: "Test completion review",
        })

        // Subagent adds and completes tasks sequentially
        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Task 1",
              status: "in_progress",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Task 1",
              status: "completed",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 200))

        // Orchestrator should receive review prompt
        const orchestratorMessages = await collectMessages(orchestratorSessionID)
        const reviewMessages = orchestratorMessages.filter(
          (m) =>
            m.info.role === "user" &&
            m.parts.some((p) => p.type === "text" && p.text.includes("completed all their tasks")),
        )

        expect(reviewMessages.length).toBeGreaterThan(0)

        cleanup()
        await Session.remove(doerSessionID)
        await Session.remove(orchestratorSessionID)
      },
    })
  })

  test("orchestrator detects sequential task progression", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { orchestratorSessionID, doerSessionID, cleanup } = await Orchestrator.createSupervisionSession({
          projectDescription: "Test sequential progression",
        })

        // Step 1: Add tasks
        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Step 1",
              status: "pending",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Step 2",
              status: "pending",
              priority: "high",
            },
            {
              id: "task-3",
              content: "Step 3",
              status: "pending",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        // Step 2: Start first task
        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Step 1",
              status: "in_progress",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Step 2",
              status: "pending",
              priority: "high",
            },
            {
              id: "task-3",
              content: "Step 3",
              status: "pending",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        // Step 3: Complete first, start second
        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Step 1",
              status: "completed",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Step 2",
              status: "in_progress",
              priority: "high",
            },
            {
              id: "task-3",
              content: "Step 3",
              status: "pending",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        // Step 4: Complete second, start third
        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Step 1",
              status: "completed",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Step 2",
              status: "completed",
              priority: "high",
            },
            {
              id: "task-3",
              content: "Step 3",
              status: "in_progress",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        // Step 5: Complete all
        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Step 1",
              status: "completed",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Step 2",
              status: "completed",
              priority: "high",
            },
            {
              id: "task-3",
              content: "Step 3",
              status: "completed",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 200))

        // Should not get anti-pattern feedback (good behavior!)
        const doerMessages = await collectMessages(doerSessionID)
        const antiPatternFeedback = doerMessages.filter(
          (m) => m.info.role === "user" && m.parts.some((p) => p.type === "text" && p.text.includes("in progress")),
        )

        expect(antiPatternFeedback.length).toBe(0)

        // Should get completion review in orchestrator session
        const orchestratorMessages = await collectMessages(orchestratorSessionID)
        const reviewMessages = orchestratorMessages.filter(
          (m) =>
            m.info.role === "user" &&
            m.parts.some((p) => p.type === "text" && p.text.includes("completed all their tasks")),
        )

        expect(reviewMessages.length).toBeGreaterThan(0)

        cleanup()
        await Session.remove(doerSessionID)
        await Session.remove(orchestratorSessionID)
      },
    })
  })

  test("orchestrator handles rapid todo changes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const { orchestratorSessionID, doerSessionID, cleanup } = await Orchestrator.createSupervisionSession({
          projectDescription: "Test rapid changes",
        })

        // Rapid succession of changes
        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Fast task",
              status: "pending",
              priority: "high",
            },
          ],
        })

        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Fast task",
              status: "in_progress",
              priority: "high",
            },
          ],
        })

        await Todo.update({
          sessionID: doerSessionID,
          todos: [
            {
              id: "task-1",
              content: "Fast task",
              status: "completed",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 200))

        // Should handle rapid changes without errors
        const orchestratorMessages = await collectMessages(orchestratorSessionID)
        expect(orchestratorMessages).toBeDefined()

        cleanup()
        await Session.remove(doerSessionID)
        await Session.remove(orchestratorSessionID)
      },
    })
  })
})
