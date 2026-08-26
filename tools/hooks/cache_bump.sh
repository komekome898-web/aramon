#!/usr/bin/env bash
# Stop: 配信されるファイルを変えたのに sw.js の CACHE_NAME を上げていないと止める。
# CLAUDE.md 絶対ルール1。例外はドキュメントのみの変更(*.md / .claude/ / tools/ は対象外)。
set -u
cd "$(dirname "$0")/../.." || exit 0

payload=$(cat)
# Stop フックの再入(同じ理由で止め続ける)を避ける
[ "$(printf '%s' "$payload" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

changed=$(
  {
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } 2>/dev/null | grep -vE '^(tools/|\.claude/|\.gitignore$)|\.md$' | sort -u
)
[ -n "$changed" ] || exit 0

cur=$(grep -m1 "^const CACHE_NAME" sw.js 2>/dev/null)
old=$(git show HEAD:sw.js 2>/dev/null | grep -m1 "^const CACHE_NAME")
[ -n "$cur" ] || exit 0
[ "$cur" != "$old" ] && exit 0

{
  echo "sw.js の CACHE_NAME を上げていません(CLAUDE.md 絶対ルール1)。"
  echo "いまは $old のままです。1つ上げてください。"
  echo "変更したファイル:"
  printf '%s\n' "$changed" | sed 's/^/  /'
} >&2
exit 2
