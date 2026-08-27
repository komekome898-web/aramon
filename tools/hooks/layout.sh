#!/usr/bin/env bash
# Stop: レイアウトに関わるファイルを触っていたら、画面レイアウトの検査を通してから終わる。
# CLAUDE.md「触ったら node tools/layout_test.mjs を通す」。
#
# 3分かかる検査なので、同じ中身で二度は回さない(内容のハッシュを控えて突き合わせる)。
# playwright が無い環境では黙って飛ばす(検査そのものが動かせないだけで、コードの問題ではない)。
set -u
cd "$(dirname "$0")/../.." || exit 0

WATCH="style.css index.html ui.js"
CACHE=".claude/hooks-cache/layout.hash"

payload=$(cat)
[ "$(printf '%s' "$payload" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# 対象ファイルが HEAD から変わっていなければ何もしない
dirty=$(git diff --name-only HEAD -- $WATCH 2>/dev/null)
[ -n "$dirty" ] || exit 0

hash=$(cat $WATCH 2>/dev/null | sha1sum | cut -d' ' -f1)
[ -f "$CACHE" ] && [ "$(cat "$CACHE")" = "$hash" ] && exit 0

out=$(node tools/layout_test.mjs 2>&1)
status=$?

if [ $status -eq 0 ]; then
  mkdir -p "$(dirname "$CACHE")"
  printf '%s' "$hash" > "$CACHE"
  exit 0
fi

# playwright が無いだけなら止めない
if printf '%s' "$out" | grep -q 'playwrightが見つかりません'; then
  exit 0
fi

{
  echo "画面レイアウトの検査が落ちました(CLAUDE.md「触ったら layout_test を通す」)。"
  printf '%s\n' "$out" | tail -40
} >&2
exit 2
