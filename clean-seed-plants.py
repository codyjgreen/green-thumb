#!/usr/bin/env python3
"""Replace MINIMAX API key with placeholder in all source files."""
import os
import sys

MINIMAX_KEY = os.environ.get("MINIMAX_KEY") or os.environ.get("SECRET_TO_CLEAN")
MINIMAX_KEY_B64 = os.environ.get("MINIMAX_KEY_B64")

REPLACEMENT = "YOUR_MINIMAX_API_KEY"
B64_REPLACEMENT = "YOUR_MINIMAX_API_KEY_BASE64"

if not MINIMAX_KEY:
    print("ERROR: Set MINIMAX_KEY environment variable before running.", file=sys.stderr)
    print("  export MINIMAX_KEY='sk-cp-...'", file=sys.stderr)
    sys.exit(1)

replacements = [(MINIMAX_KEY.encode(), REPLACEMENT.encode())]
if MINIMAX_KEY_B64:
    replacements.append((MINIMAX_KEY_B64.encode(), B64_REPLACEMENT.encode()))

for dirpath, dirnames, filenames in os.walk("."):
    if ".git" in dirpath or "node_modules" in dirpath:
        continue
    for filename in filenames:
        if filename.endswith((".ts", ".js", ".json", ".md", ".txt", ".env")):
            filepath = os.path.join(dirpath, filename)
            try:
                with open(filepath, "rb") as f:
                    data = f.read()
            except Exception:
                continue

            new_data = data
            replaced_count = 0
            for old, new in replacements:
                if old in new_data:
                    new_data = new_data.replace(old, new)
                    replaced_count += 1

            if replaced_count > 0:
                print(f"Cleaning ({replaced_count}x): {filepath}")
                with open(filepath, "wb") as f:
                    f.write(new_data)

print("Done.")