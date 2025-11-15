import { Turn } from "./turn"
import { ulid } from "ulid"

export namespace Conversation {
  // In-memory storage for now, will integrate with opencode Storage later
  const conversations = new Map<string, Turn.Info[]>()

  export function create(id: string): void {
    if (conversations.has(id)) {
      throw new Error(`Conversation ${id} already exists`)
    }
    conversations.set(id, [])
  }

  export function addTurn(conversationId: string, turn: Turn.Info): void {
    const turns = conversations.get(conversationId)
    if (!turns) {
      throw new Error(`Conversation ${conversationId} not found`)
    }
    turns.push(turn)
  }

  export function getTurns(conversationId: string): Turn.Info[] {
    const turns = conversations.get(conversationId)
    if (!turns) {
      throw new Error(`Conversation ${conversationId} not found`)
    }
    return [...turns]
  }

  export function exists(conversationId: string): boolean {
    return conversations.has(conversationId)
  }

  export function clear(conversationId: string): void {
    conversations.delete(conversationId)
  }

  export function generateId(): string {
    return ulid()
  }
}
