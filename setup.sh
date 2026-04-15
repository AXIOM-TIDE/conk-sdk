#!/bin/bash
# CONK SDK — GitHub Setup
# Run this from ~/Desktop/conk-sdk after downloading the zip
# Requires: git, GitHub CLI (gh), Node 18+

set -e

echo "=== CONK SDK — GitHub Setup ==="
echo ""

# 1. Init git
git init
git add .
git commit -m "feat: initial SDK scaffold — Harbor, Vessel, Cast, Receipt, Attachments"

# 2. Create GitHub repo (requires gh auth login first)
gh repo create AXIOM-TIDE/conk-sdk \
  --public \
  --description "Anonymous micropayment and communication SDK for the CONK protocol on Sui" \
  --homepage "https://conk.app" \
  --push \
  --source .

echo ""
echo "=== Repo live at: https://github.com/AXIOM-TIDE/conk-sdk ==="
echo ""

# 3. Install dependencies
npm install

echo ""
echo "=== Next steps ==="
echo ""
echo "  1. Run tests:         npm test"
echo "  2. Build:             npm run build"
echo "  3. Wire zkLogin:      open src/ConkClient.ts → search TODO"
echo "  4. Verify Move calls: diff against apps/conk/src/sui/client.ts"
echo "  5. Register npm org:  npmjs.com/org/create → @axiomtide"
echo "  6. Publish:           npm publish --access public"
echo ""
