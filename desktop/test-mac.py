"""Run after npm run build:mac. Uses real Mac windows and an isolated database."""
from pathlib import Path
import json
import os
import sys
import socket
import sqlite3
import subprocess
import tempfile
import time

root = Path(__file__).resolve().parents[1]
bundle = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / "build/黑曼巴工作台.app"
binary = bundle / "Contents/MacOS/Mamba"
with tempfile.TemporaryDirectory(prefix="mamba-desktop-") as directory:
    folder = Path(directory) / "local-library"
    folder.mkdir()
    (folder / "original.md").write_text("本地原文验收")
    (folder / "open.json").write_text(json.dumps({"root": str(folder), "paths": {"doc-test": "original.md"}}))
    database = Path(directory) / "tasks.sqlite"
    with sqlite3.connect(database) as db:
        db.executescript((root / "drizzle/0000_groovy_starjammers.sql").read_text())
        db.execute("INSERT INTO tasks(id, owner, project, name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)",
                   ("desktop-fixture", "local-owner", "日常管理", "隔离验收"))
        original = db.execute("SELECT * FROM tasks").fetchall()
    for _ in range(2):
        # TCP TIME_WAIT after a WebKit request does not indicate a listener.
        with socket.socket() as probe:
            assert probe.connect_ex(("127.0.0.1", 18773)) != 0, "test port already in use"
        subprocess.run([str(binary), "--ui-check"], check=True, timeout=30,
                       env={**os.environ, "MAMBA_TEST_DIR": directory})
        for _ in range(40):
            with socket.socket() as probe:
                if probe.connect_ex(("127.0.0.1", 18773)) != 0:
                    break
            time.sleep(0.05)
        else:
            raise AssertionError("owned local server still listening after app quit")
        with sqlite3.connect(database) as db:
            assert db.execute("SELECT * FROM tasks").fetchall() == original
print("PASS: both desktop launches preserved the existing SQLite fixture")
