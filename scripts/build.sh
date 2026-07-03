#!/usr/bin/env bash
# LocalRuntime — Production Build Script
# Compiles API, Frontend, and Electron main process.
# set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

echo "══════════════════════════════════════════"
echo "  LocalRuntime Build"
echo "══════════════════════════════════════════"

# 1. Install deps if needed
if [ ! -d "src/api/node_modules" ]; then
  echo "[1/4] Installing API dependencies..."
  cd src/api && npm install && cd ../..
fi
if [ ! -d "src/frontend/node_modules" ]; then
  echo "[1/4] Installing Frontend dependencies..."
  cd src/frontend && npm install && cd ../..
fi

# 2. Build API (TypeScript → dist/)
echo "[2/4] Building API..."
cd src/api && npx tsc -p tsconfig.json && cd ../..
echo "  ✅ src/api/dist/ ready"

# 3. Build Frontend (Vite → dist/)
echo "[3/4] Building Frontend..."
cd src/frontend && npm run build && cd ../..
echo "  ✅ src/frontend/dist/ ready"

# 4. Build Electron main process
echo "[4/4] Building Electron main..."
npx tsc -p src/main/tsconfig.json 2>/dev/null || \
  ./src/api/node_modules/.bin/tsc -p src/main/tsconfig.json
echo "  ✅ src/main/dist/ ready"

echo ""
echo "══════════════════════════════════════════"
echo "  Build Complete"
echo "══════════════════════════════════════════"
echo ""
echo "  Run web mode:   ./scripts/dev-web.sh"
echo "  Run Electron:   ./scripts/dev-electron.sh"
echo ""
echo "  For Electron dev (with display):"
echo "    ELECTRON_SKIP_BINARY_DOWNLOAD=0 npm install electron"
echo "    ./scripts/dev-electron.sh"
echo ""
echo "  Package:        npm run dist  (after electron binary installed)"
echo ""
