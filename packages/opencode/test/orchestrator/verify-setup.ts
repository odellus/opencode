#!/usr/bin/env bun
/**
 * Verify that the environment is set up correctly for running real LLM tests
 */

import { Provider } from "../../src/provider/provider"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import path from "path"

async function main() {
  console.log("🔍 Verifying test environment setup...\n")

  // Check for test environment variables
  const testProviderId = process.env.TEST_PROVIDER_ID
  const testModelId = process.env.TEST_MODEL_ID

  console.log("📋 Environment Variables:")
  console.log(`  TEST_PROVIDER_ID: ${testProviderId || "(not set, will use default)"}`)
  console.log(`  TEST_MODEL_ID: ${testModelId || "(not set, will use default)"}\n`)

  // Check available providers (need Instance context)
  try {
    const directory = process.cwd()

    await Instance.provide({
      directory,
      fn: async () => {
        const config = await Config.get()
        const providers = await Provider.list()

        console.log("✅ Available Providers:")
        for (const [id, info] of Object.entries(providers)) {
          console.log(`  - ${id}: ${info.name || id}`)
          if (info.models) {
            const modelCount = Object.keys(info.models).length
            console.log(`    Models: ${modelCount}`)
            // Show first few models
            const modelIds = Object.keys(info.models).slice(0, 3)
            modelIds.forEach((modelId) => {
              console.log(`      - ${modelId}`)
            })
            if (modelCount > 3) {
              console.log(`      ... and ${modelCount - 3} more`)
            }
          }
        }

        // Check if test provider is available
        const targetProvider = testProviderId || "anthropic"
        const targetModel = testModelId || "claude-3-5-sonnet-20241022"

        console.log(`\n🎯 Target Configuration for Tests:`)
        console.log(`  Provider: ${targetProvider}`)
        console.log(`  Model: ${targetModel}`)

        if (providers[targetProvider]) {
          console.log(`  ✅ Provider "${targetProvider}" is available`)

          if (providers[targetProvider].models?.[targetModel]) {
            console.log(`  ✅ Model "${targetModel}" is available`)
            console.log(`\n✅ Environment is ready for real LLM tests!`)
            console.log(`\nTo run tests:`)
            console.log(`  bun test test/orchestrator/real-supervision.test.ts`)
          } else {
            console.log(`  ⚠️  Model "${targetModel}" not found in provider`)
            console.log(`\nAvailable models for ${targetProvider}:`)
            if (providers[targetProvider].models) {
              Object.keys(providers[targetProvider].models).forEach((m) => {
                console.log(`  - ${m}`)
              })
            }
            console.log(`\nSet TEST_MODEL_ID to use a different model:`)
            console.log(`  export TEST_MODEL_ID="your-model-id"`)
          }
        } else {
          console.log(`  ❌ Provider "${targetProvider}" is not available`)
          console.log(`\nTo use a different provider:`)
          console.log(`  export TEST_PROVIDER_ID="provider-name"`)
          console.log(`  export TEST_MODEL_ID="model-name"`)
          console.log(`\nOr configure "${targetProvider}" in .opencode/opencode.json`)
        }
      },
    })
  } catch (error) {
    console.error("❌ Error checking providers:", error)
    process.exit(1)
  }
}

main()
