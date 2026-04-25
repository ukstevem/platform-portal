#!/usr/bin/env bash
# Bootstrap a new PSS standalone app folder under C:\Dev\PSS\.
#
# Prompts for a folder name (e.g. pss-<appname>), creates the directory,
# copies the scaffolding doc + .claude/CLAUDE.md so Claude auto-loads
# instructions, runs bd init, opens VS Code in the new folder, and
# launches a Claude Code chat pre-filled with a scaffolding prompt.
#
# Run from anywhere — paths are absolute.

set -euo pipefail

# ── Configuration ──
ROOT_DIR="/c/Dev/PSS"
SCAFFOLD_DOC="/c/Dev/PSS/platform-portal/docs/NEW_STANDALONE_APP.md"
PROMPT_TEXT='Read NEW_STANDALONE_APP.md and scaffold this PSS standalone app following its templates and conventions. This project uses beads (bd) for task tracking — run `bd prime` first.'

# ── Sanity checks ──
[ -f "$SCAFFOLD_DOC" ] || { echo "ERROR: missing $SCAFFOLD_DOC" >&2; exit 1; }
[ -d "$ROOT_DIR" ]    || { echo "ERROR: missing $ROOT_DIR"    >&2; exit 1; }

command -v bd   >/dev/null 2>&1 || { echo "ERROR: 'bd' (beads) not on PATH"   >&2; exit 1; }
command -v code >/dev/null 2>&1 || { echo "ERROR: 'code' (VS Code) not on PATH" >&2; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "ERROR: 'git' not on PATH"            >&2; exit 1; }

# ── Prompt ──
echo "==============================================="
echo " New PSS standalone app — bootstrap"
echo "==============================================="
echo
echo "Convention: name should start with 'pss-' (e.g. pss-laser-cutter)."
read -rp "Folder name: " NAME

[[ -n "$NAME" ]]              || { echo "ERROR: name cannot be empty" >&2; exit 1; }
[[ "$NAME" =~ ^[a-z0-9-]+$ ]] || { echo "ERROR: name must be lowercase letters, digits, or hyphens" >&2; exit 1; }
[[ "$NAME" == pss-* ]]        || { echo "ERROR: name must start with 'pss-' (got '$NAME')" >&2; exit 1; }

NEW_DIR="$ROOT_DIR/$NAME"
APPNAME="${NAME#pss-}"   # the bare app name, e.g. laser-cutter

[ -e "$NEW_DIR" ] && { echo "ERROR: $NEW_DIR already exists" >&2; exit 1; }

# ── Create folder ──
echo
echo "Creating $NEW_DIR ..."
mkdir -p "$NEW_DIR"
mkdir -p "$NEW_DIR/.claude"

# ── Copy scaffolding doc ──
cp "$SCAFFOLD_DOC" "$NEW_DIR/NEW_STANDALONE_APP.md"
echo "  copied NEW_STANDALONE_APP.md"

# ── Write .claude/CLAUDE.md so Claude auto-reads it on session start ──
cat > "$NEW_DIR/.claude/CLAUDE.md" <<EOF
# AI assistant — read me first

