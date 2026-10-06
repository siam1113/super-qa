#!/bin/bash

# Script to kill node processes related to ts-node-dev running src/main.ts
# This is useful when multiple instances accumulate and consume high CPU

echo "🔍 Checking for running ts-node-dev processes..."

# Find all node processes running src/main.ts
PIDS=$(ps aux | grep -i "node.*ts-node-dev/lib/wrap.js src/main.ts" | grep -v grep | awk '{print $2}')

if [ -z "$PIDS" ]; then
    echo "✅ No ts-node-dev processes found running src/main.ts"
    exit 0
fi

# Count the processes
COUNT=$(echo "$PIDS" | wc -l | xargs)
echo "Found $COUNT process(es) to kill:"

# Display the processes
ps aux | grep -i "node.*ts-node-dev/lib/wrap.js src/main.ts" | grep -v grep | awk '{printf "  PID: %s | CPU: %s%% | MEM: %s%%\n", $2, $3, $4}'

echo ""
read -p "Do you want to kill these processes? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🔪 Killing processes..."
    echo "$PIDS" | xargs kill -9

    # Wait a moment and verify
    sleep 1
    REMAINING=$(ps aux | grep -i "node.*ts-node-dev/lib/wrap.js src/main.ts" | grep -v grep | wc -l | xargs)

    if [ "$REMAINING" -eq 0 ]; then
        echo "✅ All processes killed successfully"
    else
        echo "⚠️  Warning: $REMAINING process(es) still running"
    fi
else
    echo "❌ Operation cancelled"
    exit 1
fi
