#!/usr/bin/env python3
"""Build a Teams app package after registering the bot app in Microsoft Entra."""

from __future__ import annotations

import json
import os
import re
import struct
import zlib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUTPUT = HERE / "dist"


def png(width: int, height: int, pixels: list[list[tuple[int, int, int, int]]]) -> bytes:
    """Encode a small RGBA bitmap as PNG using only the Python standard library."""
    raw = b"".join(b"\x00" + b"".join(bytes(pixel) for pixel in row) for row in pixels)

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def icons() -> tuple[bytes, bytes]:
    blue = (37, 99, 235, 255)
    white = (255, 255, 255, 255)

    # Pixel lettering keeps the package self-contained without external font assets.
    glyphs = {
        "S": ["01111", "11000", "11000", "01110", "00011", "00011", "11110"],
        "Q": ["01110", "11011", "11011", "11011", "11111", "01110", "00011"],
    }

    color_pixels = [[blue for _ in range(192)] for _ in range(192)]
    scale, gap = 14, 14
    word_width = (5 * scale) * 2 + gap
    left = (192 - word_width) // 2
    top = (192 - 7 * scale) // 2
    for index, letter in enumerate(("S", "Q")):
        x0 = left + index * (5 * scale + gap)
        for y, row in enumerate(glyphs[letter]):
            for x, bit in enumerate(row):
                if bit == "1":
                    for dy in range(scale):
                        for dx in range(scale):
                            color_pixels[top + y * scale + dy][x0 + x * scale + dx] = white

    outline_pixels = [[(0, 0, 0, 0) for _ in range(32)] for _ in range(32)]
    # White QA check mark on a transparent canvas.
    for step in range(6):
        x, y = 7 + step, 17 + step
        outline_pixels[y][x] = white
        outline_pixels[y + 1][x] = white
    for step in range(13):
        x, y = 12 + step, 22 - step
        outline_pixels[y][x] = white
        outline_pixels[y][x + 1] = white

    return png(192, 192, color_pixels), png(32, 32, outline_pixels)


def main() -> None:
    app_id = os.environ.get("TEAMS_APP_ID", "").strip()
    app_domain = os.environ.get("APP_DOMAIN", "").strip().lower().rstrip(".")
    app_version = os.environ.get("TEAMS_APP_VERSION", "1.0.0").strip()
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", app_id):
        raise SystemExit("Set TEAMS_APP_ID to the Microsoft Entra application UUID.")
    if not re.fullmatch(r"[a-z0-9.-]+", app_domain) or "." not in app_domain:
        raise SystemExit("Set APP_DOMAIN to the public app hostname, without https:// or a path.")
    if not re.fullmatch(r"\d+\.\d+\.\d+", app_version):
        raise SystemExit("Set TEAMS_APP_VERSION to a semantic version like 1.0.1 (bump it whenever re-uploading to Teams admin center).")

    manifest = (HERE / "manifest.template.json").read_text(encoding="utf-8")
    manifest = manifest.replace("{{TEAMS_APP_ID}}", app_id).replace("{{APP_DOMAIN}}", app_domain).replace("{{TEAMS_APP_VERSION}}", app_version)
    package = json.loads(manifest)

    OUTPUT.mkdir(parents=True, exist_ok=True)
    stage = OUTPUT / "package"
    stage.mkdir(parents=True, exist_ok=True)
    (stage / "manifest.json").write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    color_icon, outline_icon = icons()
    (stage / "color.png").write_bytes(color_icon)
    (stage / "outline.png").write_bytes(outline_icon)

    archive = OUTPUT / "super-qa-teams.zip"
    with ZipFile(archive, "w", ZIP_DEFLATED) as zipped:
        for name in ("manifest.json", "color.png", "outline.png"):
            zipped.write(stage / name, name)
    print(f"Created {archive}")
    print("Upload this package in Teams admin center or sideload it for a tenant pilot.")
    print("Set the Azure Bot messaging endpoint to the URL shown by Super QA after connecting it.")


if __name__ == "__main__":
    main()
