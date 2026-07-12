import fitz, sys, os

pdf_path = sys.argv[1]
outdir = sys.argv[2]
os.makedirs(outdir, exist_ok=True)
# optional 3rd arg: skip the top fraction of each page (e.g. 0.1) so the
# intentional full-bleed header doesn't register as left/right "clipping".
skiptop = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0

doc = fitz.open(pdf_path)
print(f"FILE: {pdf_path}")
print(f"PAGES: {doc.page_count}\n")

any_clip = False
for i, page in enumerate(doc):
    r = page.rect
    pix = page.get_pixmap(dpi=110)
    png = f"{outdir}/page-{i+1:02d}.png"
    pix.save(png)

    w, h, n = pix.width, pix.height, pix.n
    samples = pix.samples
    stride = pix.stride
    minx, miny, maxx, maxy = w, h, 0, 0
    nonwhite = 0
    threshold = 250
    ystart = int(h * skiptop)
    for y in range(ystart, h):
        row = stride * y
        for x in range(w):
            base = row + x * n
            if samples[base] < threshold or samples[base + 1] < threshold or samples[base + 2] < threshold:
                nonwhite += 1
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    if nonwhite == 0:
        print(f"page {i+1}: {w}x{h}px | BLANK (after skip)"); continue
    cov = 100.0 * nonwhite / (w * h)
    fx0, fy0, fx1, fy1 = minx / w, miny / h, maxx / w, maxy / h
    clipped = []
    if minx <= 1: clipped.append("LEFT")
    if maxx >= w - 2: clipped.append("RIGHT")
    if miny <= ystart + 1 and skiptop == 0: clipped.append("TOP")
    if maxy >= h - 2: clipped.append("BOTTOM")
    if clipped: any_clip = True
    print(f"page {i+1}: {w}x{h}px | content x[{fx0:.2f}-{fx1:.2f}] y[{fy0:.2f}-{fy1:.2f}] | ink {cov:.1f}% | clipped: {','.join(clipped) or 'none'}")

print(f"\nTEXT CLIPPING (skip-top {skiptop}): {'FOUND ✗' if any_clip else 'NONE ✓'}")

