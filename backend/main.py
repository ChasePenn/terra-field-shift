from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.profile import build_profile
from backend.rotations import load_crops, generate
from backend.scoring import score_rotation, explain

BASE = Path(__file__).resolve().parent.parent
app = FastAPI()
CROPS = load_crops()
ROTATIONS = generate(CROPS)


class Query(BaseModel):
    lat: float
    lon: float
    organic_matter: str = "medium"   # low / medium / high
    texture: str = "loam"            # sandy / loam / clay
    w_water: float = 1
    w_soil: float = 1
    w_climate: float = 1
    w_income: float = 1
    future: bool = False


@app.post("/recommend")
def recommend(q: Query):
    lat, lon = round(q.lat, 2), round(q.lon, 2)
    p = build_profile(lat, lon, q.future)
    adj = {"sandy": 0.1, "clay": -0.05}.get(q.texture, 0)
    p["water_stress"] = round(min(1, max(0, p["water_stress"] + adj)), 2)
    weights = (q.w_water, q.w_soil, q.w_climate, q.w_income)

    scored = sorted(
        ((score_rotation(s, CROPS, p, q.organic_matter, weights), s) for s in ROTATIONS),
        key=lambda x: -x[0]["total"])

    results, seen = [], set()
    for sc, seq in scored:
        key = frozenset(seq)
        if key in seen:               # show variety: one result per crop set
            continue
        seen.add(key)
        results.append({"rotation": [c.replace("_", " ") for c in seq],
                        "scores": sc,
                        "why": explain(seq, CROPS, p, q.organic_matter)})
        if len(results) == 5:
            break
    return {"profile": p, "results": results}


app.mount("/", StaticFiles(directory=BASE / "frontend", html=True), name="frontend")