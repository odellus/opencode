/**
 * Langfuse Observability Setup
 *
 * Provides OpenTelemetry-based tracing for the autonomous agent system.
 * Configured for local Langfuse instance at localhost:3044
 */

import { NodeSDK } from "@opentelemetry/sdk-node"
import { LangfuseSpanProcessor } from "@langfuse/otel"
import { Log } from "../util/log"

const log = Log.create({ service: "langfuse" })

let sdk: NodeSDK | null = null
let spanProcessor: LangfuseSpanProcessor | null = null

export namespace Langfuse {
  /**
   * Initialize Langfuse with local instance
   */
  export function init() {
    if (sdk) {
      log.warn("Langfuse already initialized")
      return
    }

    try {
      // Get config from environment
      const publicKey = process.env.LANGFUSE_PUBLIC_KEY || ""
      const secretKey = process.env.LANGFUSE_SECRET_KEY || ""
      const baseUrl = process.env.LANGFUSE_BASE_URL || "http://localhost:3044"

      console.log("[Langfuse] Environment check:", {
        hasPublicKey: !!publicKey,
        hasSecretKey: !!secretKey,
        baseUrl,
        publicKeyPrefix: publicKey.slice(0, 8),
      })

      if (!publicKey || !secretKey) {
        log.warn("Langfuse keys not configured, skipping initialization")
        console.log("[Langfuse] Missing keys - check .env.local is loaded")
        return
      }

      // Create span processor for OpenTelemetry
      spanProcessor = new LangfuseSpanProcessor({
        publicKey,
        secretKey,
        baseUrl,
        environment: "local",
      })

      // Initialize OpenTelemetry SDK
      sdk = new NodeSDK({
        spanProcessors: [spanProcessor],
      })

      sdk.start()

      log.info("Langfuse initialized", {
        baseUrl: "http://localhost:3044",
        environment: "local",
      })
    } catch (error) {
      log.error("Failed to initialize Langfuse", { error })
    }
  }

  /**
   * Flush all pending spans
   */
  export async function flush() {
    if (spanProcessor) {
      await spanProcessor.forceFlush()
    }
  }

  /**
   * Shutdown Langfuse and flush remaining data
   */
  export async function shutdown() {
    if (sdk) {
      await sdk.shutdown()
      sdk = null
      spanProcessor = null
      log.info("Langfuse shutdown complete")
    }
  }
}
