#!/usr/bin/env python3
"""Self-drawn GitHub stats + streak cards (light and dark), no third-party card services.

Reads public data from the GitHub GraphQL API with GITHUB_TOKEN and writes:
  assets/stats.svg, assets/stats-dark.svg, assets/streak.svg, assets/streak-dark.svg
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.request
from pathlib import Path

LOGIN = os.environ.get("GH_LOGIN", "Defiabell")
TOKEN = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
ASSETS = Path(__file__).resolve().parent.parent / "assets"
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif"
MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

THEMES = {
    "": dict(bg="#ffffff", border="#d1d9e0", ink="#1f2328", muted="#59636e", accent="#c1432b", track="#eaeef2"),
    "-dark": dict(bg="#0d1117", border="#30363d", ink="#e6edf3", muted="#8b949e", accent="#d8574b", track="#21262d"),
}

QUERY = """
query($login:String!){ user(login:$login){
  pullRequests{ totalCount }
  repositoriesContributedTo(first:1, contributionTypes:[COMMIT,PULL_REQUEST,ISSUE,REPOSITORY,PULL_REQUEST_REVIEW]){ totalCount }
  repositories(ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC, first:100){
    totalCount nodes{ languages(first:6, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name color } } } } }
  contributionsCollection{
    totalCommitContributions
    contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } } }
}}"""


def fetch() -> dict:
    if not TOKEN:
        sys.exit("GITHUB_TOKEN is required (public read is enough)")
    body = json.dumps({"query": QUERY, "variables": {"login": LOGIN}}).encode()
    req = urllib.request.Request(
        "https://api.github.com/graphql", data=body,
        headers={"Authorization": f"bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "profile-cards"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    if "errors" in data:
        sys.exit(f"GraphQL errors: {data['errors']}")
    return data["data"]["user"]


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def stats_svg(u: dict, t: dict) -> str:
    W, H = 495, 195
    cal = u["contributionsCollection"]["contributionCalendar"]
    weeks = [sum(d["contributionCount"] for d in w["contributionDays"]) for w in cal["weeks"]]
    # languages across public, non-fork repos, weighted by bytes
    sizes: dict[str, int] = {}
    colors: dict[str, str] = {}
    for repo in u["repositories"]["nodes"]:
        for e in repo["languages"]["edges"]:
            n = e["node"]["name"]
            sizes[n] = sizes.get(n, 0) + e["size"]
            colors[n] = e["node"]["color"] or "#8b949e"
    total = sum(sizes.values()) or 1
    top = sorted(sizes.items(), key=lambda kv: -kv[1])[:4]
    rows = [
        ("Commits · past year", u["contributionsCollection"]["totalCommitContributions"]),
        ("Pull requests", u["pullRequests"]["totalCount"]),
        ("Repos contributed to", u["repositoriesContributedTo"]["totalCount"]),
        ("Public repos", u["repositories"]["totalCount"]),
    ]
    rows_svg = "".join(
        f'<text x="24" y="{78 + i * 26}" class="k">{esc(k)}</text>'
        f'<text x="220" y="{78 + i * 26}" class="v" text-anchor="end">{v}</text>'
        for i, (k, v) in enumerate(rows)
    )
    # sparkline of weekly contributions
    sx, sy, sw, sh = 250, 52, 215, 70
    mx = max(weeks) or 1
    n = len(weeks)
    pts = [(sx + i * sw / (n - 1), sy + sh - (v / mx) * sh) for i, v in enumerate(weeks)]
    path = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    area = path + f" L{pts[-1][0]:.1f},{sy + sh} L{sx},{sy + sh} Z"
    # language bar
    lx, ly, lw = 250, 150, 215
    segs, x = [], float(lx)
    shown = 0
    for name, size in top:
        w = lw * size / total
        segs.append(f'<rect x="{x:.1f}" y="{ly}" width="{max(w - 1, 1):.1f}" height="8" fill="{colors[name]}"/>')
        x += w
        shown += size
    if total - shown > 0:
        segs.append(f'<rect x="{x:.1f}" y="{ly}" width="{max(lw * (total - shown) / total - 1, 1):.1f}" height="8" fill="{t["muted"]}" opacity="0.5"/>')
    short = {"TypeScript": "TS", "JavaScript": "JS", "Python": "Python"}
    legend = " · ".join(f"{short.get(nm, nm)} {round(100 * sz / total)}%" for nm, sz in top)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="GitHub stats for {LOGIN}">
<style>
 .t{{font:600 15px {FONT};fill:{t["ink"]}}} .k{{font:400 13px {FONT};fill:{t["muted"]}}}
 .v{{font:600 14px {MONO};fill:{t["ink"]}}} .c{{font:400 11px {FONT};fill:{t["muted"]}}}
</style>
<rect x="0.5" y="0.5" width="{W - 1}" height="{H - 1}" rx="6" fill="{t["bg"]}" stroke="{t["border"]}"/>
<text x="24" y="34" class="t">jk · GitHub</text>
<rect x="128" y="24" width="14" height="14" rx="2" fill="{t["accent"]}"/><text x="135" y="35.5" font-size="9" fill="#fff" text-anchor="middle" font-family="serif">聽</text>
{rows_svg}
<text x="{sx}" y="34" class="c">Contributions · 52 weeks</text>
<path d="{area}" fill="{t["accent"]}" fill-opacity="0.12"/>
<path d="{path}" fill="none" stroke="{t["accent"]}" stroke-width="1.6" stroke-linejoin="round"/>
<circle cx="{pts[-1][0]:.1f}" cy="{pts[-1][1]:.1f}" r="3" fill="{t["accent"]}"/>
<text x="{sx}" y="141" class="c">Languages</text>
{''.join(segs)}
<text x="{sx}" y="174" class="c">{esc(legend)}</text>
</svg>
'''


def streaks(days: list[dict]) -> tuple[int, tuple, int, tuple]:
    """Return (current, (start,end), longest, (start,end)) over the calendar days (oldest → newest)."""
    best, best_rng = 0, (None, None)
    run, run_start = 0, None
    for d in days:
        if d["contributionCount"] > 0:
            run += 1
            run_start = run_start or d["date"]
            if run > best:
                best, best_rng = run, (run_start, d["date"])
        else:
            run, run_start = 0, None
    # current streak: count back from the newest day; a zero today still keeps yesterday's streak alive
    cur, cur_end = 0, None
    i = len(days) - 1
    if days and days[i]["contributionCount"] == 0:
        i -= 1
    while i >= 0 and days[i]["contributionCount"] > 0:
        cur += 1
        cur_end = cur_end or days[i]["date"]
        cur_start = days[i]["date"]
        i -= 1
    cur_rng = (cur_start, cur_end) if cur else (None, None)
    return cur, cur_rng, best, best_rng


def fmt_range(r: tuple) -> str:
    def f(s: str) -> str:
        d = dt.date.fromisoformat(s)
        return d.strftime("%b %-d")
    if not r[0]:
        return "—"
    return f(r[0]) if r[0] == r[1] else f"{f(r[0])} – {f(r[1])}"


def streak_svg(u: dict, t: dict) -> str:
    W, H = 495, 195
    cal = u["contributionsCollection"]["contributionCalendar"]
    days = [d for w in cal["weeks"] for d in w["contributionDays"]]
    cur, cur_rng, best, best_rng = streaks(days)
    total = cal["totalContributions"]
    first, last = days[0]["date"], days[-1]["date"]
    # ring: fraction of the longest streak, never empty
    r, cx, cy = 34, W / 2, 86
    circ = 2 * 3.14159265 * r
    frac = max(0.06, min(1.0, cur / best)) if best else 0.06
    cols = [(W * 0.18, str(total), "Total · past year", fmt_range((first, last))),
            (W * 0.82, str(best), "Longest streak", fmt_range(best_rng))]
    side = "".join(
        f'<text x="{x}" y="92" class="n" text-anchor="middle">{v}</text>'
        f'<text x="{x}" y="116" class="k" text-anchor="middle">{esc(l)}</text>'
        f'<text x="{x}" y="136" class="c" text-anchor="middle">{esc(s)}</text>'
        for x, v, l, s in cols
    )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="Contribution streak for {LOGIN}">
<style>
 .t{{font:600 15px {FONT};fill:{t["ink"]}}} .k{{font:400 13px {FONT};fill:{t["muted"]}}}
 .n{{font:600 28px {FONT};fill:{t["ink"]}}} .c{{font:400 11px {FONT};fill:{t["muted"]}}}
 .big{{font:700 30px {FONT};fill:{t["ink"]}}}
</style>
<rect x="0.5" y="0.5" width="{W - 1}" height="{H - 1}" rx="6" fill="{t["bg"]}" stroke="{t["border"]}"/>
<text x="24" y="34" class="t">Streak</text>
<line x1="{W * 0.36}" y1="62" x2="{W * 0.36}" y2="150" stroke="{t["border"]}"/>
<line x1="{W * 0.64}" y1="62" x2="{W * 0.64}" y2="150" stroke="{t["border"]}"/>
{side}
<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{t["track"]}" stroke-width="4"/>
<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{t["accent"]}" stroke-width="4" stroke-linecap="round"
  stroke-dasharray="{circ * frac:.1f} {circ:.1f}" transform="rotate(-90 {cx} {cy})"/>
<text x="{cx}" y="{cy + 11}" class="big" text-anchor="middle">{cur}</text>
<text x="{cx}" y="{cy + 54}" class="k" text-anchor="middle">Current streak</text>
<text x="{cx}" y="{cy + 74}" class="c" text-anchor="middle">{esc(fmt_range(cur_rng))}</text>
</svg>
'''


def main() -> None:
    u = fetch()
    ASSETS.mkdir(exist_ok=True)
    for suffix, theme in THEMES.items():
        (ASSETS / f"stats{suffix}.svg").write_text(stats_svg(u, theme))
        (ASSETS / f"streak{suffix}.svg").write_text(streak_svg(u, theme))
    print("wrote stats/streak cards (light + dark)")


if __name__ == "__main__":
    main()
