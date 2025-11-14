# CLAUDE.md - OpenCode Codebase Guide

This file provides a comprehensive guide for AI assistants (like Claude) working with the OpenCode codebase. It covers the repository structure, development workflows, conventions, and best practices.

---

## What is OpenCode?

OpenCode is an AI-powered coding agent built for the terminal. It's a 100% open-source alternative to Claude Code, designed to be provider-agnostic with support for Anthropic, OpenAI, Google, and local models. The project features LSP support, a client/server architecture, and a powerful TUI interface.

**Key Characteristics:**
- Monorepo architecture using Bun workspaces and Turborepo
- TypeScript-first with ESM modules
- Client/server architecture enabling multiple frontends
- Built by terminal enthusiasts for terminal power users

---

## Repository Structure

### Monorepo Organization

```
/home/user/opencode/
├── packages/                 # Main application packages
│   ├── opencode/            # Core CLI & business logic (v1.0.65)
│   ├── sdk/                 # TypeScript SDK
│   ├── plugin/              # Plugin system
│   ├── script/              # Build utilities
│   ├── desktop/             # Desktop app (Vite + SolidJS)
│   ├── web/                 # Marketing site (Astro + SolidJS)
│   ├── ui/                  # Shared UI components
│   ├── console/             # SaaS platform (3 packages)
│   │   ├── app/            # Console frontend (SolidJS Start)
│   │   ├── core/           # Backend logic (Drizzle ORM)
│   │   └── function/       # Cloudflare Workers
│   ├── slack/               # Slack integration
│   └── function/            # GitHub integration
├── infra/                   # SST infrastructure as code
├── script/                  # Build & deployment scripts
├── sdks/vscode/             # VSCode extension
├── .opencode/               # Project configuration
│   ├── agent/              # Custom agent definitions
│   ├── command/            # Custom slash commands
│   └── themes/             # UI themes
├── .github/workflows/       # CI/CD automation
└── patches/                 # Package patches
```

### Core Packages

**`packages/opencode`** - The heart of OpenCode
- Entry point: `./bin/opencode` (CLI binary)
- Key directories:
  - `src/agent/` - AI agent orchestration
  - `src/session/` - Session management & state
  - `src/tool/` - Tool system (Bash, Edit, Read, Write, Grep, etc.)
  - `src/server/` - Hono HTTP server with OpenAPI
  - `src/lsp/` - Language Server Protocol integration
  - `src/mcp/` - Model Context Protocol support
  - `src/provider/` - LLM provider abstraction
  - `src/cli/` - Command-line interface & TUI

**`packages/sdk`** - Auto-generated TypeScript SDK
- Generated from OpenAPI specs in `packages/opencode/src/server/server.ts`
- **Important:** After modifying server endpoints, regenerate SDK with `./packages/sdk/js/script/build.ts`

**`packages/console/*`** - SaaS platform (optional)
- Uses PlanetScale (MySQL) with Drizzle ORM
- Cloudflare Workers deployment
- OpenAuth for authentication

---

## Technology Stack

### Runtime & Languages
- **Bun** v1.3.2+ - Primary runtime and package manager
- **TypeScript** 5.8.2 - Main language with strict types
- **Node.js** 22+ - For console packages only

### Frontend
- **SolidJS** 1.9.9 - Reactive UI framework
- **Astro** 5.7.13 - Static site generation
- **Vite** 7.1.4 - Build tool
- **Tailwind CSS** 4.1.11 - Styling
- **OpenTUI** - Terminal UI framework

### Backend
- **Hono** 4.7.10 - Web framework
- **Drizzle ORM** 0.41.0 - Database ORM
- **SST (Ion)** 3.17.23 - Infrastructure as Code

### AI Integration
- **Vercel AI SDK** 5.0.8 - LLM integration layer
- **Model Context Protocol** (MCP) 1.15.1
- **Agent Client Protocol** (ACP) 0.5.1
- Providers: Anthropic (primary), OpenAI, Google Vertex, Amazon Bedrock

### Code Analysis
- **Tree-sitter** - Syntax parsing
- **LSP** - Language server support
- **Shiki** 3.9.2 - Syntax highlighting

### Validation & Utilities
- **Zod** 4.1.8 - Schema validation (used extensively)
- **Remeda** 2.26.0 - Utility library (preferred over lodash)
- **Luxon** 3.6.1 - Date/time handling

