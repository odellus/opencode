import { test, expect, describe, beforeEach } from "bun:test"
import { Conversation } from "../src/conversation/storage"
import { Turn } from "../src/conversation/turn"

describe("Conversation Storage", () => {
  const testId = "test-conversation"

  beforeEach(() => {
    if (Conversation.exists(testId)) {
      Conversation.clear(testId)
    }
  })

  test("creates new conversation", () => {
    Conversation.create(testId)
    expect(Conversation.exists(testId)).toBe(true)
  })

  test("throws when creating duplicate conversation", () => {
    Conversation.create(testId)
    expect(() => Conversation.create(testId)).toThrow()
  })

  test("adds and retrieves turns", () => {
    Conversation.create(testId)

    const turn1 = Turn.create({
      id: "turn1",
      agent: "junior",
      text: "Hello",
    })

    const turn2 = Turn.create({
      id: "turn2",
      agent: "senior",
      text: "Hi there",
    })

    Conversation.addTurn(testId, turn1)
    Conversation.addTurn(testId, turn2)

    const turns = Conversation.getTurns(testId)
    expect(turns).toHaveLength(2)
    expect(turns[0].id).toBe("turn1")
    expect(turns[0].agent).toBe("junior")
    expect(turns[1].id).toBe("turn2")
    expect(turns[1].agent).toBe("senior")
  })

  test("throws when adding turn to non-existent conversation", () => {
    const turn = Turn.create({
      id: "turn1",
      agent: "junior",
      text: "Hello",
    })

    expect(() => Conversation.addTurn("non-existent", turn)).toThrow()
  })

  test("throws when getting turns from non-existent conversation", () => {
    expect(() => Conversation.getTurns("non-existent")).toThrow()
  })

  test("clear removes conversation", () => {
    Conversation.create(testId)
    expect(Conversation.exists(testId)).toBe(true)

    Conversation.clear(testId)
    expect(Conversation.exists(testId)).toBe(false)
  })

  test("getTurns returns copy of turns array", () => {
    Conversation.create(testId)

    const turn = Turn.create({
      id: "turn1",
      agent: "junior",
      text: "Hello",
    })

    Conversation.addTurn(testId, turn)

    const turns1 = Conversation.getTurns(testId)
    const turns2 = Conversation.getTurns(testId)

    // Should be different array instances
    expect(turns1).not.toBe(turns2)
    // But contain the same data
    expect(turns1).toEqual(turns2)
  })

  test("generateId creates unique IDs", () => {
    const id1 = Conversation.generateId()
    const id2 = Conversation.generateId()

    expect(id1).not.toBe(id2)
    expect(typeof id1).toBe("string")
    expect(id1.length).toBeGreaterThan(0)
  })
})
