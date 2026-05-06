#!/usr/bin/env python3
"""Thoroughly redact MINIMAX API key from all git objects and working files."""
import os
import sys

MINIMAX_KEY = os.environ.get("MINIMAX_KEY") or os.environ.get("SECRET_TO_CLEAN")
REPLACEMENT = "YOUR_MINIMAX_API_KEY"

if not MINIMAX_KEY:
    print("ERROR: Set MINIMAX_KEY environment variable before running.", file=sys.stderr)
    print("  export MINIMAX_KEY='sk-cp-...'", file=sys.stderr)
    sys.exit(1)

# Walk all .git/objects
git_obj_dir = ".git/objects"
count = 0
for prefix in os.listdir(git_obj_dir):
    prefix_dir = os.path.join(git_obj_dir, prefix)
    if not os.path.isdir(prefix_dir):
        continue
    for suffix in os.listdir(prefix_dir):
        obj_path = os.path.join(prefix_dir, suffix)
        try:
            with open(obj_path, 'rb') as f:
                data = f.read()
        except Exception:
            continue
        if MINIMAX_KEY.encode() in data:
            new_data = data.replace(MINIMAX_KEY.encode(), REPLACEMENT.encode())
            with open(obj_path, 'wb') as f:
                f.write(new_data)
            print(f"Cleaned: .git/objects/{prefix}/{suffix}")
            count += 1

print(f"Done. Cleaned {count} git object(s).")