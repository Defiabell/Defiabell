#!/usr/bin/env python3
"""Poem of the day for the README caption. Falls back to the last poem if the API is unreachable."""
from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
STATE = ROOT / "assets" / "poem.json"
DATE_FILE = ROOT / "assets" / "ink-date.txt"


def fetch_poem() -> dict | None:
    try:
        req = urllib.request.Request("https://v1.jinrishici.com/all.json", headers={"User-Agent": "profile-poem"})
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.load(r)
        if d.get("content") and d.get("author"):
            return {"content": d["content"].strip(), "author": d["author"].strip(), "origin": d.get("origin", "").strip()}
    except Exception as e:  # noqa: BLE001 - any failure means "keep yesterday's poem"
        print(f"poem api unavailable: {e}")
    return None


def main() -> None:
    poem = fetch_poem()
    if poem:
        STATE.write_text(json.dumps(poem, ensure_ascii=False, indent=2) + "\n")
    elif STATE.exists():
        poem = json.loads(STATE.read_text())
    else:
        poem = {"content": "灯火纸窗修竹里，读书声。", "author": "陈继儒"}
    date = DATE_FILE.read_text().strip() if DATE_FILE.exists() else ""
    caption = (
        f"今日山色 · {date} · a new ink landscape every morning, seeded by the date"
        f" &nbsp;·&nbsp; 「{poem['content']}」 {poem['author']}"
    )
    text = README.read_text()
    new = re.sub(r"(<!-- CAPTION:START -->).*?(<!-- CAPTION:END -->)", lambda m: m.group(1) + caption + m.group(2), text, flags=re.S)
    if new != text:
        README.write_text(new)
        print("caption updated:", caption)
    else:
        print("caption unchanged")


if __name__ == "__main__":
    main()
