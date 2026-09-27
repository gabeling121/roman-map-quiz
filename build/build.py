"""Builds ../docs/mapdata.js from Natural Earth data + hand-defined quiz regions.

Run: python build.py   (expects the ne_10m_*.geojson files in this folder)
"""
import json, math, os, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "docs")

# Map extent (lon/lat) and projection: equirectangular scaled by cos(42 deg)
LON0, LON1, LAT0, LAT1 = -11.0, 42.0, 25.0, 59.5
S = 25.0
KX = math.cos(math.radians(42))
W = round((LON1 - LON0) * KX * S)
H = round((LAT1 - LAT0) * S)


def proj(lon, lat):
    return ((lon - LON0) * KX * S, (LAT1 - lat) * S)


def clip_ring(ring, xmin, ymin, xmax, ymax):
    """Sutherland-Hodgman clip of a closed ring (projected coords) to a rectangle."""
    def clip(pts, inside, inter):
        out = []
        n = len(pts)
        for i in range(n):
            cur, prev = pts[i], pts[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(inter(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(inter(prev, cur))
        return out

    def ix(x):
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))

    def iy(y):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)

    pts = ring
    for inside, inter in [
        (lambda p: p[0] >= xmin, ix(xmin)),
        (lambda p: p[0] <= xmax, ix(xmax)),
        (lambda p: p[1] >= ymin, iy(ymin)),
        (lambda p: p[1] <= ymax, iy(ymax)),
    ]:
        if not pts:
            break
        pts = clip(pts, inside, inter)
    return pts


