import { describe, test, expect } from "bun:test"
import { Session } from "../../src/session"
import { Todo } from "../../src/session/todo"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import path from "path"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

// Test helper to detect todo changes (mirrors orchestrator logic)
function detectTodoChanges(
  previous: Todo.Info[],
  current: Todo.Info[],
): Array<{ type: string; content: string; previousStatus?: string }> {
  const changes: Array<{ type: string; content: string; previousStatus?: string }> = []

  // Check for completed todos
  for (const prevTodo of previous) {
    const currTodo = current.find((t) => t.content === prevTodo.content)
    if (currTodo && prevTodo.status !== "completed" && currTodo.status === "completed") {
      changes.push({
        type: "completed",
        content: currTodo.content,
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
        content: currTodo.content,
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
        content: currTodo.content,
      })
    }
  }

  // Check if all todos are completed
  const allCompleted = current.length > 0 && current.every((t) => t.status === "completed")
  const prevAllCompleted = previous.length > 0 && previous.every((t) => t.status === "completed")
  if (allCompleted && !prevAllCompleted) {
    changes.push({
      type: "all_completed",
      content: current[current.length - 1].content,
    })
  }

  return changes
}

describe("orchestrator - todo change detection", () => {
  test("detects when todo is added", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({
          title: "Test Session",
        })

        const detectedChanges: Array<{ type: string; content: string }> = []
        let previousTodos: Todo.Info[] = []

        const unsub = Bus.subscribe(Todo.Event.Updated, (event) => {
          if (event.properties.sessionID !== session.id) return

          const currentTodos = event.properties.todos
          const changes = detectTodoChanges(previousTodos, currentTodos)
          detectedChanges.push(...changes)
          previousTodos = currentTodos
        })

        // Add a new todo
        await Todo.update({
          sessionID: session.id,
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

        expect(detectedChanges.some((c) => c.type === "added" && c.content === "Create feature")).toBe(true)

        unsub()
        await Session.remove(session.id)
      },
    })
  })

  test("detects when todo is started", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({
          title: "Test Session",
        })

        const detectedChanges: Array<{ type: string; content: string }> = []
        let previousTodos: Todo.Info[] = []

        const unsub = Bus.subscribe(Todo.Event.Updated, (event) => {
          if (event.properties.sessionID !== session.id) return

          const currentTodos = event.properties.todos
          const changes = detectTodoChanges(previousTodos, currentTodos)
          detectedChanges.push(...changes)
          previousTodos = currentTodos
        })

        // Add todo
        await Todo.update({
          sessionID: session.id,
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

        // Start the todo
        await Todo.update({
          sessionID: session.id,
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

        expect(detectedChanges.some((c) => c.type === "started" && c.content === "Create feature")).toBe(true)

        unsub()
        await Session.remove(session.id)
      },
    })
  })

  test("detects when todo is completed", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({
          title: "Test Session",
        })

        const detectedChanges: Array<{ type: string; content: string }> = []
        let previousTodos: Todo.Info[] = []

        const unsub = Bus.subscribe(Todo.Event.Updated, (event) => {
          if (event.properties.sessionID !== session.id) return

          const currentTodos = event.properties.todos
          const changes = detectTodoChanges(previousTodos, currentTodos)
          detectedChanges.push(...changes)
          previousTodos = currentTodos
        })

        // Add and start todo
        await Todo.update({
          sessionID: session.id,
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

        // Complete the todo
        await Todo.update({
          sessionID: session.id,
          todos: [
            {
              id: "task-1",
              content: "Create feature",
              status: "completed",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(detectedChanges.some((c) => c.type === "completed" && c.content === "Create feature")).toBe(true)

        unsub()
        await Session.remove(session.id)
      },
    })
  })

  test("detects when all todos are completed", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({
          title: "Test Session",
        })

        const detectedChanges: Array<{ type: string; content: string }> = []
        let previousTodos: Todo.Info[] = []

        const unsub = Bus.subscribe(Todo.Event.Updated, (event) => {
          if (event.properties.sessionID !== session.id) return

          const currentTodos = event.properties.todos
          const changes = detectTodoChanges(previousTodos, currentTodos)
          detectedChanges.push(...changes)
          previousTodos = currentTodos
        })

        // Add two todos
        await Todo.update({
          sessionID: session.id,
          todos: [
            {
              id: "task-1",
              content: "Task 1",
              status: "completed",
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

        await new Promise((resolve) => setTimeout(resolve, 100))

        // Complete all todos
        await Todo.update({
          sessionID: session.id,
          todos: [
            {
              id: "task-1",
              content: "Task 1",
              status: "completed",
              priority: "high",
            },
            {
              id: "task-2",
              content: "Task 2",
              status: "completed",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(detectedChanges.some((c) => c.type === "completed" && c.content === "Task 2")).toBe(true)
        expect(detectedChanges.some((c) => c.type === "all_completed")).toBe(true)

        unsub()
        await Session.remove(session.id)
      },
    })
  })

  test("detects multiple changes in single update", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({
          title: "Test Session",
        })

        const detectedChanges: Array<{ type: string; content: string }> = []
        let previousTodos: Todo.Info[] = []

        const unsub = Bus.subscribe(Todo.Event.Updated, (event) => {
          if (event.properties.sessionID !== session.id) return

          const currentTodos = event.properties.todos
          const changes = detectTodoChanges(previousTodos, currentTodos)
          detectedChanges.push(...changes)
          previousTodos = currentTodos
        })

        // Initial state: one pending task
        await Todo.update({
          sessionID: session.id,
          todos: [
            {
              id: "task-1",
              content: "Task 1",
              status: "pending",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        // Update: add new task AND start existing task
        await Todo.update({
          sessionID: session.id,
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
              status: "pending",
              priority: "high",
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(detectedChanges.some((c) => c.type === "started" && c.content === "Task 1")).toBe(true)
        expect(detectedChanges.some((c) => c.type === "added" && c.content === "Task 2")).toBe(true)

        unsub()
        await Session.remove(session.id)
      },
    })
  })

  test("does not detect changes when todos are unchanged", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({
          title: "Test Session",
        })

        const detectedChanges: Array<{ type: string; content: string }> = []
        let previousTodos: Todo.Info[] = []

        const unsub = Bus.subscribe(Todo.Event.Updated, (event) => {
          if (event.properties.sessionID !== session.id) return

          const currentTodos = event.properties.todos
          const changes = detectTodoChanges(previousTodos, currentTodos)
          detectedChanges.push(...changes)
          previousTodos = currentTodos
        })

        // Add todo
        await Todo.update({
          sessionID: session.id,
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

        const changesBeforeUpdate = detectedChanges.length

        // Update with same status (no real change)
        await Todo.update({
          sessionID: session.id,
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

        // Should not detect any new changes (only the initial "added")
        expect(detectedChanges.length).toBe(changesBeforeUpdate)

        unsub()
        await Session.remove(session.id)
      },
    })
  })
})
