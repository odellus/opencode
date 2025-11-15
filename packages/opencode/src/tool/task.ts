import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionLock } from "../session/lock"
import { SessionPrompt } from "../session/prompt"
import { DualPair } from "../session/dual-pair"

export const TaskTool = Tool.define("task", async () => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))
  const description = DESCRIPTION.replace(
    "{agents}",
    agents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters: z.object({
      description: z.string().describe("A short (3-5 words) description of the task"),
      prompt: z.string().describe("The task for the agent to perform"),
      subagent_type: z.string().describe("The type of specialized agent to use for this task"),
    }),
    async execute(params, ctx) {
      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      // Enforce subagent restrictions
      const callingAgent = ctx.agent
      if (callingAgent === "supervisor" || callingAgent === "orchestrator") {
        if (params.subagent_type !== "build") {
          throw new Error(
            `${callingAgent} can only delegate to BUILD agent. Attempted to invoke: ${params.subagent_type}`,
          )
        }
      }
      if (callingAgent === "architect") {
        if (params.subagent_type !== "supervisor" && params.subagent_type !== "orchestrator") {
          throw new Error(
            `architect can only delegate to SUPERVISOR/ORCHESTRATOR agent. Attempted to invoke: ${params.subagent_type}`,
          )
        }
      }
      const session = await Session.create({
        parentID: ctx.sessionID,
        title: params.description + ` (@${agent.name} subagent)`,
        metadata: {
          includeParentContext: true,
          includeSiblingContext: true,
        },
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
        },
      })

      const messageID = Identifier.ascending("message")
      const parts: Record<string, MessageV2.ToolPart> = {}
      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== session.id) return
        if (evt.properties.part.messageID === messageID) return
        if (evt.properties.part.type !== "tool") return
        parts[evt.properties.part.id] = evt.properties.part
        ctx.metadata({
          title: params.description,
          metadata: {
            summary: Object.values(parts).sort((a, b) => a.id?.localeCompare(b.id)),
            sessionId: session.id,
          },
        })
      })

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      ctx.abort.addEventListener("abort", () => {
        SessionLock.abort(session.id)
      })

      // Check if this is a dual-pair subagent
      if (params.subagent_type === "dual-pair") {
        // Run dual-pair executor/discriminator loop
        const dualPairResult = await DualPair.run({
          sessionID: session.id,
          task: params.prompt,
          maxSteps: 50, // Default to 50 executor→discriminator cycles
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
        })

        unsub()

        // Get all tool calls from the session
        let all = await Session.messages({ sessionID: session.id })
        all = all.filter((x) => x.info.role === "assistant")
        const toolParts = all.flatMap((msg) => msg.parts.filter((x: any) => x.type === "tool") as MessageV2.ToolPart[])

        return {
          title: params.description,
          metadata: {
            summary: toolParts,
            sessionId: session.id,
            steps: dualPairResult.steps,
            completed: dualPairResult.completed,
          } as any,
          output: dualPairResult.summary || `Dual-pair session completed in ${dualPairResult.steps} steps`,
        }
      }

      // Normal single-agent flow
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)
      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        tools: {
          todowrite: false,
          todoread: false,
          task: false,
          ...agent.tools,
        },
        parts: promptParts,
      })
      unsub()
      let all
      all = await Session.messages({ sessionID: session.id })
      all = all.filter((x) => x.info.role === "assistant")
      all = all.flatMap((msg) => msg.parts.filter((x: any) => x.type === "tool") as MessageV2.ToolPart[])
      return {
        title: params.description,
        metadata: {
          summary: all,
          sessionId: session.id,
        },
        output: (result.parts.findLast((x: any) => x.type === "text") as any)?.text ?? "",
      }
    },
  }
})
