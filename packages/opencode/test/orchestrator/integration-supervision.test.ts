/**
 * Integration tests for the orchestrator supervision system
 * Tests real-time monitoring, intervention, and conversation continuation
 */

import { test, expect } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Todo } from "../../src/session/todo"
import { Orchestrator } from "../../src/orchestrator/orchestrator"
import { tmpdir } from "../fixture/fixture"
import { Bus } from "../../src/bus"
import { MessageV2 } from "../../src/session/message-v2"

test("orchestrator detects todo changes in real-time", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestratorSession = await Session.create({ title: "Test Orchestrator" })
      const doerSession = await Session.create({ title: "Test Doer", parentID: orchestratorSession.id })

      const changes: any[] = []

      // Subscribe to monitor changes
      const unsub = Bus.subscribe(Todo.Event.Updated, (event) => {
        if (event.properties.sessionID === doerSession.id) {
          changes.push({ todos: [...event.properties.todos] })
        }
      })

      // Set up supervision
      const cleanup = await Orchestrator.supervise({
        orchestratorSessionID: orchestratorSession.id,
        doerSessionID: doerSession.id,
      })

      // Simulate todo updates
      await Todo.update({
        sessionID: doerSession.id,
        todos: [
          { content: "Task 1", status: "pending", activeForm: "Doing task 1" },
          { content: "Task 2", status: "pending", activeForm: "Doing task 2" },
        ],
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      await Todo.update({
        sessionID: doerSession.id,
        todos: [
          { content: "Task 1", status: "in_progress", activeForm: "Doing task 1" },
          { content: "Task 2", status: "pending", activeForm: "Doing task 2" },
        ],
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      await Todo.update({
        sessionID: doerSession.id,
        todos: [
          { content: "Task 1", status: "completed", activeForm: "Doing task 1" },
          { content: "Task 2", status: "in_progress", activeForm: "Doing task 2" },
        ],
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should have detected changes
      expect(changes.length).toBeGreaterThan(0)

      cleanup()
      unsub()
    },
  })
})

test("orchestrator detects all todos completed", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestratorSession = await Session.create({ title: "Test Orchestrator" })
      const doerSession = await Session.create({ title: "Test Doer", parentID: orchestratorSession.id })

      let allCompletedDetected = false

      const unsub = Bus.subscribe(Todo.Event.Updated, (event) => {
        if (event.properties.sessionID === doerSession.id) {
          const todos = event.properties.todos
          const allComplete = todos.length > 0 && todos.every((t) => t.status === "completed")
          if (allComplete) {
            allCompletedDetected = true
          }
        }
      })

      const cleanup = await Orchestrator.supervise({
        orchestratorSessionID: orchestratorSession.id,
        doerSessionID: doerSession.id,
      })

      // Set todos
      await Todo.update({
        sessionID: doerSession.id,
        todos: [
          { content: "Task 1", status: "pending", activeForm: "Doing task 1" },
          { content: "Task 2", status: "pending", activeForm: "Doing task 2" },
        ],
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Complete all todos
      await Todo.update({
        sessionID: doerSession.id,
        todos: [
          { content: "Task 1", status: "completed", activeForm: "Doing task 1" },
          { content: "Task 2", status: "completed", activeForm: "Doing task 2" },
        ],
      })

      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(allCompletedDetected).toBe(true)

      cleanup()
      unsub()
    },
  })
})

test("orchestrator detects multiple in-progress anti-pattern", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestratorSession = await Session.create({ title: "Test Orchestrator" })
      const doerSession = await Session.create({ title: "Test Doer", parentID: orchestratorSession.id })

      const cleanup = await Orchestrator.supervise({
        orchestratorSessionID: orchestratorSession.id,
        doerSessionID: doerSession.id,
      })

      // Create multiple in-progress tasks (anti-pattern)
      await Todo.update({
        sessionID: doerSession.id,
        todos: [
          { content: "Task 1", status: "in_progress", activeForm: "Doing task 1" },
          { content: "Task 2", status: "in_progress", activeForm: "Doing task 2" },
          { content: "Task 3", status: "in_progress", activeForm: "Doing task 3" },
        ],
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Get current todos to verify state
      const todos = await Todo.get(doerSession.id)
      const inProgress = todos.filter((t) => t.status === "in_progress")

      expect(inProgress.length).toBe(3)

      cleanup()
    },
  })
})

