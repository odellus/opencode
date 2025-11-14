import { describe, test, expect } from "bun:test"
import { Session } from "../../src/session"
import { Todo } from "../../src/session/todo"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import path from "path"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("orchestrator - basic coordination", () => {
  test("orchestrator session can monitor doer session via Bus events", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Create orchestrator session
        const orchestratorSession = await Session.create({
          title: "Orchestrator",
        })

        // Create doer session as child
        const doerSession = await Session.create({
          title: "Doer",
          parentID: orchestratorSession.id,
        })

        expect(doerSession.parentID).toBe(orchestratorSession.id)

        // Orchestrator subscribes to doer's todo updates
        const todoUpdates: Todo.Info[][] = []

        const unsub = Bus.subscribe(Todo.Event.Updated, (event) => {
          if (event.properties.sessionID === doerSession.id) {
            todoUpdates.push(event.properties.todos)
          }
        })

        // Doer updates todos
        await Todo.update({
          sessionID: doerSession.id,
          todos: [
            {
              id: "task-1",
              content: "Create hello.txt",
              status: "pending",
              priority: "high",
            },
          ],
        })

        // Wait for event propagation
        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        // Assert orchestrator received the event
        expect(todoUpdates.length).toBe(1)
        expect(todoUpdates[0]).toHaveLength(1)
        expect(todoUpdates[0][0].content).toBe("Create hello.txt")
        expect(todoUpdates[0][0].status).toBe("pending")

        // Cleanup
        await Session.remove(doerSession.id)
        await Session.remove(orchestratorSession.id)
      },
    })
  })

  test("orchestrator detects multiple in-progress todos", async () => {
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

        const antiPatterns: string[] = []

        const unsub = Bus.subscribe(Todo.Event.Updated, (event) => {
          if (event.properties.sessionID === doerSession.id) {
            const todos = event.properties.todos
            const inProgress = todos.filter((t) => t.status === "in_progress")

            // Anti-pattern: Multiple tasks in progress
            if (inProgress.length > 1) {
              antiPatterns.push("multiple_in_progress")
            }
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
            {
              id: "task-3",
              content: "Task 3",
              status: "pending",
              priority: "low",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        // Orchestrator detected the anti-pattern
        expect(antiPatterns).toContain("multiple_in_progress")

        await Session.remove(doerSession.id)
        await Session.remove(orchestratorSession.id)
      },
    })
  })

  test("orchestrator can read doer's todos", async () => {
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

        // Doer creates todos
        await Todo.update({
          sessionID: doerSession.id,
          todos: [
            {
              id: "task-1",
              content: "Implement feature X",
              status: "in_progress",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Write tests",
              status: "pending",
              priority: "medium",
            },
          ],
        })

        // Orchestrator reads doer's todos
        const doerTodos = await Todo.get(doerSession.id)

        expect(doerTodos).toHaveLength(2)
        expect(doerTodos[0].content).toBe("Implement feature X")
        expect(doerTodos[0].status).toBe("in_progress")
        expect(doerTodos[1].content).toBe("Write tests")
        expect(doerTodos[1].status).toBe("pending")

        await Session.remove(doerSession.id)
        await Session.remove(orchestratorSession.id)
      },
    })
  })
})
