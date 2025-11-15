import { Turn } from "../conversation/turn"
import { Renderer } from "../conversation/renderer"
import { DualSessionAPI } from "./types"

export namespace APITransform {
  /**
   * Transforms neutral turns into human-readable API format.
   * - Junior agent becomes "build" role
   * - Senior agent becomes "supervise" role
   * - Tool calls are rendered as markdown (already done by Renderer)
   */
  export function toTurnViews(turns: Turn.Info[]): DualSessionAPI.TurnView[] {
    return turns.map((turn) => ({
      id: turn.id,
      role: turn.agent === "junior" ? ("build" as const) : ("supervise" as const),
      timestamp: turn.timestamp,
      content: Renderer.renderTurnAsMarkdown(turn),
    }))
  }

  /**
   * Get the human-readable role for an agent
   */
  export function toHumanRole(agent: "junior" | "senior"): "build" | "supervise" {
    return agent === "junior" ? "build" : "supervise"
  }
}