---

## Development Setup

### Initial Setup

```bash
# Clone and install
git clone https://github.com/sst/opencode.git
cd opencode
bun install

# Run development server
bun dev

# Run tests
bun test

# Type checking
bun turbo typecheck
```

### Requirements
- Bun 1.3+
- Git configured with user email and name

### Development Workflow

1. **Local Development:**
   ```bash
   cd packages/opencode
   bun dev
   ```

2. **Type Checking:**
   ```bash
   bun turbo typecheck
   ```

3. **Running Tests:**
   ```bash
   bun turbo test              # All tests
   bun test                    # Package-specific
   bun test test/path/file.test.ts  # Single test file
   ```

4. **After Server Changes:**
   ```bash
   # Regenerate SDK when modifying packages/opencode/src/server/server.ts
   ./packages/sdk/js/script/build.ts
   ```

---

## Code Style & Conventions

### Fundamental Rules (Strictly Enforced)

**DO:**
- Keep logic in a single function unless composable/reusable
- Use Bun APIs like `Bun.file()` when available
- Use `.catch()` for error handling
- Use Zod schemas for validation
- Prefer immutable patterns
- Use precise types, avoid `any`
- Use concise single-word variable names when descriptive
- Use relative imports for local modules
- Use named imports

**DO NOT:**
- Use unnecessary destructuring
- Use `else` statements (prefer early returns)
- Use `try`/`catch` unless necessary
- Use `let` (prefer `const`)
- Use `any` type
- Use semicolons (Prettier removes them)

### Naming Conventions

- **Variables/Functions:** camelCase
- **Classes/Namespaces:** PascalCase
- **Files:** kebab-case for most, PascalCase for components
- **Constants:** UPPER_SNAKE_CASE for true constants

### Code Organization Patterns

**Namespace-based Organization:**
```typescript
export namespace Tool {
  export function define() { }
}

export namespace Session {
  export function create() { }
}
```

**Result Patterns (Not Exceptions):**
```typescript
// Prefer returning errors over throwing
function doSomething(): Result<Success, Error> {
  // implementation
}
```

**Dependency Injection:**
```typescript
await Instance.provide({
  directory: "/path",
  fn: async () => {
    // Code here has access to instance context
  }
})
```

**Event Bus Pattern:**
```typescript
Bus.subscribe(Session.Event.Created, (event) => {
  // Handle event
})
```

---

## Architecture Patterns

### 1. Client/Server Architecture

- **Server:** Hono-based HTTP API with OpenAPI specs
- **Clients:** TUI, Desktop, Web, CLI
- Communication via auto-generated SDK

### 2. Tool System

All tools implement the `Tool.Info` interface:

```typescript
export namespace Tool {
  export interface Info {
    name: string
    description: string
    input: ZodSchema
    execute: (input: any, context: Context) => Promise<Result>
  }
}
```

Available tools: Bash, Edit, Read, Write, Grep, Glob, WebFetch, WebSearch, LSP integration, etc.

### 3. Agent System

- Support for multiple agents (primary + subagents)
- Custom agents via `.opencode/agent/*.md`
- Agent-specific permissions and configurations
- Mode: `subagent` for specialized agents

### 4. Session Management

- Session-based conversation handling
- Features: retry, revert, compaction, summary
- TODO tracking within sessions
- Persistent storage with snapshots

### 5. Provider Abstraction

Unified interface for LLM providers with transformation layer:
- Anthropic (Claude)
- OpenAI (GPT)
- Google (Gemini)
- Local models

### 6. LSP Integration

- Language Server Protocol client
- Multi-language support
- Features: hover, diagnostics, formatting

### 7. Permission System

Granular permissions per tool:
- Modes: `allow`, `deny`, `ask`
- Agent-specific overrides
- Project-level configuration

---

## Testing

### Framework: Bun Test

OpenCode uses Bun's built-in test runner - fast and native.

### Test Organization

```
packages/opencode/test/
├── config/           # Configuration testing
├── file/             # File operations
├── lsp/              # LSP client tests
├── patch/            # Patch system
├── provider/         # Provider transformations
├── session/          # Session management
├── tool/             # Tool system with snapshots
└── util/             # Utility functions
```

