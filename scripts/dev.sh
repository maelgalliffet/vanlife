#!/usr/bin/env bash
set -euo pipefail

free_port() {
  local port="$1"

  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
    return
  fi

  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti tcp:"$port" || true)"
    if [[ -n "$pids" ]]; then
      kill $pids 2>/dev/null || true
    fi
  fi
}

cleanup() {
  if [[ -n "${API_PID:-}" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi

  if [[ -n "${WEB_PID:-}" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

free_port 4000
free_port 5173

npm run dev -w apps/api &
API_PID=$!

npm run dev -w apps/web -- --host 0.0.0.0 &
WEB_PID=$!

wait "$API_PID" "$WEB_PID"
