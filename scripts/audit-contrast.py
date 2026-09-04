#!/usr/bin/env python3
"""Contrast-audit the built stylesheet for the light /app shell.

`next build` succeeding proves nothing about a colour conversion: CSS always
compiles. This walks the emitted stylesheet, resolves each rule's foreground and
background (following var() indirection through the three token blocks), and
reports pairs whose WCAG contrast ratio is below the readable threshold.

It cannot catch everything — a background inherited from an ancestor rule is
invisible here — so a rule with a colour but no background is reported
separately as "inherited" rather than as a failure. But it does catch the exact
failure mode this conversion risks: a light foreground left on a now-light
surface.
"""

import re
import sys
from pathlib import Path

# Resolved from this file, not the cwd, so the check runs from anywhere:
# scripts/ -> repo root -> apps/web/.next/static/css
CSS_DIR = Path(__file__).resolve().parent.parent / "apps" / "web" / ".next" / "static" / "css"


def parse_hex(h: str):
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) == 8:
        h = h[:6]
    if len(h) != 6:
        return None
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def parse_color(value: str, tokens: dict, depth=0):
    """Return (r,g,b, alpha) or None. Composites alpha over white."""
    if depth > 6:
        return None
    value = value.strip()
    m = re.match(r"var\(\s*(--[\w-]+)\s*(?:,\s*(.*))?\)$", value)
    if m:
        name, fallback = m.group(1), m.group(2)
        if name in tokens:
            return parse_color(tokens[name], tokens, depth + 1)
        if fallback:
            return parse_color(fallback, tokens, depth + 1)
        return None
    if value.startswith("#"):
        rgb = parse_hex(value)
        return (*rgb, 1.0) if rgb else None
    m = re.match(r"rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.%]+))?\s*\)$", value)
    if m:
        r, g, b = (float(m.group(i)) for i in (1, 2, 3))
        a = m.group(4)
        alpha = 1.0
        if a:
            alpha = float(a.rstrip("%")) / (100 if a.endswith("%") else 1)
        return (r, g, b, alpha)
    named = {"white": (255, 255, 255), "black": (0, 0, 0)}
    if value in named:
        return (*named[value], 1.0)
    return None


def over_white(c):
    r, g, b, a = c
    return tuple(v * a + 255 * (1 - a) for v in (r, g, b))


def luminance(rgb):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg, bg):
    l1, l2 = luminance(fg), luminance(bg)
    lo, hi = sorted((l1, l2))
    return (hi + 0.05) / (lo + 0.05)


def main():
    files = sorted(CSS_DIR.glob("*.css"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        print("no built CSS found; run next build first")
        return 1
    css = files[0].read_text(encoding="utf-8")
    print(f"auditing {files[0].name} ({len(css)} bytes)\n")

    # collect custom properties globally (good enough: the shell defines one set)
    tokens = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;}]+)", css))

    rules = re.findall(r"([^{}]+)\{([^{}]*)\}", css)
    fails, inherited = [], []
    for sel, body in rules:
        sel = sel.strip()
        if not sel or sel.startswith("@") or "pico-premium" not in sel and "plaza" not in sel and "pico-flow" not in sel and "infinite-canvas" not in sel:
            continue
        fg_m = re.search(r"(?<![-\w])color\s*:\s*([^;!]+)", body)
        bg_m = re.search(r"background(?:-color)?\s*:\s*([^;!]+)", body)
        if not fg_m:
            continue
        fg = parse_color(fg_m.group(1), tokens)
        if not fg:
            continue
        if not bg_m:
            inherited.append((sel, fg_m.group(1).strip()))
            continue
        bgv = bg_m.group(1).strip()
        if "gradient" in bgv:
            hexes = re.findall(r"#[0-9a-fA-F]{3,6}|rgba?\([^)]*\)", bgv)
            if not hexes:
                continue
            bgv = hexes[0]
        bg = parse_color(bgv, tokens)
        if not bg:
            continue
        # a translucent background sits on the shell's white page
        ratio = contrast(over_white(fg), over_white(bg))
        if ratio < 3.0:
            fails.append((ratio, sel, fg_m.group(1).strip(), bg_m.group(1).strip()))

    fails.sort()
    print(f"=== 对比度不足 (<3.0:1) 的规则: {len(fails)} ===")
    for ratio, sel, f, b in fails:
        print(f"  {ratio:4.2f}:1  {sel[:76]}")
        print(f"           color:{f[:44]}  bg:{b[:44]}")

    # Of the inherited ones, only flag foregrounds that are light (would vanish
    # on a white page).
    light_inherited = []
    for sel, fgv in inherited:
        c = parse_color(fgv, tokens)
        if c and luminance(over_white(c)) > 0.5:
            light_inherited.append((sel, fgv))
    print(f"\n=== 浅色前景但本规则无背景（继承自祖先，需人工确认）: {len(light_inherited)} ===")
    for sel, fgv in light_inherited:
        print(f"  {sel[:80]}  color:{fgv[:40]}")

    return 1 if fails or light_inherited else 0


if __name__ == "__main__":
    sys.exit(main())