You are working on **$NAME**, a new PSS standalone app being scaffolded
from the template at \`NEW_STANDALONE_APP.md\` (in this repo's root).

## First steps every session
1. Run \`bd prime\` — this project uses **beads (bd)** for task tracking.
2. Read \`NEW_STANDALONE_APP.md\` end-to-end. It contains every file
   template you need (Dockerfile, docker-compose.app.yml,
   next.config.ts, .dockerignore, build.sh, etc.) plus the architecture
   invariants you must not break (port, service name, basePath,
   platform_net, canonical .env, .dockerignore).
3. The bare app name is **\`$APPNAME\`** (used as the basePath route and
   the docker service name). Reserve a port in
   \`../platform-portal/docs/PORTS.md\` before scaffolding.

## Tooling rules
- Use \`bd create\` / \`bd update --claim\` / \`bd close\` for task tracking.
  Do NOT use TodoWrite or markdown TODO lists.
- Use \`bd remember\` for persistent insights. Do NOT use MEMORY.md files.
- Session close protocol: \`git status\` → \`git add\` → \`git commit\` →
  \`git push\`. Work isn't done until pushed.

## Reference apps
Mirror the patterns in \`../pss-matl-cert/\` and \`../pss-assembly-viewer/\`
when in doubt.
EOF
echo "  wrote .claude/CLAUDE.md"

# ── Init git + beads ──
echo
echo "Initialising git ..."
( cd "$NEW_DIR" && git init -b main >/dev/null )
echo "Initialising beads ..."
( cd "$NEW_DIR" && bd init >/dev/null 2>&1 || bd init )

# ── Seed bd with starter tasks ──
( cd "$NEW_DIR" && {
  bd create --title="Reserve port and service name in platform-portal/docs/PORTS.md" \
            --description="Pick the next free port (3xxx) and service name '$APPNAME'. Edit ../platform-portal/docs/PORTS.md, commit, push. Required before any other scaffolding." \
            --type=task --priority=1 >/dev/null

  bd create --title="Scaffold app/ from NEW_STANDALONE_APP.md templates" \
            --description="Use the file templates in NEW_STANDALONE_APP.md to create app/package.json, app/next.config.ts, app/Dockerfile, app/.dockerignore (mandatory), docker-compose.app.yml, build.sh, .env.example, .gitignore. Substitute <appname>=$APPNAME and <NNNN>=<reserved port>." \
            --type=task --priority=1 >/dev/null

  bd create --title="Copy and freeze shared packages (ui, auth, supabase)" \
            --description="cp -r ../platform-portal/packages/{ui,auth,supabase} app/packages/. Then edit each app/packages/*/package.json to remove workspace:* deps (keep peerDependencies and real npm deps only). Inter-package imports resolve via the app's own node_modules root." \
            --type=task --priority=2 >/dev/null

  bd create --title="Wire route into platform-portal nginx production.conf" \
            --description="Add location /$APPNAME/ block to platform-portal/docker/nginx/production.conf pointing at http://$APPNAME:<NNNN>. Rebuild and push the gateway image. See NEW_STANDALONE_APP.md 'Wiring into the gateway'." \
            --type=task --priority=2 >/dev/null

  bd create --title="Create GitHub repo ukstevem/$NAME and push initial commit" \
            --description="Create a public/private repo at https://github.com/new (do NOT init with README/license/.gitignore). Then: git remote add origin <url>; git add .; git commit -m 'initial scaffold'; git push -u origin main." \
            --type=task --priority=2 >/dev/null

  bd create --title="First build + push to ghcr.io" \
            --description="chmod +x build.sh && ./build.sh — builds ARM64 image and pushes to ghcr.io/ukstevem/$NAME with both :<sha> and :latest tags. Requires ../platform-portal/.env to exist (sibling layout)." \
            --type=task --priority=2 >/dev/null

  bd create --title="First deploy on the Pi" \
            --description="ssh pi@10.0.0.75; create /opt/$NAME; git clone; docker compose -f docker-compose.app.yml up -d. Test at http://10.0.0.75:3000/$APPNAME/ (via gateway)." \
            --type=task --priority=2 >/dev/null

  bd remember "Bootstrapped $NAME on $(date +%Y-%m-%d) via platform-portal/scripts/new-app.sh. App name: $APPNAME. Convention: port reservation in platform-portal/docs/PORTS.md is done before any other work."
} >/dev/null 2>&1 || echo "  (warning: some bd seed commands failed — check manually with 'bd ready')" )

echo "  seeded 7 starter issues + 1 memory"

# ── Open VS Code ──
echo
echo "Opening VS Code ..."
code -n "$NEW_DIR" "$NEW_DIR/NEW_STANDALONE_APP.md"

# Give VS Code a moment to attach before launching the chat
sleep 2

# ── Launch Claude Code chat with pre-filled prompt ──
# Pure-bash URL encoding (no python dependency)
url_encode() {
  local s="$1" out="" c
  local i len=${#s}
  for (( i=0; i<len; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [-_.~a-zA-Z0-9]) out+="$c" ;;
      *)               printf -v c '%%%02X' "'$c"; out+="$c" ;;
    esac
  done
  printf '%s' "$out"
}

encoded_prompt=$(url_encode "$PROMPT_TEXT")
CHAT_URL="vscode://anthropic.claude-code/open?prompt=$encoded_prompt"

# cmd //c is the Git Bash incantation for Windows 'start'
if cmd //c start "" "$CHAT_URL" 2>/dev/null; then
  echo "Claude Code chat launched (prompt pre-filled — hit Enter to submit)"
else
  echo "  (couldn't auto-launch chat — open Claude manually; .claude/CLAUDE.md will brief it)"
fi

echo
echo "==============================================="
echo " Done. Next: in the VS Code window, hit Enter on"
echo " the Claude chat (prompt is pre-filled), or open"
echo " Claude manually — .claude/CLAUDE.md will brief"
echo " the assistant either way."
echo "==============================================="
