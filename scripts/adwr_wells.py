"""Groundwater levels near the demo farms from ADWR's Groundwater Site Inventory.

Downloads ADWR's public GWSI bundle (the link on azwater.gov/gis-data-and-maps),
reads the water-level table and keeps static measurements in wells within about
6 miles of each farm. Writes terra/data/wells.json, which fetch-data.mjs folds
into demo.json. Run by the Pages workflow:  python3 scripts/adwr_wells.py

Well locations come from the 15-digit site ID, which encodes latitude and
longitude in degrees, minutes and seconds (USGS/ADWR convention).
"""
import io
import json
import re
import statistics
import sys
import urllib.request
import zipfile
from datetime import date, timedelta

from openpyxl import load_workbook

FARMS = {"casa": (32.88, -111.77), "cool": (32.985, -111.52), "mari": (33.09, -112.02), "buck": (33.38, -112.64)}
PAGE = "https://www.azwater.gov/gis-data-and-maps"
# Remark codes from GWSI_MR_CODES: drop pumping, recently pumped, nearby pumping,
# dry, flowing, obstructed, plugged, destroyed and similar non-static readings.
BAD_REMARKS = set("CDEFGHIJKMNOPRSTVWX")
DLAT, DLON = 0.09, 0.11
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "Accept": "*/*"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
        return r.read()


def site_latlon(site):
    s = str(site).strip()
    if not re.fullmatch(r"\d{15}", s):
        return None
    lat = int(s[0:2]) + int(s[2:4]) / 60 + int(s[4:6]) / 3600
    lon = -(int(s[6:9]) + int(s[9:11]) / 60 + int(s[11:13]) / 3600)
    return lat, lon


def main():
    html = get(PAGE).decode("utf-8", "ignore")
    m = re.search(r'href="([^"]*GWSI_ZIP_\d+\.zip)"', html)
    if not m:
        print("ADWR wells: GWSI download link not found")
        return 1
    url = m.group(1)
    if url.startswith("/"):
        url = "https://www.azwater.gov" + url
    print("ADWR wells: downloading", url)
    z = zipfile.ZipFile(io.BytesIO(get(url)))
    name = next(n for n in z.namelist() if n.endswith("GWSI_WW_LEVELS.xlsx"))
    wb = load_workbook(io.BytesIO(z.read(name)), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = ws.iter_rows(values_only=True)
    head = [str(h) for h in next(rows)]
    i_site = head.index("WLWA_SITE_WELL_SITE_ID")
    i_date = head.index("WLWA_MEASUREMENT_DATE")
    i_dtw = head.index("WLWA_DEPTH_TO_WATER")
    i_rem = head.index("WLWA_REMARK_CODE")
    near = {k: {} for k in FARMS}
    for r in rows:
        ll = site_latlon(r[i_site])
        if not ll or r[i_dtw] is None:
            continue
        rem = (r[i_rem] or "").strip()
        if rem and rem in BAD_REMARKS:
            continue
        d = r[i_date]
        if isinstance(d, (int, float)):
            d = date(1899, 12, 30) + timedelta(days=int(d))
        try:
            year = d.year
        except AttributeError:
            continue
        if year < 1995:
            continue
        for k, (la, lo) in FARMS.items():
            if abs(ll[0] - la) <= DLAT and abs(ll[1] - lo) <= DLON:
                w = near[k].setdefault(str(r[i_site]), {"lat": round(ll[0], 4), "lon": round(ll[1], 4), "years": {}})
                w["years"].setdefault(year, []).append(float(r[i_dtw]))
    out = {}
    for k, wells in near.items():
        keep = []
        for sid, w in wells.items():
            ys = sorted(w["years"])
            if len(ys) < 6 or ys[-1] - ys[0] < 10:
                continue
            keep.append({"id": f"ADWR-{sid}", "lat": w["lat"], "lon": w["lon"],
                         "series": [[y, round(statistics.median(w["years"][y]), 1)] for y in ys]})
        out[k] = keep
        print(f"ADWR wells {k}: {len(keep)} wells with long records")
    with open("terra/data/wells.json", "w") as f:
        json.dump({"source": "Arizona Department of Water Resources, GWSI (" + url.rsplit("/", 1)[-1] + ")", "farms": out}, f)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # never block the deploy on this optional data
        print("ADWR wells: skipped", e)
        sys.exit(0)
