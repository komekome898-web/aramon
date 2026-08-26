#!/usr/bin/env bash
# PostToolUse(Write|Edit): data.js を触ったら更新履歴の検査を回す。
# CLAUDE.md 絶対ルール6「書いたら node tools/changelog_check.mjs を通す」。
#   エラー → exit 2(直すまで進ませない)
#   注意   → additionalContext でモデルへ渡すだけ(人が見て判断する類なので止めない)
set -u
cd "$(dirname "$0")/../.." || exit 0

payload=$(cat)
f=$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty')

case "$f" in
  */data.js|data.js) ;;
  *) exit 0 ;;
esac

if ! out=$(node tools/changelog_check.mjs 2>&1); then
  printf '更新履歴(UPDATE_HISTORY)の検査が落ちました。\n%s\n' "$out" >&2
  exit 2
fi

if printf '%s' "$out" | grep -q '⚠ 注意'; then
  printf '%s' "$out" | jq -Rs '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("更新履歴の検査から注意が出ています(人が見て判断する)。\n" + .)
    }
  }'
fi
exit 0
