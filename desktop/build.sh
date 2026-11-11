#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/build-local.mjs
bundle="${1:-build}/黑曼巴工作台.app"
data_dir="$PWD/data"
if [[ ${2:-} == --preview ]]; then
    bundle="${1:?preview output folder required}/黑曼巴圆环预览.app"
    data_dir="$PWD/$1/preview-data"
    [[ $1 != /* ]] || data_dir="$1/preview-data"
fi
app="$bundle/Contents"
mkdir -p "$app/MacOS" "$app/Resources/local-dist" "$app/Resources/drizzle"
xcrun swiftc -swift-version 5 -O -module-cache-path "${TMPDIR:-/tmp}/mamba-swift-modules" desktop/main.swift desktop/DesktopRing.swift -o "$app/MacOS/Mamba"
mkdir -p "$app/Resources/mcp"
cp mcp/tasks.mjs "$app/Resources/mcp/"
install -m 755 desktop/mamba-mcp "$app/Resources/mcp/mamba-mcp"
python3 scripts/generate-public-icon.py
cp build/assets/BrandMark.png "$app/Resources/"
cp desktop/Info.plist "$app/"
if [[ ${2:-} == --preview ]]; then
    plutil -replace CFBundleIdentifier -string studio.blackmamba.workbench.ring-preview "$app/Info.plist"
    plutil -replace CFBundleName -string 黑曼巴圆环预览 "$app/Info.plist"
fi
mkdir -p "$app/Resources/skills/studio-storyboards/scripts"
cp skills/studio-storyboards/SKILL.md "$app/Resources/skills/studio-storyboards/"
cp skills/studio-storyboards/scripts/* "$app/Resources/skills/studio-storyboards/scripts/"
mkdir -p "$app/Resources/scripts"
cp scripts/resolve-media.py "$app/Resources/scripts/"
cp production-materials.mjs creative-chat.mjs creative-providers.mjs server.mjs media-library.mjs storyboards.mjs skills-inventory.mjs local-library.mjs "$app/Resources/"
cp local-dist/worker.mjs "$app/Resources/local-dist/"
cp drizzle/0000_groovy_starjammers.sql "$app/Resources/drizzle/"
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({node:process.execPath, data:require("path").resolve(process.argv[2])}))' "$app/Resources/runtime.json" "$data_dir"
codesign --force --sign - "$bundle"
echo "已构建：$bundle"
