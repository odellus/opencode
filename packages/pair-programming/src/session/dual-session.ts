import { streamText } from "ai"
import { Conversation } from "../conversation/storage"
import { Turn } from "../conversation/turn"
import { Perspective } from "../agent/perspective"
import { AgentRole } from "../agent/roles"
import type { LanguageModel } from "ai"
// Import REAL OpenCode infrastructure
import { Instance } from "../../../opencode/src/project/instance"
import { ToolRegistry } from "../../../opencode/src/tool/registry"
import { Identifier } from "../../../opencode/src/id/id"

export namespace DualSession {
  export interface Config {
    conversationId: string
    initialPrompt: string
    maxTurns: number
    model: LanguageModel
    juniorTurnsBeforeSeniorIntercept?: number
    workingDirectory: string // Required for Instance.provide
    abortSignal?: AbortSignal
  }

  export interface Result {
    conversationId: string
    turns: Turn.Info[]
    completionReason: "max_turns" | "error"
  }

  export async function run(config: Config): Promise<Result> {
    const { conversationId, initialPrompt, maxTurns, model, workingDirectory, abortSignal } = config
    const interceptInterval = config.juniorTurnsBeforeSeniorIntercept ?? 3

    // Wrap everything in OpenCode's Instance.provide to get proper context
    return await Instance.provide({
      directory: workingDirectory,
      fn: async () => {
        // Create conversation
        Conversation.create(conversationId)

        // Add initial prompt as a junior turn (junior starts the work)
        const initialTurn = Turn.create({
          id: Conversation.generateId(),
          agent: "junior",
          text: initialPrompt,
        })
        Conversation.addTurn(conversationId, initialTurn)

        let turnCount = 0
        let currentAgent: AgentRole.Role = "senior" // Senior responds first to initial prompt

        // Create a fake session ID for tools that need it
        const fakeSessionID = Identifier.ascending("session")

        while (turnCount < maxTurns) {
          // Check for abort
          if (abortSignal?.aborted) {
            return {
              conversationId,
              turns: Conversation.getTurns(conversationId),
              completionReason: "error",
            }
          }

          // Get conversation history
          const turns = Conversation.getTurns(conversationId)

          // Transform for current agent's perspective
          const messages = Perspective.transformForAgent(turns, currentAgent)

          // Get agent config
          const agentConfig = AgentRole.getConfig(currentAgent)

          // Get REAL OpenCode tools
          const openCodeTools = await ToolRegistry.tools("local", "local-model")
          const tools: Record<string, any> = {}

          for (const tool of openCodeTools) {
            tools[tool.id] = {
              description: tool.description,
              parameters: tool.parameters,
              execute: async (params: any) => {
                // Call tool with proper OpenCode context
                const result = await tool.execute(params, {
                  sessionID: fakeSessionID,
                  messageID: Identifier.ascending("message"),
                  agent: currentAgent,
                  abort: new AbortController().signal,
                  metadata: () => {},
                })
                return result.output
              },
            }
          }

          // Call LLM with tools
          try {
            console.log(`[DualSession] Turn ${turnCount}: ${currentAgent} is thinking...`)
            console.log(`[DualSession] Messages count: ${messages.length}`)
            console.log(`[DualSession] Tools available: ${Object.keys(tools).join(", ")}`)

            const result = await streamText({
              model,
              system: agentConfig.systemPrompt,
              messages,
              tools,
              maxSteps: 10,
              experimental_telemetry: {
                isEnabled: true,
                functionId: `dual-session-${conversationId}-turn-${turnCount}`,
                metadata: {
                  agent: currentAgent,
                  conversationId,
                  turn: turnCount,
                },
              },
            })

            // Collect the full response including tool calls
            const toolCalls: Turn.ToolCall[] = []

            for await (const part of result.fullStream) {
              if (part.type === "tool-call") {
                console.log(`[DualSession] ${currentAgent} using tool: ${part.toolName}`)
              } else if (part.type === "tool-result") {
                toolCalls.push({
                  id: part.toolCallId,
                  name: part.toolName,
                  input: part.args as Record<string, any>,
                  output: typeof part.result === "string" ? part.result : JSON.stringify(part.result),
                  timestamp: Date.now(),
                })
              }
            }

            // Get the final text from the result
            const fullText = await result.text

            console.log(`[DualSession] ${currentAgent} responded: ${fullText.slice(0, 100)}...`)
            console.log(`[DualSession] ${currentAgent} used ${toolCalls.length} tools`)

            // Add agent's response as a turn
            const turn = Turn.create({
              id: Conversation.generateId(),
              agent: currentAgent,
              text: fullText || "(used tools only)",
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            })
            Conversation.addTurn(conversationId, turn)

            turnCount++

            // Switch agents
            // Pattern: Junior does work, senior intercepts periodically
            if (currentAgent === "senior") {
              currentAgent = "junior"
            } else {
              // Junior just went, check if senior should intercept
              if (turnCount % interceptInterval === 0) {
                currentAgent = "senior"
              }
              // Otherwise junior goes again
            }
          } catch (error) {
            console.error("LLM call failed:", error)
            return {
              conversationId,
              turns: Conversation.getTurns(conversationId),
              completionReason: "error",
            }
          }
        }

        return {
          conversationId,
          turns: Conversation.getTurns(conversationId),
          completionReason: "max_turns",
        }
      },
    })
  }
}
