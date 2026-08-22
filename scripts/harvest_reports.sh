#!/usr/bin/env bash
# Gom báo cáo task từ mọi worktree agent về .superpowers/ của bản checkout chính.
#
# VÌ SAO CẦN: `.superpowers/` bị gitignore (quy tắc ở .gitignore GỐC — xem commit
# sửa nó), nên mỗi worktree có một bản RIÊNG.
# Agent ở worktree B không đọc được báo cáo viết trong worktree A — đúng thứ
# S2 Task 2 vấp phải: họ tưởng báo cáo Task 1 không tồn tại, trong khi nó nằm
# nguyên trong worktree của Task 1. Và xoá worktree là xoá luôn báo cáo trong đó.
#
# CHẠY: trước khi `git worktree remove`, và sau mỗi lần gộp một task.
set -euo pipefail
cd "$(dirname "$0")/.."
n=0
while IFS= read -r f; do
  rel="${f#*/.superpowers/}"
  dest=".superpowers/$rel"
  mkdir -p "$(dirname "$dest")"
  # Không ghi đè bản mới hơn bằng bản cũ hơn.
  if [ ! -e "$dest" ] || [ "$f" -nt "$dest" ]; then
    cp "$f" "$dest"; n=$((n+1)); echo "  ← ${f#.claude/worktrees/}"
  fi
done < <(find .claude/worktrees -path '*/.superpowers/*' -name '*.md' 2>/dev/null)
echo "harvest_reports: đã gom $n tệp."
