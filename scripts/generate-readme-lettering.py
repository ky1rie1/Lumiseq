"""Regenerate the small, outlined README alphabet from pinned OFL fonts.

Usage: python scripts/generate-readme-lettering.py path/to/font-directory
Requires fontTools; application builds use the checked-in result directly.
"""
import hashlib
import json
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.roundingPen import RoundingPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parent.parent
SOURCE = "https://github.com/google/fonts/tree/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl"
FONTS = [
    ("manrope", "Manrope.ttf", 500, "3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6"),
    ("caveat", "Caveat.ttf", 600, "0bdb6b660482d31531b3945849fba5916b3ef8695da7024a9e6b9ee3c4157988"),
]
ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/&+-:."
result = {}
for key, filename, weight, checksum in FONTS:
    location = Path(sys.argv[1]) / filename
    if hashlib.sha256(location.read_bytes()).hexdigest() != checksum:
        raise ValueError(f"Pinned font checksum mismatch: {filename}")
    font = instantiateVariableFont(TTFont(location), {"wght": weight})
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    scale = 1000 / font["head"].unitsPerEm
    letters = {}
    for char in ALPHABET:
        glyph = glyphs[cmap[ord(char)]]
        pen = SVGPathPen(glyphs)
        glyph.draw(TransformPen(RoundingPen(pen), (scale, 0, 0, -scale, 0, 0)))
        letters[char] = {"advance": round(glyph.width * scale, 2), "path": pen.getCommands()}
    result[key] = letters
output = ROOT / "scripts/brand/readme-type.mjs"
output.write_text(
    "// Generated outlined alphabets, not font binaries. SIL OFL 1.1.\n"
    f"// Source: {SOURCE}; regeneration: scripts/generate-readme-lettering.py\n"
    "export const typefaces = " + json.dumps(result, separators=(",", ":")) + ";\n",
    encoding="utf-8",
)
print(f"Generated {output.name}: {output.stat().st_size} bytes")
