# Orchestrator Tests

This directory contains tests for the autonomous agent supervision system.

## Test Types

### 1. Unit Tests (Fast, No LLM)
- `conversation-summary.test.ts` - Tests conversation analysis logic
- No external dependencies, runs instantly

```bash
bun test test/orchestrator/conversation-summary.test.ts
```

### 2. Integration Tests (Fast, No LLM)
- `integration-supervision.test.ts` - Tests event monitoring and supervision lifecycle
- Tests real event bus and session management
- No LLM calls, uses mocked todo/message updates

```bash
bun test test/orchestrator/integration-supervision.test.ts
```

### 3. Real LLM Tests (Slow, Requires API Keys)
- `real-supervision.test.ts` - Tests actual orchestrator with real LLM calls
- **IMPORTANT**: Requires valid LLM provider configuration

```bash
# Default: Uses Anthropic Claude
export ANTHROPIC_API_KEY="your-key-here"
bun test test/orchestrator/real-supervision.test.ts

# Or use custom provider
export TEST_PROVIDER_ID="lmstudio"
export TEST_MODEL_ID="glm-4.5-air@q4_k_m"
bun test test/orchestrator/real-supervision.test.ts
```

**What these tests do:**
- Test 1: Real orchestrator supervises real build agent creating files
  - Creates supervisor and build sessions
  - Monitors todo changes and message events in real-time
  - Verifies files are actually created
  - Timeout: 2 minutes

- Test 2: Real supervisor delegates to real build agent
  - Tests supervisor agent using Task tool to delegate
  - Verifies child session is created
  - Checks file creation
  - Timeout: 2 minutes

- Test 3: Real conversation continuation when agent stops early
  - Tests automatic continuation when agent stops without completing
  - Monitors for orchestrator feedback messages
  - Verifies task completion despite early stopping
  - Timeout: 90 seconds

## Running All Tests

```bash
# Fast tests only (no LLM)
bun test test/orchestrator/conversation-summary.test.ts test/orchestrator/integration-supervision.test.ts

# All tests including real LLM (requires API key)
export ANTHROPIC_API_KEY="your-key-here"
bun test test/orchestrator/
```

## Demo Scripts

For manual testing and demonstration:

```bash
# Basic delegation demo
bun run src/orchestrator/demo-delegation.ts

# Full system demo (requires server running)
bun dev  # In one terminal
bun run src/orchestrator/demo-full-system.ts  # In another terminal
```

## Test Configuration

### Provider Setup

The real tests use environment variables for provider configuration:

- `TEST_PROVIDER_ID` - Provider to use (default: "anthropic")
- `TEST_MODEL_ID` - Model to use (default: "claude-3-5-sonnet-20241022")

### LM Studio Setup

To use LM Studio for testing:

1. Start LM Studio server at `http://192.168.1.175:1234` (or your address)
2. Load a model (e.g., glm-4.5-air@q4_k_m)
3. Configure in `.opencode/opencode.json` (see SUPERVISION.md)
4. Set environment variables:

```bash
export TEST_PROVIDER_ID="lmstudio"
export TEST_MODEL_ID="glm-4.5-air@q4_k_m"
bun test test/orchestrator/real-supervision.test.ts
```

## Expected Results

### Unit Tests
- ✅ 11/11 tests should pass
- ⏱️ Runtime: < 100ms
- 📦 No external dependencies

### Integration Tests
- ✅ 8/8 tests should pass
- ⏱️ Runtime: ~1.7 seconds
- 📦 No LLM required

### Real LLM Tests
- ✅ 3/3 tests should pass (with valid API key)
- ⏱️ Runtime: 2-5 minutes depending on LLM speed
- 📦 Requires: Working LLM provider + API key
- 📁 Creates actual files in temp directories
- 🔄 Tests real event monitoring and supervision

## Troubleshooting

### Provider Not Found Error
```
ProviderModelNotFoundError: ProviderModelNotFoundError
```

**Solution**: Configure provider in `.opencode/opencode.json` or set environment variable:
```bash
export ANTHROPIC_API_KEY="your-key-here"
```

### Test Timeout
```
Test timed out after 120000ms
```

**Causes:**
- LLM is slow or unresponsive
- Agent got stuck in a loop
- Network issues

**Solutions:**
- Use faster model
- Check LLM server is running (for local models)
- Increase timeout in test file
- Check logs for orchestrator intervention messages

### Files Not Created
```
expect(fileExists).toBe(true) // Failed
```

**Causes:**
- Agent didn't understand task
- Agent completed but used wrong filename
- Supervision intervention failed

**Solutions:**
- Check test output for conversation logs
- Verify LLM is working correctly
- Check tmp directory manually: tests print the path
- Review orchestrator feedback messages

## Viewing Test Output

Real LLM tests include detailed console output:

```
📊 Test Results:
  Todo changes detected: 5
  Message events detected: 12
  Alpha file created: true
  Beta file created: true
  Alpha content: "First file"
  Beta content: "Second file"
```

This shows:
- How many todo update events were captured
- How many message events were monitored
- Whether files were created
- Actual file contents

## Development Workflow

1. **Make changes to orchestrator code**
2. **Run fast tests first**:
   ```bash
   bun test test/orchestrator/conversation-summary.test.ts test/orchestrator/integration-supervision.test.ts
   ```
3. **If fast tests pass, run real LLM tests**:
   ```bash
   export ANTHROPIC_API_KEY="sk-..."
   bun test test/orchestrator/real-supervision.test.ts
   ```
4. **Verify in production with demo scripts**

## CI/CD Notes

For CI/CD pipelines:

- ✅ Run unit and integration tests always (fast, no API keys needed)
- ⚠️ Skip real LLM tests unless API keys are available
- 💡 Use environment variables to enable real tests conditionally:

```yaml
# Example GitHub Actions
- name: Run Fast Tests
  run: bun test test/orchestrator/conversation-summary.test.ts test/orchestrator/integration-supervision.test.ts

- name: Run Real LLM Tests
  if: ${{ secrets.ANTHROPIC_API_KEY }}
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: bun test test/orchestrator/real-supervision.test.ts
```
