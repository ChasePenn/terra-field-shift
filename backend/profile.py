from pathlib import Path
import numpy as np
import pandas as pd
from backend.data_pull import get_power

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"


def load_climate(lat, lon):
    DATA.mkdir(exist_ok=True)
    path = DATA / f"climate_{lat:.2f}_{lon:.2f}.csv"
    if path.exists():
        df = pd.read_csv(path, index_col=0, parse_dates=True)
    else:
        df = get_power(lat, lon)
        df = df.apply(pd.to_numeric, errors="coerce")
        df.to_csv(path)
    return df.astype(float)


def count_dry_spells(rain, min_len=14):
    count = run = 0
    for r in (rain.fillna(0) < 1).values:
        if r:
            run += 1
        else:
            if run >= min_len:
                count += 1
            run = 0
    if run >= min_len:
        count += 1
    return count


def build_profile(lat, lon, future=False):
    df = load_climate(lat, lon)
    years = df.index.year.nunique()
    rain = df["PRECTOTCORR"]
    annual = rain.groupby(df.index.year).sum()

    rain_mm = float(annual.mean())
    rain_cv = float(annual.std() / annual.mean()) if annual.mean() else 0.0
    heat_days = float((df["T2M_MAX"] > 35).groupby(df.index.year).sum().mean())
    dry_spells = count_dry_spells(rain) / years
    wetness = float(df["GWETROOT"].mean())

    if future:  # illustrative warming scenario; replace with NEX-GDDP deltas later
        rain_mm *= 0.9
        heat_days = heat_days * 1.5 + 3
        dry_spells *= 1.2
        wetness *= 0.95

    rain_term = float(np.clip(1 - (rain_mm - 250) / 750, 0, 1))
    return {
        "rain_mm": round(rain_mm, 1),
        "rain_cv": round(rain_cv, 2),
        "heat_days": round(heat_days, 1),
        "dry_spells": round(dry_spells, 2),
        "soil_wetness": round(wetness, 2),
        "water_stress": round(0.6 * rain_term + 0.4 * (1 - wetness), 2),
        "heat_stress": round(float(np.clip(heat_days / 60, 0, 1)), 2),
        "drought_stress": round(float(np.clip(dry_spells / 6, 0, 1)), 2),
    }