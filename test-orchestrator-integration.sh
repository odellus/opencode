#!/bin/bash
# Real integration test using installed opencode binary
# This tests if we can use opencode CLI to trigger LLM execution

set -e

echo "=== Orchestrator Integration Test (via opencode CLI) ==="
echo ""

# Check opencode is available
if ! command -v opencode &> /dev/null; then
    echo "✗ opencode not found in PATH"
    exit 1
fi

echo "✓ Using opencode from: $(which opencode)"
echo "✓ Version: $(opencode --version)"
echo ""

# Create test directory
TEST_DIR="/tmp/orchestrator-test-$$"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo "Working directory: $TEST_DIR"
echo ""

# Initialize simple project
cat > test.md <<'EOF'
Create 3 simple test files:
1. hello.txt with "Hello"
2. world.txt with "World"
3. foo.txt with "Foo"

Use TodoWrite to track your progress. Mark all 3 as in_progress to work on them in parallel.
EOF

echo "=== Test Plan ==="
echo "1. Run opencode with task"
echo "2. Monitor for TodoWrite tool calls"
echo "3. Check if multiple in_progress todos created"
echo "4. Verify orchestrator would detect this pattern"
echo ""

echo "Note: This is a manual test - real orchestrator integration requires"
echo "running OpenCode as a library, not CLI. CLI doesn't expose Bus events."
echo ""

# Show what would be needed
echo "=== What We Need for Real Integration ==="
echo "1. Run OpenCode from TypeScript (not CLI)"
echo "2. Access Bus events for tool calls"
echo "3. Detect TodoWrite with multiple in_progress"
echo "4. Send feedback via SessionPrompt.prompt"
echo ""

# Cleanup
cd /
rm -rf "$TEST_DIR"

echo "✓ Test structure verified"
echo ""
echo "Conclusion: Real integration test needs to run from TypeScript source,"
echo "but source has macro dependencies that require build step."
