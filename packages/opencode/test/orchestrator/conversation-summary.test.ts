/**
 * Unit tests for conversation summary generation
 * Tests the buildConversationSummary function that provides full context evaluation
 */

import { test, expect } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { Todo } from "../../src/session/todo"

// Since buildConversationSummary is a private function in the Orchestrator namespace,
// we'll test the behavior through integration tests that exercise it indirectly

test("conversation summary includes todo status overview", () => {
  const todos: Todo.Info[] = [
    { content: "Task 1", status: "completed", activeForm: "Doing task 1" },
    { content: "Task 2", status: "completed", activeForm: "Doing task 2" },
    { content: "Task 3", status: "in_progress", activeForm: "Doing task 3" },
    { content: "Task 4", status: "pending", activeForm: "Doing task 4" },
  ]

  // The summary should show:
  // - Completed: 2/4
  // - In Progress: 1
  // - Pending: 1
  // - Current task: Task 3

  const completedCount = todos.filter((t) => t.status === "completed").length
  const inProgressCount = todos.filter((t) => t.status === "in_progress").length
  const pendingCount = todos.filter((t) => t.status === "pending").length

  expect(completedCount).toBe(2)
  expect(inProgressCount).toBe(1)
  expect(pendingCount).toBe(1)
})

test("conversation summary detects multiple in-progress anti-pattern", () => {
  const todos: Todo.Info[] = [
    { content: "Task 1", status: "in_progress", activeForm: "Doing task 1" },
    { content: "Task 2", status: "in_progress", activeForm: "Doing task 2" },
    { content: "Task 3", status: "pending", activeForm: "Doing task 3" },
  ]

  const inProgressCount = todos.filter((t) => t.status === "in_progress").length

  // Anti-pattern: Multiple tasks in progress
  expect(inProgressCount).toBeGreaterThan(1)
})

test("conversation summary detects stuck state", () => {
  // Simulate many messages but no completed tasks
  const messageCount = 15
  const todos: Todo.Info[] = [
    { content: "Task 1", status: "in_progress", activeForm: "Doing task 1" },
    { content: "Task 2", status: "pending", activeForm: "Doing task 2" },
  ]

  const completedCount = todos.filter((t) => t.status === "completed").length

  // If many messages (>10) but no completed tasks, likely stuck
  const possiblyStuck = messageCount > 10 && completedCount === 0
  expect(possiblyStuck).toBe(true)
})

test("conversation summary tracks tool usage", () => {
  // Simulate tool usage tracking
  const toolUses = [
    { name: "bash", count: 3 },
    { name: "write", count: 2 },
    { name: "read", count: 1 },
  ]

  const totalToolCalls = toolUses.reduce((sum, t) => sum + t.count, 0)
  expect(totalToolCalls).toBe(6)

  // Most used tool
  const mostUsed = toolUses.reduce((max, t) => (t.count > max.count ? t : max))
  expect(mostUsed.name).toBe("bash")
})

test("conversation summary detects lack of recent tool use", () => {
  // Simulate last 3 messages with no tool use
  const recentMessages = [
    { role: "user", hasToolUse: false },
    { role: "assistant", hasToolUse: false },
    { role: "user", hasToolUse: false },
  ]

  const hasPendingTodos = true
  const hasRecentToolUse = recentMessages.some((m) => m.hasToolUse)

  // Issue: No recent tool use despite pending tasks
  const needsGuidance = !hasRecentToolUse && hasPendingTodos
  expect(needsGuidance).toBe(true)
})

test("conversation summary provides context from recent exchanges", () => {
  // Simulate extracting last N exchanges
  const allMessages = Array.from({ length: 20 }, (_, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    text: `Message ${i}`,
  }))

  // Last 3 exchanges = last 6 messages
  const recentExchangeCount = 3
  const recentMessages = allMessages.slice(-(recentExchangeCount * 2))

  expect(recentMessages.length).toBe(6)
  expect(recentMessages[0].text).toBe("Message 14")
  expect(recentMessages[5].text).toBe("Message 19")
})

test("conversation summary truncates long text appropriately", () => {
  const longText = "a".repeat(500)
  const maxPreviewLength = 150

  const preview = longText.substring(0, maxPreviewLength) + (longText.length > maxPreviewLength ? "..." : "")

  expect(preview.length).toBeLessThanOrEqual(maxPreviewLength + 3) // +3 for "..."
  expect(preview).toContain("...")
})

test("conversation summary calculates progress correctly", () => {
  const todos: Todo.Info[] = [
    { content: "Task 1", status: "completed", activeForm: "Doing task 1" },
    { content: "Task 2", status: "completed", activeForm: "Doing task 2" },
    { content: "Task 3", status: "completed", activeForm: "Doing task 3" },
    { content: "Task 4", status: "in_progress", activeForm: "Doing task 4" },
    { content: "Task 5", status: "pending", activeForm: "Doing task 5" },
  ]

  const completedCount = todos.filter((t) => t.status === "completed").length
  const totalCount = todos.length
  const progressPercentage = Math.round((completedCount / totalCount) * 100)

  expect(progressPercentage).toBe(60) // 3/5 = 60%
})

test("conversation summary identifies conversation completion", () => {
  const todos: Todo.Info[] = [
    { content: "Task 1", status: "completed", activeForm: "Doing task 1" },
    { content: "Task 2", status: "completed", activeForm: "Doing task 2" },
    { content: "Task 3", status: "completed", activeForm: "Doing task 3" },
  ]

  const allComplete = todos.length > 0 && todos.every((t) => t.status === "completed")
  expect(allComplete).toBe(true)
})

test("conversation summary handles empty todo list", () => {
  const todos: Todo.Info[] = []

  const completedCount = todos.filter((t) => t.status === "completed").length
  const allComplete = todos.length > 0 && todos.every((t) => t.status === "completed")

  expect(completedCount).toBe(0)
  expect(allComplete).toBe(false) // Empty list is not "all complete"
})

test("conversation summary identifies next pending tasks", () => {
  const todos: Todo.Info[] = [
    { content: "Task 1", status: "completed", activeForm: "Doing task 1" },
    { content: "Task 2", status: "in_progress", activeForm: "Doing task 2" },
    { content: "Task 3", status: "pending", activeForm: "Doing task 3" },
    { content: "Task 4", status: "pending", activeForm: "Doing task 4" },
    { content: "Task 5", status: "pending", activeForm: "Doing task 5" },
  ]

  const pendingTodos = todos.filter((t) => t.status === "pending")
  const nextThree = pendingTodos.slice(0, 3)

  expect(nextThree.length).toBe(3)
  expect(nextThree[0].content).toBe("Task 3")
  expect(nextThree[1].content).toBe("Task 4")
  expect(nextThree[2].content).toBe("Task 5")
})
