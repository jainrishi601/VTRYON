"""Build data/products.json (~500 SKUs) from the enriched source catalogue export.

Usage (repo root):  uv run python scripts/build_catalog.py [SOURCE_DIR]
Stdlib only. Deterministic and idempotent: same input -> byte-identical output.
"""
import hashlib
import html
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "/Users/saksham/Codes/Elara-B2b-recc/catalog-export")
OUT = ROOT / "data" / "products.json"
SEED = 20261101
VIBES = ["minimal", "bold", "classic", "street", "boho", "sporty", "romantic", "edgy"]

# (gender, slot) -> target count. Unisex bags/accessories count toward the men's 10.
TARGETS = {
    ("women", "top"): 105, ("women", "bottom"): 63, ("women", "one_piece"): 80, ("women", "layer"): 20,
    ("women", "bag"): 15, ("women", "accessory"): 10,
    ("men", "top"): 110, ("men", "bottom"): 65, ("men", "layer"): 25,
    ("unisex", "bag"): 7, ("unisex", "accessory"): 3,
}
KURTA_CAP = 25

SLOT_BY_L2 = {
    "top": "shirt t_shirt blouse top tank tank_top camisole polo sweater sweatshirt kurta tunic",
    "bottom": "pants trousers trouser skirt shorts culottes chinos joggers skort",
    "one_piece": "dress kaftan jumpsuit co_ord coord_set shirtdress shirt_dress romper",
    "layer": "jacket cardigan shacket overlay kimono vest blazer nehru_jacket waistcoat",
    "accessory": "scarf stole hat cap beanie",
}
SLOT_BY_L2 = {c: s for s, cs in SLOT_BY_L2.items() for c in cs.split()}
CAT_ALIAS = {"t-shirt": "t_shirt", "tshirt": "t_shirt", "tee": "t_shirt", "trouser": "trousers", "tank": "tank_top",
             "co-ord": "co_ord", "coord_set": "co_ord", "shirt_dress": "shirtdress", "tote_bag": "tote"}
EXCLUDE_WORDS = re.compile(r"\b(pyjamas?|pajamas?|jammies|salwar|sar[ei]e?|lounge ?set|night ?suit|mask|socks?)\b", re.I)

# styleArchetypes -> PRD vibes. Matched per token after splitting on _ - and spaces.
# ponytail: a token lookup, not NLP; extend when the unmapped print below shows a frequent archetype.
VIBE_TOKENS = {
    "minimal": "minimalist minimal minimalism modern contemporary essentialist essential scandi scandinavian japandi "
               "basic clean understated modernist zen simple timeless calm conscious sustainable",
    "classic": "classic preppy refined traditional heritage professional sophisticated elegant formal dapper dandy "
               "smart polished tailored corporate workwear nautical ivy luxe luxurious indian cultural "
               "ceremonial gentleman",
    "boho": "bohemian boho artisan artisanal artistic resort resortwear coastal tropical traveler traveller "
            "globetrotter explorer ethnic fusion earthy natural naturalist nature organic eclectic vacation "
            "global craft handcrafted folk hippie free wanderer wanderlust",
    "bold": "maximalist playful festive glamorous glam statement quirky eclectic retro celebratory vibrant "
            "graphic bright colourful colorful fun",
    "street": "urban streetwear street utilitarian utility gorpcore cool youthful skater edgy_casual creative",
    "sporty": "sporty sportswear athleisure athletic active activewear outdoor wellness gym",
    "romantic": "romantic feminine ethereal graceful delicate soft dreamy vintage nostalgic whimsical cottagecore "
                "sentimental gentle pretty",
    "edgy": "edgy punk rock grunge dark avant garde androgynous moody industrial rebellious experimental",
}
VIBE_TOKENS = {t: v for v, ts in VIBE_TOKENS.items() for t in ts.split()}
# generic comfort words: count as minimal only when no other archetype maps
WEAK_TOKENS = set("relaxed casual laid back effortless cozy comfort comfortable lounge loungewear basics practical "
                  "functional functionalist organized everyday leisure elevated".split())

