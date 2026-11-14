from itertools import product
from pathlib import Path
import pandas as pd

BASE = Path(__file__).resolve().parent.parent


def load_crops():
    return pd.read_csv(BASE / "data" / "crops.csv").set_index("crop").to_dict("index")


def generate(C, length=4):
    seen, out = set(), []
    for seq in product(C.keys(), repeat=length):
        if any(C[seq[i]]["family"] == C[seq[(i + 1) % length]]["family"] for i in range(length)):
            continue                      # no same family back to back
        if not any(C[c]["fixes_nitrogen"] for c in seq):
            continue                      # need a nitrogen fixer or cover crop
        if len(set(seq)) < 3:
            continue                      # at least 3 different crops
        canon = min(seq[i:] + seq[:i] for i in range(length))
        if canon in seen:
            continue                      # skip rotations that are just shifted copies
        seen.add(canon)
        out.append(canon)
    return out