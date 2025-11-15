import { FULL_BUILD_PROMPT } from "./prompts"

export namespace AgentRole {
  export type Role = "junior" | "senior"

  export interface Config {
    role: Role
    systemPrompt: string
  }

  // FULL OpenCode build prompt for both agents
  // This is an autonomous system - we don't optimize for speed
  export const JUNIOR: Config = {
    role: "junior",
    systemPrompt: FULL_BUILD_PROMPT,
  }

  export const SENIOR: Config = {
    role: "senior",
    systemPrompt: FULL_BUILD_PROMPT,
  }

  export function getConfig(role: Role): Config {
    return role === "junior" ? JUNIOR : SENIOR
  }
}
