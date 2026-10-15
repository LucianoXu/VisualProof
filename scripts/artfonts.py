# The fonts `visualproof artwork` draws with, made from the page's (ExportSpec decision 21): each face
# an artwork uses, at each weight it draws, as a static TrueType font — the page's WOFF2 files are
# variable, split by script, and compressed, which no browser-free renderer reads — and the advance
# widths of their characters, so that the command measures text with no font library.
#
#   python3 scripts/artfonts.py [--noto <folder>]
#
# Needs fontTools with Brotli (`pip install fonttools brotli`). Writes src/assets/webfonts/ttf/*.ttf
# and src/assets/webfonts/metrics.json; run it again after the WOFF2 files change. Two faces stand
# in where the page's have no glyph — a browser would take one from the system's fonts — cut down to
# what Lean's names write: Noto Sans for sub- and superscripts and punctuation, Noto Sans Math for
# the rest of mathematics, from `--noto` (NotoSans-Regular.ttf, NotoSansMath-Regular.ttf; Debian's
# fonts-noto-core by default). Every font keeps its SIL Open Font License (LICENSE-*.txt beside them).

import json
import os
import sys
from io import BytesIO

from fontTools import subset
from fontTools.merge import Merger, Options
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "..", "src", "assets", "webfonts")
OUT = os.path.join(FONTS, "ttf")

# each face: its family as the page names it, its files' stem, the weights and styles an artwork
# draws it at (web/src/canvas.ts artText, web/src/artwork.ts drawTitle and drawFoot, web/src/halo.ts),
# and the stem of another whose Greek it takes, as the page's font list does ("Jost", "Source Sans 3")
FACES = [
    ("Source Sans 3", "source-sans-3", [(400, "normal"), (500, "normal"), (600, "normal"), (700, "normal"), (400, "italic")], None),
    ("Source Serif 4", "source-serif-4", [(400, "italic"), (600, "italic")], None),
    ("Jost", "jost", [(400, "normal"), (500, "normal")], "source-sans-3"),
]
# the faces that stand in, and the characters taken from them: general punctuation, sub- and
# superscripts, phonetic letters (ᵢ), letterlike symbols, arrows, mathematical operators and
# technical signs, shapes, mathematical brackets and arrows, and the mathematical alphabets
FALLBACK = [
    ("Noto Sans", "NotoSans-Regular.ttf", "noto-sans", "U+2000-206F,U+2070-209F,U+1D00-1DBF,U+2100-214F"),
    ("Noto Sans Math", "NotoSansMath-Regular.ttf", "noto-sans-math", "U+2100-214F,U+2190-21FF,U+2200-22FF,U+2300-23FF,U+25A0-25FF,U+27C0-27FF,U+2900-2AFF,U+1D400-1D7FF"),
]
SUBSETS = ["latin", "latin-ext", "greek"]
# what a picture never needs and a merge of subsets cannot always join: shaping, kerning, hinting
DROP = ["GSUB", "GPOS", "GDEF", "kern", "fpgm", "prep", "cvt ", "gasp", "STAT", "MVAR", "HVAR", "avar", "fvar", "gvar"]


def instance(path: str, weight: int) -> TTFont:
    """One subset's file at one weight, static, decompressed, without what a picture never needs."""
    f = TTFont(path)
    f.flavor = None
    if "fvar" in f:
        f = instantiateVariableFont(f, {"wght": weight}, inplace=False)
    for t in DROP:
        if t in f:
            del f[t]
    f["OS/2"].usWeightClass = weight
    buf = BytesIO()
    f.save(buf)
    buf.seek(0)
    return TTFont(buf)


def name(f: TTFont, family: str, weight: int, style: str) -> None:
    """Its names as the picture asks for it: the family, and its weight and slant in OS/2 and head."""
    sub = {400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold"}[weight]
    if style == "italic":
        sub = "Italic" if weight == 400 else f"{sub} Italic"
    full = f"{family} {sub}"
    t = f["name"]
    for rec in list(t.names):
        if rec.nameID in (1, 2, 4, 6, 16, 17, 25):
            t.removeNames(nameID=rec.nameID)
    t.setName(family, 1, 3, 1, 0x409)
    t.setName(sub, 2, 3, 1, 0x409)
    t.setName(full, 4, 3, 1, 0x409)
    t.setName(full.replace(" ", ""), 6, 3, 1, 0x409)
    t.setName(family, 16, 3, 1, 0x409)
    t.setName(sub, 17, 3, 1, 0x409)
    os2 = f["OS/2"]
    os2.usWeightClass = weight
    italic = style == "italic"
    os2.fsSelection = (os2.fsSelection & ~0b1100001) | (0b1 if italic else 0) | (0b1000000 if not italic and weight == 400 else 0)
    f["head"].macStyle = (0b10 if italic else 0) | (0b1 if weight >= 700 else 0)


def widths_of(path: str) -> tuple[int, dict[str, int]]:
    """A font's units per em, and the advance of every character it has."""
    f = TTFont(path)
    hmtx = f["hmtx"].metrics
    return f["head"].unitsPerEm, {str(cp): hmtx[g][0] for cp, g in sorted(f.getBestCmap().items()) if g in hmtx}


def main() -> int:
    noto = sys.argv[sys.argv.index("--noto") + 1] if "--noto" in sys.argv else "/usr/share/fonts/truetype/noto"
    os.makedirs(OUT, exist_ok=True)
    metrics = []
    for family, stem, styles, greek in FACES:
        for weight, style in styles:
            parts = [os.path.join(FONTS, f"{stem}-{sub}-wght-{style}.woff2") for sub in SUBSETS]
            if greek:
                parts.append(os.path.join(FONTS, f"{greek}-greek-wght-{style}.woff2"))
            parts = [p for p in parts if os.path.exists(p)]
            files = []
            for k, p in enumerate(parts):
                tmp = os.path.join(OUT, f".part{k}.ttf")
                instance(p, weight).save(tmp)
                files.append(tmp)
            merged = Merger(options=Options(drop_tables=DROP)).merge(files) if len(files) > 1 else TTFont(files[0])
            for tmp in files:
                os.remove(tmp)
            name(merged, family, weight, style)
            out = os.path.join(OUT, f"{stem}-{weight}-{style}.ttf")
            merged.save(out)
            upm, widths = widths_of(out)
            metrics.append({"family": family, "weight": weight, "style": style, "unitsPerEm": upm, "widths": widths})
            print(f"{os.path.basename(out)}: {len(widths)} characters, {os.path.getsize(out) // 1024} KB")
    fallback = []
    for family, source, stem, ranges in FALLBACK:
        out = os.path.join(OUT, f"{stem}.ttf")
        opts = subset.Options()
        opts.drop_tables += DROP
        opts.layout_features = []
        opts.hinting = False
        f = subset.load_font(os.path.join(noto, source), opts)
        sub = subset.Subsetter(options=opts)
        sub.populate(unicodes=subset.parse_unicodes(ranges))
        sub.subset(f)
        f.save(out)
        upm, widths = widths_of(out)
        fallback.append({"family": family, "weight": 400, "style": "normal", "unitsPerEm": upm, "widths": widths})
        print(f"{os.path.basename(out)}: {len(widths)} characters, {os.path.getsize(out) // 1024} KB")
    with open(os.path.join(FONTS, "metrics.json"), "w") as w:
        json.dump({"faces": metrics, "fallback": fallback}, w, separators=(",", ":"))
    print(f"metrics.json: {os.path.getsize(os.path.join(FONTS, 'metrics.json')) // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
