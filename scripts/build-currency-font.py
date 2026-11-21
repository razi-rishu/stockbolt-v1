"""
Build src/assets/fonts/sb-currency.woff: a one-glyph font that draws the UAE
dirham sign at the private-use code point U+E000 (DIRHAM_SIGN in
src/lib/currency-display.ts). Phase143 follow-up.

Why a font: the sign has no code point that phones or our fonts support yet, and
currency labels are plain text everywhere (screens, print templates, PDFs). A
font listed first in every font stack, limited by unicode-range to U+E000, draws
it wherever that text appears; every other character falls through to Inter.

Source: src/assets/fonts/uae-dirham-symbol.svg ("UAE Dirham Symbol.svg",
Wikimedia Commons, CC0 public domain, by ARABCREATOR7).

Run (fontTools is not a project dependency):
    python -m pip install --target <tmp> fonttools
    PYTHONPATH=<tmp> python scripts/build-currency-font.py
"""
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import SVGPath

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src/assets/fonts/uae-dirham-symbol.svg"
OUT = ROOT / "src/assets/fonts/sb-currency.woff"

CODE_POINT = 0xE000
UPM = 1000
SVG_W, SVG_H = 1000, 870
CAP_HEIGHT = 720          # Inter's capitals are ~0.727 em: the sign sits like a capital letter
SIDE = 50                 # side bearing, so "<sign> 1,234.00" breathes like other symbols

scale = CAP_HEIGHT / SVG_H
width = round(SVG_W * scale) + 2 * SIDE

# SVG y grows downwards, font y upwards; the sign's foot sits on the baseline.
pen = TTGlyphPen(None)
SVGPath(str(SRC)).draw(
    TransformPen(Cu2QuPen(pen, max_err=1.0, reverse_direction=True),
                 (scale, 0, 0, -scale, SIDE, SVG_H * scale)))
dirham = pen.glyph()

notdef = TTGlyphPen(None).glyph()

fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder([".notdef", "dirham"])
fb.setupCharacterMap({CODE_POINT: "dirham"})
fb.setupGlyf({".notdef": notdef, "dirham": dirham})
fb.setupHorizontalMetrics({".notdef": (500, 0), "dirham": (width, SIDE)})
fb.setupHorizontalHeader(ascent=900, descent=-250)
fb.setupNameTable({"familyName": "SB Currency", "styleName": "Regular"})
fb.setupOS2(sTypoAscender=900, sTypoDescender=-250, usWinAscent=900, usWinDescent=250,
            sCapHeight=CAP_HEIGHT, sxHeight=520)
fb.setupPost()
fb.font.flavor = "woff"
fb.save(str(OUT))
print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes), advance {width}")
