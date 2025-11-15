# @opencode-ai/pair-programming

Dual-agent pair programming system where two AI agents collaborate in a single conversation.

## Quick Start

```typescript
import { DualSession } from "@opencode-ai/pair-programming"

await DualSession.run({
  conversationId: "my-task",
  initialPrompt: "Implement user authentication",
  maxTurns: 20,
  provider: {
    providerID: "anthropic",
    juniorModelID: "claude-sonnet-4",
    seniorModelID: "claude-opus-4"
  }
})
```

## How It Works

Instead of hierarchical subagent invocation, this implements peer collaboration:
- **Junior Agent**: Does the work, executes tools, writes code
- **Senior Agent**: Provides guidance, reviews, asks questions
- Both share the same conversation, tools, and context
- Conversation history is reframed based on whose turn it is (role inversion)

## Development

```bash
bun install
bun test
bun run dev
```
