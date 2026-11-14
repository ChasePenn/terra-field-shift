def norm(x):
    return (x - 1) / 4


def score_rotation(seq, C, p, om, weights):
    n = len(seq)
    # Water: high-water crops are penalized where water is scarce
    water = 100 * (1 - sum(norm(C[c]["water_need"]) for c in seq) / n * p["water_stress"])

    # Soil health: nitrogen fixers, ground cover, diversity, fixer followed by a non-fixer
    nfix = sum(C[c]["fixes_nitrogen"] for c in seq)
    cover = sum(norm(C[c]["soil_cover_benefit"]) for c in seq) / n
    fams = len({C[c]["family"] for c in seq})
    follow = sum(1 for i in range(n)
                 if C[seq[i]]["fixes_nitrogen"] and not C[seq[(i + 1) % n]]["fixes_nitrogen"])
    cover_w = 36 if om == "low" else 30
    soil = min(100, 20 * min(nfix, 2) + cover_w * cover + 15 * (fams - 1) / 3
               + 15 * min(1, follow / max(1, nfix)))

    # Climate resilience: crop tolerance vs. site heat and drought stress
    climate = 100 * sum(
        1 - 0.5 * p["heat_stress"] * (1 - norm(C[c]["heat_tolerance"]))
          - 0.5 * p["drought_stress"] * (1 - norm(C[c]["drought_tolerance"]))
        for c in seq) / n

    income = 100 * sum(norm(C[c]["income"]) for c in seq) / n

    ww, ws, wc, wi = weights
    total_w = (ww + ws + wc + wi) or 1
    total = (ww * water + ws * soil + wc * climate + wi * income) / total_w
    return {"water": round(water), "soil": round(soil), "climate": round(climate),
            "income": round(income), "total": round(total, 1)}


def explain(seq, C, p, om):
    n, notes = len(seq), []
    pretty = lambda c: c.replace("_", " ")
    fixers = sorted({c for c in seq if C[c]["fixes_nitrogen"]})
    if fixers:
        extra = " This matters because your soil organic matter is low." if om == "low" else ""
        notes.append(f"{', '.join(map(pretty, fixers))} put nitrogen back into the soil.{extra}")
    avg_wn = sum(C[c]["water_need"] for c in seq) / n
    if p["water_stress"] >= 0.5:
        notes.append(f"Your site is water-limited (about {p['rain_mm']:.0f} mm rain per year); "
                     f"this rotation averages a water need of {avg_wn:.1f} out of 5.")
    if p["heat_stress"] >= 0.4:
        notes.append(f"About {p['heat_days']:.0f} days per year exceed 35°C, so heat tolerance counts.")
    if p["drought_stress"] >= 0.4:
        notes.append(f"Dry spells of 14+ days happen about {p['dry_spells']:.1f} times per year, "
                     f"so drought tolerance counts.")
    covers = sorted({c for c in seq if C[c]["soil_cover_benefit"] >= 4})
    if covers:
        notes.append(f"{', '.join(map(pretty, covers))} protect the soil surface from erosion.")
    return notes or ["A balanced rotation that fits your priorities."]