def simplify(pts, tol):
    """Douglas-Peucker (iterative)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-9
        best, bi = 0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L
            if d > best:
                best, bi = d, i
        if best > tol and bi > 0:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def fmt(p):
    return f"{p[0]:.1f},{p[1]:.1f}"


def ring_path(pts):
    return "M" + "L".join(fmt(p) for p in pts) + "Z"


def line_path(pts):
    return "M" + "L".join(fmt(p) for p in pts)


def rings_of(geom):
    if geom["type"] == "Polygon":
        return geom["coordinates"]
    if geom["type"] == "MultiPolygon":
        return [r for poly in geom["coordinates"] for r in poly]
    return []


def lines_of(geom):
    if geom["type"] == "LineString":
        return [geom["coordinates"]]
    if geom["type"] == "MultiLineString":
        return geom["coordinates"]
    return []


PAD = 2


def build_polys(path, tol=0.3, min_extent=0.0, filt=None):
    data = json.load(open(os.path.join(HERE, path), encoding="utf-8"))
    parts = []
    for f in data["features"]:
        if filt and not filt(f["properties"]):
            continue
        for ring in rings_of(f["geometry"]):
            lons = [c[0] for c in ring]
            lats = [c[1] for c in ring]
            if max(lons) < LON0 or min(lons) > LON1 or max(lats) < LAT0 or min(lats) > LAT1:
                continue
            pts = [proj(c[0], c[1]) for c in ring]
            pts = clip_ring(pts, -PAD, -PAD, W + PAD, H + PAD)
            if len(pts) < 3:
                continue
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            if max(max(xs) - min(xs), max(ys) - min(ys)) < min_extent:
                continue
            if pts[0] == pts[-1]:
                pts = pts[:-1]
            # simplify the closed ring as two open halves so DP has distinct endpoints
            h = len(pts) // 2
            pts = simplify(pts[:h + 1], tol)[:-1] + simplify(pts[h:] + [pts[0]], tol)[:-1]
            if len(pts) >= 3:
                parts.append(ring_path(pts))
    return "".join(parts)


def build_rivers(names, maxrank=7, tol=0.4):
    data = json.load(open(os.path.join(HERE, "ne_10m_rivers_lake_centerlines.geojson"), encoding="utf-8"))
    out = []
    for f in data["features"]:
        p = f["properties"]
        nm = p.get("name") or ""
        if names is None:
            if (p.get("scalerank") or 99) > maxrank or "Canal" in nm or nm in RIVER_TARGETS:
                continue
        elif nm not in names:
            continue
        for line in lines_of(f["geometry"]):
            if not any(LON0 < c[0] < LON1 and LAT0 < c[1] < LAT1 for c in line):
                continue
            pts = simplify([proj(c[0], c[1]) for c in line], tol)
            out.append(line_path(pts))
    return "".join(out)


RIVER_TARGETS = {"Tevere", "Nile", "Rosetta Branch", "Damietta Branch"}


def P(coords):
    return ring_path([proj(*c) for c in coords])


# ---------------------------------------------------------------------------
# Quiz places. kind: region (clipped to land), sea (clipped to water),
# mountains, river, city, volcano.
# ---------------------------------------------------------------------------
PLACES = [
    dict(id="roma", name="Roma", kind="city", at=(12.49, 41.89),
         en="Rome", fact="Capital of the Roman world, built on seven hills beside the Tiber River. Today: Rome, Italy."),
    dict(id="tiberis", name="Tiberis", kind="river", river=["Tevere"], at=(12.1, 42.9), lab=(11.75, 42.55), anchor="end",
         en="Tiber River", fact="The river of Rome. Legend says the twins Romulus and Remus were found on its banks."),
    dict(id="alpes", name="Alpēs Montēs", kind="mountains", at=(9.8, 46.4),
         shape=[(7.0, 44.0), (6.5, 44.6), (6.6, 45.4), (6.8, 46.0), (7.6, 46.5), (8.8, 46.8), (10.2, 47.1),
                (11.8, 47.4), (13.4, 47.6), (15.3, 47.8), (16.2, 47.4), (15.6, 46.8), (14.2, 46.5),
                (12.6, 46.2), (11.2, 45.9), (9.8, 46.0), (8.4, 45.8), (7.5, 45.3), (7.4, 44.6), (7.9, 44.1)],
         en="The Alps", fact="The great mountain wall north of Italy. Hannibal crossed them with elephants in 218 BC."),
    dict(id="vesuvius", name="Vesuvius Mōns", kind="volcano", at=(14.43, 40.82),
         en="Mount Vesuvius", fact="Volcano near Naples that erupted in AD 79 and buried Pompeii and Herculaneum."),
    dict(id="sicilia", name="Sicilia", kind="region", at=(14.1, 37.55), lab=(14.2, 37.45), color="#c77dba",
         shape=[(12.0, 38.5), (15.58, 38.5), (15.58, 38.24), (15.45, 37.9), (15.9, 37.0), (15.4, 36.4), (12.0, 36.4)],
         en="Sicily", fact="Big island at the toe of Italy. It became Rome's very first province in 241 BC."),
    dict(id="italia", name="Italia", kind="region", at=(13.4, 42.6), lab=(13.4, 43.35), color="#d98080",
         shape=[(7.6, 43.78), (7.45, 44.1), (6.9, 45.1), (7.1, 45.9), (8.5, 46.4), (10.5, 46.8), (12.3, 47.0),
                (13.7, 46.5), (13.9, 45.6), (13.2, 44.8), (14.6, 43.2), (16.5, 42.1), (18.8, 40.6),
                (18.9, 39.6), (17.0, 38.7), (16.3, 37.8), (15.9, 37.85), (15.62, 38.0), (15.64, 38.28),
                (15.3, 38.9), (13.0, 40.0), (11.0, 41.8), (10.0, 43.4), (9.5, 44.0), (7.8, 43.5)],
         en="Italy", fact="The boot-shaped peninsula that was the homeland of the Romans."),
    dict(id="graecia", name="Graecia", kind="region", at=(21.9, 39.4), lab=(21.7, 39.75), color="#7fb07f",
         shape=[(20.0, 39.6), (20.3, 39.95), (21.0, 40.6), (22.0, 41.1), (23.0, 41.35), (24.5, 41.5),
                (26.2, 41.7), (26.1, 40.85), (25.3, 40.4), (24.4, 39.5), (24.2, 38.9), (24.7, 38.1),
                (24.2, 37.6), (23.5, 37.25), (23.4, 36.2), (22.4, 36.2), (21.0, 36.6), (20.7, 37.8),
                (19.8, 39.1)],
         en="Greece", fact="Land of the ancient Greeks, whose art, gods and ideas the Romans loved and copied. Rome took control in 146 BC."),
    dict(id="aegyptus", name="Aegyptus", kind="region", at=(29.0, 27.5), lab=(28.2, 27.3), color="#e0c060",
         shape=[(25.0, 31.7), (25.0, 32.3), (32.4, 31.8), (32.4, 31.2), (32.6, 30.0), (33.2, 28.3),
                (34.8, 25.0), (34.8, 24.0), (25.0, 24.0)],
         en="Egypt", fact="Rich land of the Nile. It became Roman in 30 BC after Cleopatra's defeat and sent grain to feed Rome."),
    dict(id="gallia", name="Gallia", kind="region", at=(2.4, 46.9), color="#d9a066",
         shape=[(-1.8, 43.35), (-2.8, 44.2), (-6.0, 46.0), (-6.0, 47.5), (-5.2, 48.9), (-1.5, 49.9),
                (1.0, 50.4), (2.0, 51.1), (4.0, 51.9), (4.4, 51.95), (6.1, 51.85), (6.8, 51.4),
                (7.0, 50.9), (7.6, 50.35), (8.27, 50.0), (8.45, 49.0), (7.8, 48.5), (7.6, 47.6),
                (7.0, 46.4), (6.9, 45.8), (7.0, 45.0), (7.45, 44.1), (7.6, 43.78), (7.8, 43.0),
                (4.5, 42.5), (3.2, 42.4), (1.5, 42.6), (0.0, 42.7), (-1.0, 43.0)],
         en="Gaul", fact="Land of the Gauls: today France and Belgium. Julius Caesar conquered it in 58-50 BC."),
    dict(id="britannia", name="Britannia", kind="region", at=(-1.6, 52.6), color="#9a8fd0",
         shape=[(-6.5, 49.5), (2.5, 50.8), (2.5, 55.2), (-3.2, 55.05), (-5.5, 54.9), (-6.0, 53.8), (-5.4, 52.0), (-6.8, 51.5)],
         en="Britain", fact="The island province Rome invaded in AD 43. Hadrian's Wall marked its northern edge."),
    dict(id="byzantium", name="Byzantium", alt=["Constantinople", "Constantinopolis", "Byzantium Constantinople", "Byzantium Constantinopolis"],
         kind="city", at=(28.98, 41.01), label="Byzantium (Constantinople)",
         en="Byzantium, later Constantinople", fact="Emperor Constantine made it his new capital in AD 330 and renamed it Constantinople. Today: Istanbul, Turkey."),
    dict(id="alexandrea", name="Alexandrea", kind="city", at=(29.92, 31.2),
         en="Alexandria", fact="Founded by Alexander the Great. Famous for its giant lighthouse and its Great Library."),
    dict(id="carthago", name="Carthago", kind="city", at=(10.32, 36.85), lab=(9.95, 36.65), anchor="end",
         en="Carthage", fact="Rome's great rival in the Punic Wars (Hannibal's city). Rome destroyed it in 146 BC. Near Tunis, Tunisia."),
    dict(id="athenae", name="Athenae", kind="city", at=(23.73, 37.98),
         en="Athens", fact="Greek city famous for democracy, philosophers, and the Parthenon temple to Athena."),
    dict(id="sparta", name="Sparta", kind="city", at=(22.43, 37.07),
         en="Sparta", fact="Greek city of tough warriors in the southern part of Greece (the Peloponnese)."),
    dict(id="troia", name="Troia", alt=["Ilium", "Troia Ilium"], kind="city", at=(26.24, 39.96),
         label="Troia (Ilium)",
         en="Troy (also called Ilium)", fact="City of the Trojan War. Romans believed the hero Aeneas escaped Troy and his descendants founded Rome."),
    dict(id="nilus", name="Nilus", kind="river", river=["Nile", "Rosetta Branch", "Damietta Branch"], at=(31.4, 27.6), lab=(31.6, 28.2), anchor="start",
         en="Nile River", fact="The longest river in the world. Its yearly floods made Egypt's farmland rich."),
    dict(id="creta", name="Creta", kind="region", at=(24.9, 35.2), lab=(24.9, 34.55), color="#6fa8c9",
         shape=[(23.3, 35.8), (26.6, 35.8), (26.6, 34.7), (23.3, 34.7)],
         en="Crete", fact="Largest Greek island, home of King Minos and the legend of the Minotaur in the labyrinth."),
    dict(id="rhodus", name="Rhodus", kind="region", at=(28.0, 36.2), hitR=16, lab=(28.6, 35.7), anchor="start", color="#e08a5a",
         shape=[(27.6, 36.5), (28.35, 36.5), (28.35, 35.8), (27.6, 35.8)],
         en="Rhodes", fact="Island famous for the Colossus of Rhodes, a giant bronze statue and one of the Seven Wonders."),
    dict(id="aegaeum", name="Mare Aegaeum", kind="sea", at=(25.0, 38.6), lab=(25.9, 36.95),
         shape=[(22.5, 40.9), (24.0, 41.0), (26.1, 40.8), (26.15, 40.05), (26.8, 39.5), (27.5, 38.5),
                (28.0, 37.0), (28.4, 36.4), (28.0, 35.9), (26.3, 35.25), (23.6, 35.6), (23.1, 36.4),
                (23.25, 37.5), (23.3, 38.3), (22.5, 39.5)],
         en="Aegean Sea", fact="Island-filled sea between Greece and Asia Minor (Turkey)."),
]

# Plain map labels (not quizzed) to make the map feel like the workbook
DECOR_LABELS = [
    ("Pontus Euxīnus", (34.0, 43.4), "sea"),
    ("Mare Internum", (18.0, 34.4), "sea"),
    ("Hispānia", (-4.0, 40.0), "land"),
    ("Africa", (6.0, 33.0), "land"),
    ("Asia Minor", (33.0, 39.0), "land"),
    ("Germānia", (11.0, 51.5), "land"),
    ("Ōceanus Atlanticus", (-8.0, 45.5), "sea"),
]


def main():
    land = build_polys("ne_10m_land.geojson", tol=0.3, min_extent=0.8)
    lakes = build_polys("ne_10m_lakes.geojson", tol=0.3, min_extent=4,
                        filt=lambda p: (p.get("scalerank") or 99) <= 4)
    rivers = build_rivers(None, maxrank=6)
    places = []
    for pl in PLACES:
        d = {k: pl[k] for k in ("id", "name", "kind", "en", "fact")}
        d["alt"] = pl.get("alt", [])
        d["label"] = pl.get("label", pl["name"])
        d["at"] = [round(v, 1) for v in proj(*pl["at"])]
        if "shape" in pl:
            d["path"] = P(pl["shape"])
        if "river" in pl:
            d["path"] = build_rivers(set(pl["river"]), tol=0.3)
        for k in ("anchor", "color"):
            if k in pl:
                d[k] = pl[k]
        if "lab" in pl:
            d["lab"] = [round(v, 1) for v in proj(*pl["lab"])]
        if "hitR" in pl:
            d["hitR"] = pl["hitR"]
        places.append(d)
    decor = [dict(t=t, at=[round(v, 1) for v in proj(*ll)], k=k) for t, ll, k in DECOR_LABELS]
    frame = f"M{-PAD},{-PAD}H{W + PAD}V{H + PAD}H{-PAD}Z"
    data = dict(w=W, h=H, land=land, lakes=lakes, rivers=rivers, frame=frame, places=places, decor=decor)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "mapdata.js"), "w", encoding="utf-8") as f:
        f.write("window.MAPDATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("mapdata.js", os.path.getsize(os.path.join(OUT, "mapdata.js")), "bytes", W, "x", H)
    for size in (192, 512, 180):
        write_icon(os.path.join(OUT, f"icon-{size}.png"), size)


def write_icon(path, n):
    """Simple app icon: Roman red square with a gold laurel-ish ring and a dot (Roma)."""
    rows = []
    c = n / 2
    for y in range(n):
        row = bytearray([0])
        for x in range(n):
            r = math.hypot(x + 0.5 - c, y + 0.5 - c) / n
            if 0.30 < r < 0.37:
                px = (230, 180, 60)
            elif r < 0.09:
                px = (230, 180, 60)
            else:
                px = (140, 28, 34)
            row += bytes(px)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0)) \
        + chunk(b"IDAT", raw) + chunk(b"IEND", b"")
    open(path, "wb").write(png)


if __name__ == "__main__":
    main()
