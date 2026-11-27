#!/usr/bin/env python3
"""Generate the Android launcher icons from Pippy's own mascot.

Run:  python3 scripts/make-android-icons.py
Needs Pillow (a throwaway venv is fine; nothing imports this at build time).

Why a script rather than a one-off: the icons are derived from
public/icon-512.png, and if that artwork ever changes, every one of the
sixteen files below has to change with it. Regenerating beats hand-editing.

── What Android actually wants ──────────────────────────────────────────────

Two generations of icon, and they are not the same shape of problem.

LEGACY (ic_launcher.png, every launcher before API 26, and still the fallback)
is simply the artwork at five densities. Pippy's icon is already drawn as a
rounded square, so it is used as-is.

ADAPTIVE (API 26+) is two layers, each 108dp, of which the system shows only
the middle 72dp -- it masks the rest into a circle, squircle or whatever the
launcher prefers. Anything in the outer 18dp band may be cropped.

So the foreground cannot just be the artwork scaled to fill: the dog's ears
reach the edges and would lose their tips to the mask. It is placed at 72/108
instead, and the background is the flat yellow the artwork already sits on, so
the inset is invisible -- the eye sees one continuous icon, and the mask only
ever cuts yellow.

The white corners of the source have to go first, or the circle would show
four white arcs where the rounded square's corners used to be.
"""

import os
from PIL import Image, ImageDraw

ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'public', 'icon-512.png')
RES    = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')

# Sampled from the artwork's own edge, not guessed, so the adaptive
# background and the foreground's own backdrop are the same colour.
BRAND_YELLOW = (242, 184, 59)

# Enough to clear the rounded corners: white runs ~34px along the diagonal at
# worst, which is ~24px on each axis. 44 is comfortably past it without
# reaching the dog.
CORNER_INSET = 44

# dp -> px multiplier per density bucket.
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
LEGACY_DP   = 48    # ic_launcher / ic_launcher_round
ADAPTIVE_DP = 108   # each adaptive layer
SAFE_DP     = 72    # the part of it the mask is guaranteed to show
# How much of the layer the artwork itself occupies.
#
# Exactly the visible area, and that is a deliberate choice between two
# imperfect options.
#
# Smaller, and the artwork's own edge lands INSIDE the mask: Pippy's icon is
# drawn full-bleed -- cream head to the top, green to the left -- so a gap
# round it shows as a square seam against the background colour. Tried at 60dp;
# it reads as a sticker stuck on a yellow tile.
#
# Larger, and more of the drawing is thrown away by the mask for no gain.
#
# At exactly 72 the artwork edge coincides with the mask edge, so there is no
# seam at any launcher shape. A circular launcher does trim the ear tips, which
# is what a circle does to any square-drawn icon and is why the artwork is
# centred on the dog's face rather than its silhouette.
CONTENT_DP  = 72


def load_artwork():
    """The source, as RGB. It is a JPEG despite the .png name -- see below."""
    im = Image.open(SOURCE)
    return im.convert('RGB')


def full_bleed(art):
    """The artwork with its white rounded corners cropped away."""
    w, h = art.size
    return art.crop((CORNER_INSET, CORNER_INSET, w - CORNER_INSET, h - CORNER_INSET))


def write(img, density, name):
    d = os.path.join(RES, f'mipmap-{density}')
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, name)
    img.save(path, 'PNG', optimize=True)
    return path


