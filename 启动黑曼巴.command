#!/bin/zsh
setopt NO_BG_NICE
cd "$(dirname "$0")" || exit 1
NODE="$(command -v node)"
if [[ -z "$NODE" ]]; then
  echo '未找到 Node.js 24 或更新版本，请先安装 Node.js。'
  read '?按回车关闭'
  exit 1
fi
if /usr/bin/curl -fsS http://127.0.0.1:18771/health 2>/dev/null | /usr/bin/grep -q 'blackmamba-local'; then
  /usr/bin/open 'http://127.0.0.1:18771/'
  exit 0
fi
"$NODE" scripts/build-local.mjs || exit 1
mkdir -p data
export MAMBA_NODE="$NODE"
/usr/bin/python3 - <<'PY'
import subprocess
from pathlib import Path
with open('data/server.log', 'ab') as log:
    process = subprocess.Popen([__import__('os').environ['MAMBA_NODE'], 'server.mjs'], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
Path('data/server.pid').write_text(str(process.pid))
PY
for i in {1..40}; do
  if /usr/bin/curl -fsS http://127.0.0.1:18771/health 2>/dev/null | /usr/bin/grep -q 'blackmamba-local'; then
    /usr/bin/open 'http://127.0.0.1:18771/'
    exit 0
  fi
  sleep .25
done
echo '启动失败，请检查 blackmamba-workbench/data/server.log。'
read '?按回车关闭'