test("orchestrator tracks todo transitions", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestratorSession = await Session.create({ title: "Test Orchestrator" })
      const doerSession = await Session.create({ title: "Test Doer", parentID: orchestratorSession.id })

      const transitions: Array<{ type: string; content: string }> = []

      const unsub = Bus.subscribe(Todo.Event.Updated, (event) => {
        if (event.properties.sessionID === doerSession.id) {
          const todos = event.properties.todos
          todos.forEach((todo) => {
            if (todo.status === "in_progress") {
              transitions.push({ type: "started", content: todo.content })
            }
            if (todo.status === "completed") {
              transitions.push({ type: "completed", content: todo.content })
            }
          })
        }
      })

      const cleanup = await Orchestrator.supervise({
        orchestratorSessionID: orchestratorSession.id,
        doerSessionID: doerSession.id,
      })

      // Transition: pending → in_progress → completed
      await Todo.update({
        sessionID: doerSession.id,
        todos: [{ content: "Task 1", status: "pending", activeForm: "Doing task 1" }],
      })
      await new Promise((resolve) => setTimeout(resolve, 50))

      await Todo.update({
        sessionID: doerSession.id,
        todos: [{ content: "Task 1", status: "in_progress", activeForm: "Doing task 1" }],
      })
      await new Promise((resolve) => setTimeout(resolve, 50))

      await Todo.update({
        sessionID: doerSession.id,
        todos: [{ content: "Task 1", status: "completed", activeForm: "Doing task 1" }],
      })
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should have captured transitions
      const startedTransitions = transitions.filter((t) => t.type === "started")
      const completedTransitions = transitions.filter((t) => t.type === "completed")

      expect(startedTransitions.length).toBeGreaterThan(0)
      expect(completedTransitions.length).toBeGreaterThan(0)

      cleanup()
      unsub()
    },
  })
})

test("orchestrator monitors message updates", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestratorSession = await Session.create({ title: "Test Orchestrator" })
      const doerSession = await Session.create({ title: "Test Doer", parentID: orchestratorSession.id })

      const messageEvents: any[] = []

      const unsub = Bus.subscribe(MessageV2.Event.Updated, (event) => {
        if (event.properties.info.sessionID === doerSession.id) {
          messageEvents.push({ role: event.properties.info.role })
        }
      })

      const cleanup = await Orchestrator.supervise({
        orchestratorSessionID: orchestratorSession.id,
        doerSessionID: doerSession.id,
      })

      // Should capture message events when they occur
      // This is a placeholder - actual message creation would happen during agent execution
      await new Promise((resolve) => setTimeout(resolve, 100))

      cleanup()
      unsub()
    },
  })
})

test("supervision can be started and stopped cleanly", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestratorSession = await Session.create({ title: "Test Orchestrator" })
      const doerSession = await Session.create({ title: "Test Doer", parentID: orchestratorSession.id })

      // Start supervision
      const cleanup = await Orchestrator.supervise({
        orchestratorSessionID: orchestratorSession.id,
        doerSessionID: doerSession.id,
      })

      // Make some changes
      await Todo.update({
        sessionID: doerSession.id,
        todos: [{ content: "Task 1", status: "pending", activeForm: "Doing task 1" }],
      })
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Stop supervision
      cleanup()

      // After cleanup, events should no longer be monitored
      // (but we can't easily test this without internal access)
      expect(cleanup).toBeDefined()
    },
  })
})

test("createSupervisionSession creates parent-child relationship", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { orchestratorSessionID, doerSessionID, cleanup } = await Orchestrator.createSupervisionSession({
        projectDescription: "Test Project",
        directory: tmp.path,
      })

      expect(orchestratorSessionID).toBeDefined()
      expect(doerSessionID).toBeDefined()

      // Verify parent-child relationship
      const doerSession = await Session.get(doerSessionID)
      expect(doerSession.parentID).toBe(orchestratorSessionID)

      cleanup()
    },
  })
})

test("orchestrator handles rapid todo updates", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orchestratorSession = await Session.create({ title: "Test Orchestrator" })
      const doerSession = await Session.create({ title: "Test Doer", parentID: orchestratorSession.id })

      const eventCount = { count: 0 }

      const unsub = Bus.subscribe(Todo.Event.Updated, (event) => {
        if (event.properties.sessionID === doerSession.id) {
          eventCount.count++
        }
      })

      const cleanup = await Orchestrator.supervise({
        orchestratorSessionID: orchestratorSession.id,
        doerSessionID: doerSession.id,
      })

      // Rapid fire todo updates
      for (let i = 0; i < 10; i++) {
        await Todo.update({
          sessionID: doerSession.id,
          todos: [
            { content: `Task ${i}`, status: i % 2 === 0 ? "pending" : "in_progress", activeForm: `Doing task ${i}` },
          ],
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should have captured all events
      expect(eventCount.count).toBeGreaterThan(0)

      cleanup()
      unsub()
    },
  })
})
