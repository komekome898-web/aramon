#!/usr/bin/env bash
# PostToolUse(Write|Edit): 書き換えた .js を node --check にかける。
# CLAUDE.md「こちらは node --check <file> の構文チェックまで」を自動で行う。
# 落ちたら exit 2 で、その場でモデルへエラー本文を返す。
set -u
cd "$(dirname "$0")/../.." || exit 0

payload=$(cat)
f=$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')

case "$f" in
  *.js|*.mjs) ;;
  *) exit 0 ;;
esac
[ -f "$f" ] || exit 0

if ! out=$(node --check "$f" 2>&1); then
  printf '%s の構文が壊れています。直してください。\n%s\n' "$f" "$out" >&2
  exit 2
fi
exit 0