### Test Pattern

```typescript
import { test, expect } from "bun:test"
import { Instance } from "../../src/project/instance"

test("description", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await someFunction()
      expect(result).toBe(expected)
    }
  })
})
```

### Key Patterns

- Use `Instance.provide()` for dependency injection
- Use `await using` for automatic cleanup
- Test fixtures in `test/fixture/`
- Snapshot testing for complex outputs
- Event bus testing via `Bus.subscribe()`

### Running Tests

```bash
bun turbo test                           # All packages
bun test                                 # Current package
bun test test/tool/bash.test.ts         # Specific file
```

---

## Package-Specific Guidelines

### packages/opencode

**Key Files:**
- `src/index.ts` - Main entry point
- `src/server/server.ts` - HTTP API (regenerate SDK after changes)
- `src/cli/cmd/tui/` - TUI code (SolidJS + OpenTUI)
- `src/tool/` - Tool implementations

**After Modifying Server:**
```bash
./packages/sdk/js/script/build.ts
```

### packages/console/core

**Database:**
- Drizzle ORM with PlanetScale (MySQL)
- Schemas in `src/schema/*.sql.ts`
- Migrations managed by Drizzle

**Run Migrations:**
```bash
drizzle-kit generate
drizzle-kit migrate
```

### packages/sdk

Auto-generated - **DO NOT** edit manually. Regenerate from server.

### packages/web

Documentation site using Astro + Starlight.

**Example Doc Structure:**
```mdx
---
title: Short Title
description: One short line, 5-10 words
---

Concise content (max 2 sentences per chunk)

---

## Section Title

Brief imperative mood sections
```

---

## Build & Release

### Build System: Turborepo

**Configuration (`turbo.json`):**
```json
{
  "tasks": {
    "typecheck": {},
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "opencode#test": {
      "dependsOn": ["^build"]
    }
  }
}
```

### Build Commands

```bash
bun turbo typecheck    # Type check all packages
bun turbo build        # Build all packages
bun turbo test         # Test all packages
```

### Release Process

Managed via GitHub Actions workflow (`.github/workflows/publish.yml`):

```bash
# Triggered manually with workflow_dispatch
# Inputs: bump (major/minor/patch), optional version override
```

**Release Script:** `./script/publish.ts`

**Channels:**
- `latest` - Production releases
- `dev` - Development releases

---

## CI/CD Workflows

### Key Workflows

**`.github/workflows/test.yml`**
- Triggers: Push/PR to all branches except production
- Runs: `bun turbo typecheck` + `bun turbo test`

**`.github/workflows/publish.yml`**
- Trigger: Manual workflow dispatch
- Actions: Version bump, build, publish to npm, update AUR

**`.github/workflows/deploy.yml`**
- Deploys infrastructure via SST

**`.github/workflows/format.yml`**
- Runs Prettier checks

**`.github/workflows/typecheck.yml`**
- TypeScript type checking

### Git Configuration

All CI workflows set:
```bash
git config --global user.email "bot@opencode.ai"
git config --global user.name "opencode"
```

---

## Working with AI Agents

### Custom Agents (`.opencode/agent/`)

**Structure:**
```markdown
---
description: When to use this agent
mode: subagent  # Optional
---

Agent instructions and behavior
```

**Examples:**
- `docs.md` - Documentation writing agent
- `git-committer.md` - Commit message agent

### Custom Commands (`.opencode/command/`)

Slash commands for common tasks:
- `/commit` - Commit changes
- `/spellcheck` - Check spelling
- `/hello` - Example command

### Agent Guidelines

From `AGENTS.md`:
- Use parallel tool calls when possible
- Avoid verbose LLM-generated responses
- Follow the established code style
- Keep functions single-purpose
- Use Bun APIs

---

## Important Conventions

### File Operations

**Imports:**
```typescript
// Prefer Bun APIs
const file = Bun.file("path/to/file")
const content = await file.text()

// Use relative imports for local modules
import { Tool } from "../tool/tool"
```

### Error Handling

```typescript
// Prefer .catch() over try/catch
const result = await operation()
  .catch(error => handleError(error))

// Use Result types in tools
return {
  success: false,
  error: "Error message"
}
```

### Control Flow

