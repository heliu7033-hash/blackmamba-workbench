#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Dedicated, disposable build output. Never package the user's installed application.
output="$PWD/build/mac-share"
rm -rf "$output"
mkdir -p "$output/stage"
node_bin="${MAMBA_NODE_BINARY:-$(command -v node)}"
node_version=$("$node_bin" -p 'process.version')
"$node_bin" -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
lipo -verify_arch arm64 "$node_bin"
lipo -verify_arch x86_64 "$node_bin"
codesign --verify --strict "$node_bin"
bash desktop/build.sh "$output/stage"
bundle="$output/stage/黑曼巴工作台.app"
resources="$bundle/Contents/Resources"
for arch in arm64 x86_64; do
    xcrun swiftc -swift-version 5 -O -target "$arch-apple-macos13.0" -module-cache-path "${TMPDIR:-/tmp}/mamba-swift-modules" desktop/main.swift desktop/DesktopRing.swift -o "$output/Mamba-$arch"
done
lipo -create "$output/Mamba-arm64" "$output/Mamba-x86_64" -output "$bundle/Contents/MacOS/Mamba"
mkdir -p "$resources/runtime"
cp "$node_bin" "$resources/runtime/node"
curl --fail --location --retry 3 --connect-timeout 15 --max-time 60 "https://raw.githubusercontent.com/nodejs/node/$node_version/LICENSE" -o "$resources/runtime/NODE-LICENSE.txt"
cp LICENSE "$resources/LICENSE.txt"
printf '{"portable":"true"}\n' > "$resources/runtime.json"
# Regenerate browser assets without any local covers, documents, database or credentials.
"$node_bin" --input-type=module - "$resources" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import {readWebAssets} from './scripts/web-assets.mjs';
const assets={...readWebAssets(),'/cover-index.json':{type:'application/json',body:'{}'}};
fs.writeFileSync(path.join(process.argv[2],'local-dist/worker.mjs'),'const ASSETS='+JSON.stringify(assets)+';\n'+fs.readFileSync('worker/index.js','utf8'));
JS
version=$("$node_bin" -p 'JSON.parse(require("fs").readFileSync("package.json")).version')
plutil -replace CFBundleShortVersionString -string "$version" "$bundle/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$version" "$bundle/Contents/Info.plist"
plutil -insert LSMinimumSystemVersion -string 13.0 "$bundle/Contents/Info.plist"
# Preserve the Node Foundation signature; seal only the outer application ad hoc.
codesign --force --sign - "$bundle"
codesign --verify --deep --strict "$bundle"
ln -s /Applications "$output/stage/Applications"
cat > "$output/stage/安装说明.txt" <<'TXT'
黑曼巴工作台 Mac 测试版

适用于 macOS 13 或更高版本，Apple 芯片与 Intel Mac。
将「黑曼巴工作台.app」拖入「Applications」，再从应用程序启动。
自带 Node 运行时；首次打开为空项目库，不包含任何客户资料或账号。
测试版未获得 Apple 开发者签名和公证，可能需要在系统设置「隐私与安全性」允许打开。
Codex、FFmpeg、达芬奇等按需自行安装和登录；基础工作流无需另外安装 Node。
数据保存在当前用户的 Library/Application Support/Black Mamba Workbench，项目记录也存于应用 WebKit 存储。
卸载应用不自动删除项目数据。项目 JSON 导出不包含媒体文件。
请不要同时启动多份工作台；它们使用相同的本机端口。
TXT
hdiutil create -volname '黑曼巴工作台' -srcfolder "$output/stage" -ov -format UDZO "$output/Black-Mamba-Workbench-mac-universal.dmg"
shasum -a 256 "$output/Black-Mamba-Workbench-mac-universal.dmg" > "$output/SHA256SUMS-mac.txt"
echo "Ready: $output/Black-Mamba-Workbench-mac-universal.dmg"
