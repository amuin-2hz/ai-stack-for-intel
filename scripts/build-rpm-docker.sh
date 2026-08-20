#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE_NAME="amuin-ai-stack-rpm-builder:fedora44"

printf '%s\n' "=== Preparing Fedora RPM builder ==="
docker build \
  --tag "$IMAGE_NAME" \
  --file packaging/rpm/Dockerfile \
  packaging/rpm

printf '%s\n' "=== Building RPM in Fedora ==="
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env AI_STACK_SKIP_BUILD=1 \
  --volume "$PWD:/workspace" \
  --workdir /workspace \
  "$IMAGE_NAME"
