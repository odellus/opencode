#!/usr/bin/env bun

// Quick test to check if env vars are loaded
console.log("Environment variable test:")
console.log("LANGFUSE_PUBLIC_KEY:", process.env.LANGFUSE_PUBLIC_KEY || "(not set)")
console.log("LANGFUSE_SECRET_KEY:", process.env.LANGFUSE_SECRET_KEY || "(not set)")
console.log("LANGFUSE_BASE_URL:", process.env.LANGFUSE_BASE_URL || "(not set)")
console.log("\nAll env vars starting with LANGFUSE:")
Object.keys(process.env)
  .filter(k => k.startsWith("LANGFUSE"))
  .forEach(k => console.log(`  ${k}=${process.env[k]}`))