def main():
    art   = load_artwork()
    bleed = full_bleed(art)
    made  = []

    for density, mult in DENSITIES.items():
        legacy_px = int(LEGACY_DP * mult)
        # Legacy and round both use the full-bleed artwork. The source's
        # rounded corners are opaque WHITE, not transparent, so using it as
        # drawn puts four white triangles on the launcher -- obvious against a
        # dark wallpaper, and worse once a launcher applies its own mask.
        legacy_img = bleed.resize((legacy_px, legacy_px), Image.LANCZOS)
        made.append(write(legacy_img, density, 'ic_launcher.png'))
        made.append(write(legacy_img, density, 'ic_launcher_round.png'))

        # Adaptive foreground: artwork at CONTENT_DP/108 on a transparent canvas.
        layer_px   = int(ADAPTIVE_DP * mult)
        content_px = int(CONTENT_DP * mult)
        canvas     = Image.new('RGBA', (layer_px, layer_px), (0, 0, 0, 0))
        inner      = bleed.resize((content_px, content_px), Image.LANCZOS).convert('RGBA')
        off        = (layer_px - content_px) // 2
        canvas.paste(inner, (off, off), inner)
        made.append(write(canvas, density, 'ic_launcher_foreground.png'))

    # The background layer is a flat colour, so it is a resource, not an image.
    bg = os.path.join(RES, 'values', 'ic_launcher_background.xml')
    with open(bg, 'w') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <!-- Pippy\'s own yellow, sampled from the artwork so the\n'
                '         adaptive foreground sits on it without a seam. -->\n'
                f'    <color name="ic_launcher_background">#{BRAND_YELLOW[0]:02X}'
                f'{BRAND_YELLOW[1]:02X}{BRAND_YELLOW[2]:02X}</color>\n</resources>\n')
    made.append(bg)

    made += make_splashes(bleed)

    for p in made:
        print('  ', os.path.relpath(p, ROOT))
    print(f'\n{len(made)} files written')



# ── Splash ───────────────────────────────────────────────────────────────────
#
# Capacitor ships a 480x320 white placeholder, used by the launch theme as a
# plain android:background. That means it is STRETCHED to the screen, not
# fitted -- so a drawing placed in it is distorted differently on every device.
#
# A nine-patch would solve that properly. The simpler answer, and the one that
# cannot be distorted at all, is a solid brand-coloured background with the
# mascot drawn at a fixed fraction of the shortest side, generated per
# orientation and density so the stretch is never more than a rounding error.

SPLASH_SIZES = {               # (portrait, landscape) per density
    'mdpi':    ((320, 480),  (480, 320)),
    'hdpi':    ((480, 800),  (800, 480)),
    'xhdpi':   ((720, 1280), (1280, 720)),
    'xxhdpi':  ((960, 1600), (1600, 960)),
    'xxxhdpi': ((1280, 1920), (1920, 1280)),
}
# How much of the shortest side the mascot takes. Small on purpose: a splash is
# a held breath, not a billboard, and an icon that fills the screen reads as a
# loading failure.
SPLASH_FRACTION = 0.34


def rounded(art, size):
    """The artwork as an app-icon-shaped tile.

    Pasted square, the mascot reads as a cropped photo: the head meets the
    bottom edge in a flat line and the whole thing shows as a rectangle a shade
    off the background. Rounding it is what makes it read as the app's icon
    resting on the splash rather than an image that failed to load.
    """
    tile = art.resize((size, size), Image.LANCZOS).convert('RGBA')
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1),
                                           radius=int(size * 0.22), fill=255)
    tile.putalpha(mask)
    return tile


def make_splashes(bleed):
    made = []
    for density, (portrait, landscape) in SPLASH_SIZES.items():
        for orient, size in (('port', portrait), ('land', landscape)):
            canvas = Image.new('RGB', size, BRAND_YELLOW)
            d = int(min(size) * SPLASH_FRACTION)
            art = rounded(bleed, d)
            canvas.paste(art, ((size[0] - d) // 2, (size[1] - d) // 2), art)
            folder = os.path.join(RES, f'drawable-{orient}-{density}')
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, 'splash.png')
            canvas.save(path, 'PNG', optimize=True)
            made.append(path)
    # The orientation-less fallback, for anything that asks for plain
    # @drawable/splash before it knows which way up it is.
    canvas = Image.new('RGB', (1280, 1280), BRAND_YELLOW)
    d = int(1280 * SPLASH_FRACTION)
    art = rounded(bleed, d)
    canvas.paste(art, ((1280 - d) // 2, (1280 - d) // 2), art)
    p = os.path.join(RES, 'drawable', 'splash.png')
    canvas.save(p, 'PNG', optimize=True)
    made.append(p)
    return made

if __name__ == '__main__':
    main()