OCC_ALIAS = {
    "work": "office", "workwear": "office", "corporate": "office", "office_wear": "office",
    "daily": "everyday", "daily_wear": "everyday", "dailywear": "everyday", "daywear": "everyday",
    "casual_day": "everyday", "daily_use": "everyday", "daily_commute": "everyday", "commute": "everyday",
    "festive_general": "festive", "festive_casual": "festive", "festival": "festive",
    "lounging": "lounge", "loungewear": "lounge", "resort": "vacation", "holiday": "vacation",
    "smart-casual": "smart_casual", "date_night": "date", "romantic_dinner": "date",
    "semi-formal": "semi_formal", "formal_event": "formal",
}
SKU_IMG = re.compile(r"NB[A-Z]\d+_\d+")


# source brand, its short form "Nico..." (Nico Core, NicoLand) and collab tags (TSSxNB)
BRAND = re.compile(r"\bnico\w*|\w*nicobar\w*|\btssx\w*|\w*xnb\b|soultree", re.I)
# source brand + collaborator labels; a sentence still naming one after the rewrites is dropped
OTHER_BRANDS = re.compile(r"\b(rajesh pratap singh|pratap|rps|aparna chandra|singleton social)\b|\s[x×]\s|collaboration",
                          re.I)


def _rewrite(s: str) -> str:
    s = s.replace("\x92", "’")
    s = re.sub(r"^nicobar['’]s\s+", "The ", s, flags=re.I)
    s = re.sub(r"\bnicobar['’]s\s+", "the ", s, flags=re.I)
    s = re.sub(r"\bnicobar\s+(mark|signature|label|logo)", r"house \1", s, flags=re.I)
    # "a/our/subtle Nicobar <noun>" -> "a/our/subtle <noun>"
    s = re.sub(r"\b(a|an|our|the|signature|subtle|playful|thoughtful|quiet|classic)\s+nicobar\s+(?=\w)", r"\1 ", s,
               flags=re.I)
    return re.sub(r"\bthe the\b", "the", s, flags=re.I)


def strip_brand(s: str) -> str:
    """Remove the source brand and collaborator names: rewrite neutral where possible, else drop the sentence."""
    if not s:
        return ""
    out = []
    for sent in re.split(r"(?<=[.!?])\s+", s.strip()):
        sent = _rewrite(sent)
        if not (BRAND.search(sent) or OTHER_BRANDS.search(sent)):
            out.append(sent)
    s = " ".join(out)
    s = BRAND.sub("", s)  # belt and braces for one-sentence fields
    return re.sub(r"\s{2,}", " ", s).replace(" .", ".").replace(" ,", ",").strip()


def clean_desc(s: str) -> str:
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = strip_brand(re.sub(r"\s+", " ", s).strip())
    if len(s) <= 400:
        return s
    cut = s[:400]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[: end + 1] if end > 200 else cut[: cut.rfind(" ")].rstrip(",;:") + "…"


