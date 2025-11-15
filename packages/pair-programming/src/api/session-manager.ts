import { Conversation } from "../conversation/storage"
import { DualSession } from "../session/dual-session"
import { LocalProvider } from "../provider/local"
import { DualSessionAPI } from "./types"
import { APITransform } from "./transform"

export namespace SessionManager {
  type Status = "running" | "completed" | "aborted"

  interface RunningSession {
    conversationId: string
    status: Status
    currentAgent?: "junior" | "senior"
    promise: Promise<DualSession.Result>
    abortController: AbortController
  }

  const sessions = new Map<string, RunningSession>()

  export async function create(input: DualSessionAPI.CreateRequest): Promise<DualSessionAPI.CreateResponse> {
    const conversationId = Conversation.generateId()
    const abortController = new AbortController()

    // Create the model
    const model = LocalProvider.create()

    // Start the dual-agent session in the background
    const promise = DualSession.run({
      conversationId,
      initialPrompt: input.initialPrompt,
      maxTurns: input.maxTurns,
      model,
      juniorTurnsBeforeSeniorIntercept: input.juniorTurnsBeforeSeniorIntercept,
      workingDirectory: input.workingDirectory || process.cwd(),
      abortSignal: abortController.signal,
    })

    // Track the session
    sessions.set(conversationId, {
      conversationId,
      status: "running",
      promise,
      abortController,
    })

    // Update status when complete
    promise
      .then(() => {
        const session = sessions.get(conversationId)
        if (session) {
          session.status = "completed"
        }
      })
      .catch(() => {
        const session = sessions.get(conversationId)
        if (session && !abortController.signal.aborted) {
          session.status = "completed" // Even on error, mark as completed
        }
      })

    return {
      conversationId,
      status: "started",
    }
  }

  export function get(conversationId: string): DualSessionAPI.GetResponse {
    const session = sessions.get(conversationId)
    const turns = Conversation.getTurns(conversationId)

    return {
      conversationId,
      turns: APITransform.toTurnViews(turns),
      status: session?.status || "completed",
      currentAgent: session?.currentAgent,
    }
  }

  export function abort(conversationId: string): boolean {
    const session = sessions.get(conversationId)
    if (!session) return false

    session.abortController.abort()
    session.status = "aborted"
    return true
  }

  export function list(): string[] {
    return Array.from(sessions.keys())
  }

  export function cleanup(conversationId: string): void {
    sessions.delete(conversationId)
  }
}