```typescript
// Avoid else statements
function example(condition: boolean) {
  if (!condition) return early

  // Main logic here
}

// Not this:
function badExample(condition: boolean) {
  if (condition) {
    // logic
  } else {
    // other logic
  }
}
```

### Formatting

**Prettier Config:**
- No semicolons
- Print width: 120
- Auto-format on save recommended

**EditorConfig:**
- UTF-8 encoding
- LF line endings
- 2-space indentation
- Max line length: 80 (for readability)

### Commit Messages

From `.opencode/agent/git-committer.md`:
- Brief messages (used for release notes)
- Focus on WHY, not WHAT
- Prefix with type: `docs:`, `fix:`, `feat:`, etc.

---

## Common Tasks

### Adding a New Tool

1. Create `packages/opencode/src/tool/your-tool.ts`
2. Implement `Tool.Info` interface
3. Define Zod schema for input validation
4. Register in tool registry
5. Add tests in `test/tool/your-tool.test.ts`

```typescript
import { Tool } from "./tool"
import { z } from "zod"

export const YourTool = Tool.define({
  name: "YourTool",
  description: "What this tool does",
  input: z.object({
    param: z.string()
  }),
  execute: async (input, context) => {
    // Implementation
    return { success: true, data: result }
  }
})
```

### Adding a New Provider

1. Add to `packages/opencode/src/provider/`
2. Implement provider interface
3. Add transformation logic
4. Update provider registry
5. Add tests

### Adding LSP Support

1. Add language server config to `packages/opencode/src/lsp/`
2. Update language detection
3. Add to default LSP servers
4. Test with sample code

### Modifying the Server API

1. Edit `packages/opencode/src/server/server.ts`
2. Update route handlers
3. Run `./packages/sdk/js/script/build.ts` to regenerate SDK
4. Update client code to use new SDK
5. Update tests

### Creating Documentation

1. Add to `packages/web/src/content/docs/`
2. Follow docs agent guidelines (`.opencode/agent/docs.md`)
3. Keep title short (1-3 words)
4. Keep description concise (5-10 words)
5. Use imperative mood for sections
6. Prefix commit with `docs:`

---

## Project Configuration

### `.opencode/opencode.json`

Project-level settings:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-codex-auth"],
  "model": "claude-3-5-sonnet-20241022",
  "username": "developer"
}
```

### Workspace Configuration

**`package.json` (root):**
- Workspaces: `packages/*`, `packages/console/*`, `packages/sdk/js`, `packages/slack`
- Catalog feature for shared dependency versions
- Package manager: Bun 1.3.2

### Infrastructure

**SST Configuration (`sst.config.ts`):**
- Cloudflare as home platform
- Multi-stage: dev/production
- Configured in `/infra/`

---

## Debugging

### Development Server

```bash
cd packages/opencode
bun dev
```

### Logging

Use the Log namespace:
```typescript
import { Log } from "../log/log"

const log = Log.create({ service: "tool-name" })
log.info("message", { context })
```

### Common Issues

**Issue:** SDK out of sync with server
**Solution:** Run `./packages/sdk/js/script/build.ts`

**Issue:** Type errors after dependency update
**Solution:** Run `bun turbo typecheck` to identify issues

**Issue:** Tests failing
**Solution:** Ensure `Instance.provide()` is used for context, check fixtures

---

## Additional Resources

- **Contributing Guide:** `CONTRIBUTING.md`
- **Agent Guidelines:** `AGENTS.md`, `packages/opencode/AGENTS.md`
- **Documentation:** https://opencode.ai/docs
- **Discord:** https://opencode.ai/discord
- **GitHub:** https://github.com/sst/opencode

---

## Summary for AI Assistants

When working with OpenCode:

1. **Always** follow the code style conventions (no `else`, no `let`, no semicolons)
2. **Use** Bun APIs when available
3. **Validate** inputs with Zod schemas
4. **Test** your changes with `bun test`
5. **Type check** with `bun turbo typecheck`
6. **Regenerate SDK** after server changes
7. **Use** namespace-based organization
8. **Prefer** Result patterns over exceptions
9. **Keep** functions single-purpose
10. **Write** concise commit messages focused on WHY

This codebase values simplicity, type safety, and developer experience. When in doubt, check existing patterns in the codebase before introducing new ones.
