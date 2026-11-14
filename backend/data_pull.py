import requests
import pandas as pd


def get_power(lat, lon, start=2005, end=2024):
    url = "https://power.larc.nasa.gov/api/temporal/daily/point"
    params = {
        "parameters": "T2M,T2M_MAX,PRECTOTCORR,GWETROOT,ALLSKY_SFC_SW_DWN",
        "community": "AG",
        "latitude": lat,
        "longitude": lon,
        "start": f"{start}0101",
        "end": f"{end}1231",
        "format": "JSON",
    }
    r = requests.get(url, params=params, timeout=120)
    r.raise_for_status()
    data = r.json()["properties"]["parameter"]
    df = pd.DataFrame(data)
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    return df.replace(-999, float("nan"))