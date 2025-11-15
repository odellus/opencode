import { Session } from "./index"
import { MessageV2 } from "./message-v2"
import { ToolRenderer } from "./tool-renderer"
import { Log } from "../util/log"
import path from "path"

export namespace SessionExport {
  const log = Log.create({ service: "session-export" })

  /**
   * Export session conversation to markdown format
   */
  export async function toMarkdown(sessionID: string): Promise<string> {
    const session = await Session.get(sessionID)
    const messages = await Session.messages({ sessionID })

    let markdown = `# ${session.title}\n\n`
    markdown += `**Session ID:** \`${sessionID}\`\n`
    markdown += `**Created:** ${new Date(session.time.created).toISOString()}\n`
    markdown += `**Project:** ${session.directory}\n\n`

    // Add metadata if present
    const metadata = session.metadata as any
    if (metadata?.dualPairAgent || metadata?.dualPairStep !== undefined) {
      markdown += `## Dual-Pair Session\n\n`
      if (metadata.dualPairComplete) {
        markdown += `✅ **Status:** Completed\n`
        markdown += `**Steps:** ${metadata.dualPairStep ?? "N/A"}\n`
        if (metadata.completionSummary) {
          markdown += `**Summary:** ${metadata.completionSummary}\n`
        }
      } else {
        markdown += `🔄 **Status:** In Progress\n`
      }
      markdown += `\n`
    }

    markdown += `---\n\n`

    // Export each message
    for (const msg of messages) {
      markdown += formatMessage(msg)
      markdown += `\n---\n\n`
    }

    return markdown
  }

  /**
   * Format a single message as markdown
   */
  function formatMessage(msg: MessageV2.WithParts): string {
    const role = msg.info.role
    const agent = role === "assistant" ? msg.info.mode || "unknown" : "user"
    const timestamp = new Date(msg.info.time.created).toISOString()

    let markdown = `## ${role === "user" ? "👤 User" : "🤖 Assistant"} (${agent})\n\n`
    markdown += `*${timestamp}*\n\n`

    // Cost and token info for assistant messages
    if (role === "assistant") {
      markdown += `**Tokens:** ${msg.info.tokens.input} in / ${msg.info.tokens.output} out`
      if (msg.info.tokens.cache.read > 0) {
        markdown += ` (${msg.info.tokens.cache.read} cached)`
      }
      markdown += `\n\n`
    }

    // Process parts
    const textParts = msg.parts.filter((p) => p.type === "text")
    const toolParts = msg.parts.filter((p) => p.type === "tool") as MessageV2.ToolPart[]

    // Render text content
    for (const part of textParts) {
      if (part.type === "text") {
        markdown += `${part.text}\n\n`
      }
    }

    // Render tool calls
    if (toolParts.length > 0) {
      markdown += ToolRenderer.renderAsMarkdown(toolParts)
      markdown += `\n\n`
    }

    return markdown
  }

  /**
   * Write session export to file
   */
  export async function writeToFile(sessionID: string, filePath: string): Promise<void> {
    const markdown = await toMarkdown(sessionID)
    await Bun.write(filePath, markdown)
    log.info("exported session to file", { sessionID, filePath })
  }

  /**
   * Get default export path for a session
   */
  export function getDefaultPath(sessionID: string, baseDir: string): string {
    return path.join(baseDir, ".opencode", "sessions", `${sessionID}.md`)
  }

  /**
   * Stream session updates to markdown file (for live export during dual-pair)
   */
  export async function streamToFile(sessionID: string, filePath: string): Promise<() => void> {
    // Ensure directory exists
    const dir = path.dirname(filePath)
    await Bun.write(path.join(dir, ".gitkeep"), "")

    // Initial export
    await writeToFile(sessionID, filePath)

    // TODO: Subscribe to message updates and re-export on changes
    // This will be implemented when we add Bus subscription support

    log.info("streaming session to file", { sessionID, filePath })

    // Return cleanup function
    return () => {
      log.info("stopped streaming session", { sessionID, filePath })
    }
  }
}