def snake(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def map_vibes(pl: dict, cat: str) -> tuple[list[str], list[str]]:
    vibes, unmapped, weak = [], [], False
    for a in pl.get("styleArchetypes") or []:
        toks = snake(a).split("_")
        hit = [VIBE_TOKENS[t] for t in toks if t in VIBE_TOKENS]
        weak |= any(t in WEAK_TOKENS for t in toks)
        if not hit and not any(t in WEAK_TOKENS for t in toks):
            unmapped.append(snake(a))
        for v in hit:
            if v not in vibes:
                vibes.append(v)
    if not vibes and weak:
        vibes.append("minimal")
    from_arch = bool(vibes)
    st, color, pat = pl.get("statementLevel") or 0, pl.get("colorFamily"), pl.get("pattern")
    # heuristics over catalogue fields so thin vibes (edgy/street/sporty) get representatives
    edgy_cut = cat in ("jacket", "shacket", "blazer", "vest", "waistcoat", "t_shirt", "sweatshirt", "tank_top",
                       "camisole", "jumpsuit", "skirt") or "fitted" == map_fit(pl.get("silhouetteFit"))
    if ((color == "black" and pat in ("solid", "graphic", "animal", "abstract", "colorblock") and (st >= 3 or edgy_cut))
            or pat == "animal") and "edgy" not in vibes:
        vibes.append("edgy")
    if cat in ("t_shirt", "sweatshirt", "joggers") and pat in ("graphic", "colorblock") and "street" not in vibes:
        vibes.append("street")
    if (cat in ("polo", "joggers", "shorts", "skort") or (cat == "t_shirt" and pat in ("stripe", "solid"))) \
            and "sporty" not in vibes:
        vibes.append("sporty")
    if not vibes:
        vibes = ["bold"] if st >= 4 else ["minimal"] if pat == "solid" else ["classic"]
    return vibes[:3], unmapped, from_arch


def map_fit(text: str) -> str:
    t = (text or "").lower()
    if re.search(r"relaxed|oversized|loose|wide|flowy|boxy|fluid|easy|a-line|tent|drape", t):
        return "relaxed"
    if re.search(r"slim|fitted|tailored|bodycon|skinny|tapered", t):
        return "fitted"
    return "regular"


COLOR_WORDS = set("""ivory white off cream ecru natural beige sand tan khaki camel stone oatmeal taupe brown chocolate
coffee rust terracotta ochre mustard yellow lemon gold golden orange peach coral apricot red maroon wine burgundy
crimson brick pink rose blush fuchsia magenta purple lilac lavender violet plum mauve blue navy indigo cobalt sky
teal turquoise aqua denim azure riverside green olive sage mint emerald forest moss lime bottle grey gray charcoal
slate silver black ink multi multicolour multicolor light dark deep pale dusty powder""".split())


def colors_of(title: str, primary: str) -> list[str]:
    out = []
    parts = re.split(r"\s*(?:&|/|,|\band\b)\s*", (primary or "").lower())
    if " - " in title:
        parts += re.split(r"\s*(?:&|/|,|\band\b)\s*", title.rsplit(" - ", 1)[1].lower())
    for part in parts:
        c = " ".join(w for w in part.split() if w in COLOR_WORDS or "-" in w and all(x in COLOR_WORDS for x in w.split("-")))
        if c and c not in ("light", "dark", "deep", "pale", "dusty", "powder") and c not in out:
            out.append(c)
    return out or [(primary or "multi").lower()]


def images(urls: list[str]) -> list[str]:
    sku = [u for u in urls if SKU_IMG.search(u)]
    if not sku:
        return []
    code = SKU_IMG.search(sku[0]).group(0).split("_")[0]
    return [u for u in sku if code in u]  # source order: [0] is the front-facing full view


def norm_occ(occ: list[str]) -> list[str]:
    out = []
    for o in occ or []:
        o = OCC_ALIAS.get(snake(o), snake(o))
        if o and o not in out:
            out.append(o)
    return out


def completeness(pl: dict) -> int:
    keys = ["primaryColor", "colorFamily", "pattern", "formality", "occasions", "styleArchetypes", "silhouetteFit",
            "fabricLook", "pairingPriors", "statementLevel", "stylistOneLiner", "styleDocument"]
    return sum(bool(pl.get(k)) for k in keys)


def load_candidates():
    products = {r["id"]: r for r in json.loads((SRC / "products.json").read_text())}
    enr = {}
    for e in sorted(json.loads((SRC / "enrichment.json").read_text()), key=lambda e: e.get("enriched_at") or ""):
        enr[e["product_id"]] = e["payload"]  # latest enrichment wins
    cands, unmapped, seen_titles = [], Counter(), set()
    for pid in sorted(enr):
        pl, p = enr[pid], products.get(pid)
        if not p:
            continue
        l1, l2 = pl.get("categoryL1"), snake(pl.get("categoryL2") or "")
        cat = CAT_ALIAS.get(l2, l2)
        gp = pl.get("genderPresentation")
        gender = {"feminine": "women", "masculine": "men", "unisex": "unisex"}.get(gp)
        if l1 == "bag":
            slot, cat = "bag", (cat if cat else "bag")
        elif l1 in ("topwear", "bottomwear", "one_piece", "outerwear", "accessory"):
            slot = SLOT_BY_L2.get(cat)
        else:
            continue
        if not slot or not gender or EXCLUDE_WORDS.search(p["title"]) or EXCLUDE_WORDS.search(cat.replace("_", " ")):
            continue
        if slot not in ("bag", "accessory") and gender == "unisex":
            continue
        if gender == "men" and slot in ("bag", "accessory"):
            gender = "unisex"
        imgs = images(p.get("image_urls") or [])
        title = re.sub(r"\s+", " ", re.sub(r"\btssx\w*|\w*xnb\b", "", p["title"], flags=re.I)).strip(" -")
        if BRAND.search(title) or OTHER_BRANDS.search(title):
            continue  # brand-named styles ("Nico Dress", "NicoLand T-shirt") have no neutral rename
        if not imgs or not p.get("price") or title.lower() in seen_titles:
            continue
        seen_titles.add(title.lower())
        vibes, um, from_arch = map_vibes(pl, cat)
        unmapped.update(um)
        cands.append(dict(pid=pid, p=p, pl=pl, gender=gender, slot=slot, cat=cat, imgs=imgs, title=title,
                          vibes=vibes, from_arch=from_arch, base=title.split(" - ")[0].lower()))
    return cands, unmapped


def gain(c, seen, base_cap):
    """Greedy score: quality plus novelty against what this bucket already picked."""
    if c["cat"] == "kurta" and seen["cat"]["kurta"] >= KURTA_CAP or seen["base"][c["base"]] >= base_cap:
        return -1e9
    g = c["quality"]
    g += 2 / (1 + seen["color"][c["pl"].get("colorFamily")])
    g += 1.5 / (1 + seen["form"][c["pl"].get("formality")])
    g += 1.5 / (1 + min(seen["vibe"][v] for v in c["vibes"]))
    g += 1 / (1 + seen["band"][c["band"]])
    g += 1 / (1 + seen["cat"][c["cat"]])
    g -= 1.5 * seen["base"][c["base"]]
    return g


def select(cands):
    """Greedy diversity pick per bucket: quality + novelty in colour, formality, vibe, price band, category."""
    rng = random.Random(SEED)
    buckets = defaultdict(list)
    for c in cands:
        buckets[(c["gender"], c["slot"])].append(c)
    chosen = []
    for key, n in TARGETS.items():
        pool = buckets.get(key, [])
        rng.shuffle(pool)
        prices = sorted(c["p"]["price"] for c in pool) or [0]
        q = [prices[len(prices) * i // 4] for i in (1, 2, 3)]
        seen = defaultdict(Counter)
        base_cap = 2 if len(pool) >= 3 * n else 4  # small pools (men's bottoms/layers) need colourways
        picked = []
        for c in pool:
            c["band"] = sum(c["p"]["price"] > x for x in q)
            c["quality"] = 2 * (len(c["imgs"]) >= 2) + completeness(c["pl"]) / 6 + bool(re.search(r"_1\.", c["imgs"][0]))
        while len(picked) < n and pool:
            best = max(pool, key=lambda c: gain(c, seen, base_cap))
            if gain(best, seen, base_cap) < -1e8:
                break
            pool.remove(best)
            picked.append(best)
            seen["color"][best["pl"].get("colorFamily")] += 1
            seen["form"][best["pl"].get("formality")] += 1
            seen["band"][best["band"]] += 1
            seen["cat"][best["cat"]] += 1
            seen["base"][best["base"]] += 1
            for v in best["vibes"]:
                seen["vibe"][v] += 1
        chosen += picked
    return chosen


def sizes(gender: str, slot: str, pid: str) -> list[str]:
    if slot in ("bag", "accessory"):
        return ["One Size"]
    full = ["S", "M", "L", "XL", "XXL"] if gender == "men" else ["XS", "S", "M", "L", "XL"]
    r = random.Random(int(hashlib.sha256(pid.encode()).hexdigest()[:8], 16))
    keep = sorted(r.sample(range(5), r.randint(3, 5)))
    return [full[i] for i in keep]


def to_row(c) -> dict:
    pl = c["pl"]
    pp = pl.get("pairingPriors") or {}
    return {
        "id": None,
        "title": c["title"],
        "description": clean_desc(c["p"].get("description")),
        "price": int(round(c["p"]["price"])),
        "currency": "INR",
        "gender": c["gender"],
        "slot": c["slot"],
        "category": c["cat"],
        "colors": colors_of(c["title"], pl.get("primaryColor") or ""),
        "color_family": pl.get("colorFamily") or "multi",
        "pattern": pl.get("pattern") or "solid",
        "vibes": c["vibes"],
        "formality": max(1, min(5, int(pl.get("formality") or 2))),
        "fit": map_fit(pl.get("silhouetteFit")),
        "occasions": norm_occ(pl.get("occasions")),
        "statement_level": int(pl.get("statementLevel") or 2),
        "fabric": strip_brand(pl.get("fabricLook") or ""),
        "one_liner": strip_brand(pl.get("stylistOneLiner") or ""),
        "pairing": {"colors": [strip_brand(x) for x in pp.get("colorDirections") or []],
                    "avoid": [strip_brand(x) for x in pp.get("avoid") or []]},
        "image_url": c["imgs"][0],
        "image_url_alt": c["imgs"][1] if len(c["imgs"]) > 1 else c["imgs"][0],
        "vto_ref_url": c["imgs"][0],
        "vto_ready": True,
        "sizes_in_stock": [],
        "product_url": None,
        "_pid": c["pid"],
    }


def main():
    cands, unmapped = load_candidates()
    with_vibe = sum(1 for c in cands if c["from_arch"])
    print(f"candidates: {len(cands)}; unmapped archetypes (top 25): {unmapped.most_common(25)}")
    rows = [to_row(c) for c in select(cands)]
    order = {"women": 0, "men": 1, "unisex": 2}
    slots = ["top", "bottom", "one_piece", "layer", "bag", "accessory"]
    rows.sort(key=lambda r: (order[r["gender"]], slots.index(r["slot"]), r["title"].lower(), r["_pid"]))
    for i, r in enumerate(rows, 1):
        r["id"] = f"nl-{i:04d}"
        r["product_url"] = f"/p/{r['id']}"
        r["sizes_in_stock"] = sizes(r["gender"], r["slot"], r.pop("_pid"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")
    assert "nicobar" not in OUT.read_text().lower(), "brand name leaked"

    print(f"\nwrote {len(rows)} rows -> {OUT.relative_to(ROOT)}  (archetype->vibe coverage {with_vibe}/{len(cands)} = {with_vibe / len(cands):.1%}; rest by heuristics)\n")
    print(f"{'gender':8}{'slot':11}{'n':>4}{'min':>8}{'median':>8}{'max':>8}")
    groups = defaultdict(list)
    for r in rows:
        groups[(r["gender"], r["slot"])].append(r["price"])
    for (g, s), ps in groups.items():
        ps.sort()
        print(f"{g:8}{s:11}{len(ps):>4}{ps[0]:>8}{ps[len(ps) // 2]:>8}{ps[-1]:>8}")
    print("\nvibes:", dict(Counter(v for r in rows for v in r["vibes"]).most_common()))
    print("colour families:", dict(Counter(r["color_family"] for r in rows).most_common()))
    print("formality:", dict(sorted(Counter(r["formality"] for r in rows).items())))
    print("fit:", dict(Counter(r["fit"] for r in rows)))
    print("categories:", dict(Counter(r["category"] for r in rows).most_common()))


if __name__ == "__main__":
    main()
