"""
geocode_stops.py
================
STEP 1 of the RutaSmart Random Forest training pipeline.

Geocodes Malanday-Recto corridor stop names via the Nominatim OpenStreetMap API
(no API key required). Writes forward and return CSVs plus a failures log.

Nominatim usage policy: max 1 request per second — enforced via _DELAY_S.
User-Agent is set to "RutaSmart-Thesis/1.0" as required by Nominatim policy.

Usage (standalone):
    python -m app.analytics.geocode_stops

Outputs written to rutasmart-backend/data/:
    ground_truth_stops_forward.csv
    ground_truth_stops_return.csv
    geocode_failures.csv    ← manually fill in lat/lon for these
"""

import csv
import json
import logging
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

_BACKEND_ROOT  = Path(__file__).resolve().parents[2]
_DATA_DIR      = _BACKEND_ROOT / "data"
_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_USER_AGENT    = "RutaSmart-Thesis/1.0"
_DELAY_S       = 1.1
# viewbox: left(west), top(north), right(east), bottom(south)
_VIEWBOX       = "120.90,14.75,121.05,14.55"

# ── Forward direction stops (Malanday → Recto) ────────────────────────────────

FORWARD_STOPS: List[str] = [
    "C.P. Enerton Fuel Station, MacArthur Highway, Valenzuela City",
    "MacArthur Highway / E. Pantaleon Intersection, Valenzuela City",
    "MacArthur / Del Pilar Intersection, Malanday, Valenzuela City",
    "Malanday Tricycle and Pedicab Terminal, MacArthur Highway, Malanday, Valenzuela City",
    "Mercury Drug Store, MacArthur Highway, Malanday, Valenzuela City",
    "Marisyl School, MacArthur Highway, Malanday Valenzuela City",
    "MacArthur Highway / Santiago Road Interchange, Dalandanan, Valenzuela City",
    "Ign Pharmacy, MacArthur Highway, Dalandanan, Valenzuela City",
    "Dalandanan Fire sub station, MacArthur Highway, Dalandanan, Valenzuela City",
    "Dalandanan Health Centre, MacArthur Highway, Dalandanan, Valenzuela City",
    "Santos Encamacion Elementary School, MacArthur Highway, Dalandanan, Valenzuela City",
    "Iglesia Ni Cristo, MacArthur Highway, Dalandanan, Valenzuela City",
    "Galdrine Industrial Corp., MacArthur Highway, Dalandanan, Valenzuela City",
    "MacArthur Highway / San Miguel Interchange, Dalandanan, Valenzuela City",
    "Parish Church of Isidro Labrador, MacArthur Highway, Malinta, Valenzuela City",
    "Jollibee, MacArthur Highway, Malinta, Valenzuela City",
    "Malinta Elementary School, MacArthur Highway, Malinta, Valenzuela City",
    "MacArthur Highway / Maysan Road Intersection, Malinta, Valenzuela City",
    "Valenzuela City People's Park near City Hall, MacArthur Highway, Valenzuela City",
    "Bureau of Telecom Training Institute, MacArthur Highway, Valenzuela City",
    "Karuhatan Public Market, MacArthur Highway, Valenzuela City",
    "Macro LPG, MacArthur Highway, Valenzuela City",
    "MacArthur Highway / San Francisco, Karuhatan, Valenzuela City",
    "SM Center Valenzuela, MacArthur Highway, Valenzuela City",
    "MacArthur Highway / Cayetano Intersection, Valenzuela City",
    "Novo Dep. Store, MacArthur Highway, Valenzuela City",
    "Bread of Life, MacArthur Highway, Valenzuela City",
    "Our Lady of Fatima University College of Medicine, MacArthur Highway, Valenzuela City",
    "Bearsea Auto Supply, MacArthur Highway, Valenzuela City",
    "Calalang General Hospital, MacArthur Highway, Malabon City",
    "CDC Manufacturing, MacArthur Highway, Malabon City",
    "MacArthur Highway / Del Monte Intersection, Malabon City",
    "Malabon City / Victoneta Avenue Intersection, Malabon City",
    "Potrero Heights Elementary School, MacArthur Highway, Malabon City",
    "MacArthur Highway / Lanzones Intersection, Malabon City",
    "Floresco North Mortuary, MacArthur Highway, Caloocan City",
    "General Rosendo Simon / Calle Uno, Caloocan City",
    "Bonifacio Market, MacArthur Highway, Caloocan City",
    "Hypermarket Monumento, Caloocan City",
    "Araneta Square Mall, Samson Road, Caloocan City",
    "Ever Gotesco Grand Central, Rizal Avenue, Caloocan City",
    "MacDonalds, Rizal Avenue, Caloocan City",
    "Rizal Avenue / Asistio Intersection, Caloocan City",
    "Rizal Ave. / 8th Ave. West, Caloocan City",
    "Rizal Ave. / 7th Ave. West, Caloocan City",
    "Asia Trust Bank, Rizal Avenue, Caloocan City",
    "JCSGO Caloocan, Rizal Ave. / 6th Ave. West, Caloocan City",
    "J. Teodoro / 5th Ave. West, Caloocan City",
    "Circumferential Road 3 / M.H. Del Pilar St, Caloocan City",
    "3rd Avenue West, Caloocan City",
    "Banco De Oro, Rizal Avenue, Caloocan City",
    "Baliwag Transit Bus Station, Rizal Avenue, Caloocan City",
    "Rizal Avenue / Road 1 Intersection, Caloocan City",
    "LRT Papa Station, Rizal Avenue, Caloocan City",
    "P. Sevilla Street / 2nd Avenue West Intersection, Caloocan City",
    "Rizal Avenue / Jose Abad Santos Avenue Interchange, Caloocan City",
    "Jose Abad Santos Avenue / Morong Intersection, Quezon City",
    "Jose Abad Santos Avenue / Corregidor Intersection, Quezon City",
    "Jose Abad Santos Avenue, Quezon City",
    "Jose Abad Santos Avenue / T Bugallon Street Intersection, Quezon City",
    "T Bugallon Street, Quezon City",
    "T Bugallon Street / Cavite Intersection, Quezon City",
    "T. Mapua / Laguna Intersection, Quezon City",
    "Tomas Mapua / Batangas Intersection, City of Manila",
    "Tomas Mapua / Camarines Intersection, City of Manila",
    "Camarines, City of Manila",
    "Felix Huertas, City of Manila",
    "San Lazaro / Oroquieta Intersection, City of Manila",
    "Quiricada / Felix Huertas Intersection, City of Manila",
    "Oroquieta / Alvarez Intersection, City of Manila",
    "Oroquieta / Bambang Intersection, City of Manila",
    "Oroquieta / Mayhaligue Intersection, City of Manila",
    "Sulu, City of Manila",
    "Quezon Blvd. / P. Paredes Intersection, City of Manila",
    "Isetann, City of Manila",
    "Recto LRT, City of Manila",
]

# ── Return direction stops (Recto → Malanday) ─────────────────────────────────

RETURN_STOPS: List[str] = [
    "Recto LRT, City of Manila",
    "Oroquieta, City of Manila",
    "Lope De Vega / Oroquieta Intersection, City of Manila",
    "Oroquieta / Mayhaligue Intersection, City of Manila",
    "Oroquieta / Bambang Intersection, City of Manila",
    "Oroquieta / Alvarez Intersection, City of Manila",
    "San Lazaro / Oroquieta Intersection, City of Manila",
    "Camarines, City of Manila",
    "Oroquieta / Batangas Intersection, City of Manila",
    "Cavite, Quezon City",
    "Light Rail Transit Line / Bulacan Intersection, Quezon City",
    "Rizal Avenue near Aurora Blvd Intersection, Quezon City",
    "Rizal Avenue, Quezon City",
    "Rizal Avenue / Mt. Samat Intersection, Quezon City",
    "Rizal Avenue / Jose Abad Santos Avenue Interchange, Caloocan City",
    "P. Sevilla Street / 2nd Avenue West Intersection, Caloocan City",
    "LRT Papa Station, Rizal Avenue, Caloocan City",
    "Rizal Avenue / Road 1 Intersection, Caloocan City",
    "Baliwag Transit Bus Station, Rizal Avenue, Caloocan City",
    "Banco De Oro, Rizal Avenue, Caloocan City",
    "3rd Avenue West, Caloocan City",
    "4th Ave. East / M.H. Del Pilar St, Caloocan City",
    "5th Ave. West / Maria Clara St, Caloocan City",
    "Circumferential Road 3 / M.H. Del Pilar St, Caloocan City",
    "Asia Trust Bank, Rizal Avenue, Caloocan City",
    "Rizal Ave. / 7th Ave. West, Caloocan City",
    "Rizal Ave. / 8th Ave. West, Caloocan City",
    "Rizal Avenue / Asistio Intersection, Caloocan City",
    "MacDonalds, Rizal Avenue, Caloocan City",
    "Ever Gotesco Grand Central, Rizal Avenue, Caloocan City",
    "Monumento, Rizal Avenue, Caloocan City",
    "Araneta Square Mall, Samson Road, Caloocan City",
    "Bonifacio Market, MacArthur Highway, Caloocan City",
    "General Rosendo Simon / Calle Uno, Caloocan City",
    "Floresco North Mortuary, MacArthur Highway, Caloocan City",
    "MacArthur Highway / Lanzones Intersection, Malabon City",
    "Potrero Heights Elementary School, MacArthur Highway, Malabon City",
    "Malabon City / Victoneta Avenue Intersection, Malabon City",
    "MacArthur Highway / Del Monte Intersection, Malabon City",
    "CDC Manufacturing, MacArthur Highway, Malabon City",
    "Calalang General Hospital, MacArthur Highway, Malabon City",
    "Bearsea Auto Supply, MacArthur Highway, Valenzuela City",
    "Our Lady of Fatima University College of Medicine, MacArthur Highway, Valenzuela City",
    "Bread of Life, MacArthur Highway, Valenzuela City",
    "Novo Dep. Store, MacArthur Highway, Valenzuela City",
    "MacArthur Highway / Cayetano Intersection, Valenzuela City",
    "SM Center Valenzuela, MacArthur Highway, Valenzuela City",
    "MacArthur Highway / San Francisco, Karuhatan, Valenzuela City",
    "Macro LPG, MacArthur Highway, Valenzuela City",
    "Karuhatan Public Market, MacArthur Highway, Valenzuela City",
    "Bureau of Telecom Training Institute, MacArthur Highway, Valenzuela City",
    "South Supermarket near City Hall, MacArthur Highway, Valenzuela City",
    "Flying V Gas near City Hall, MacArthur Highway, Valenzuela City",
    "MacArthur Highway / Maysan Road Intersection, Malinta, Valenzuela City",
    "Jollibee near Governor Santiago Road, MacArthur Highway, Malinta, Valenzuela City",
    "Parish Church of Isidro Labrador, MacArthur Highway, Malinta, Valenzuela City",
    "MacArthur Highway / San Miguel Interchange, Dalandanan, Valenzuela City",
    "Galdrine Industrial Corp., MacArthur Highway, Dalandanan, Valenzuela City",
    "Iglesia Ni Cristo, MacArthur Highway, Dalandanan, Valenzuela City",
    "Santos Encamacion Elementary School, MacArthur Highway, Dalandanan, Valenzuela City",
    "Dalandanan Health Centre, MacArthur Highway, Dalandanan, Valenzuela City",
    "Dalandanan Fire sub station, MacArthur Highway, Dalandanan, Valenzuela City",
    "Ign Pharmacy, MacArthur Highway, Dalandanan, Valenzuela City",
    "MacArthur Highway / Santiago Road Interchange, Dalandanan, Valenzuela City",
    "Marisyl School, MacArthur Highway, Malanday, Valenzuela City",
    "Mercury Drug Store, MacArthur Highway, Malanday, Valenzuela City",
    "Malanday Tricycle and Pedicab Terminal, MacArthur Highway, Malanday, Valenzuela City",
    "MacArthur / Del Pilar Intersection, Malanday, Valenzuela City",
    "MacArthur Highway / E. Pantaleon Intersection, Valenzuela City",
    "C.P. Enerton Fuel Station, MacArthur Highway, Valenzuela City",
]


# ── Geocoding ─────────────────────────────────────────────────────────────────

def geocode_stop(name: str) -> Optional[Tuple[float, float]]:
    """
    Query Nominatim for a single stop name.

    Returns (lat, lon) on success, None if the stop cannot be located.
    Caller must enforce the 1-second inter-request delay.
    """
    params = urllib.parse.urlencode({
        "q":            name,
        "format":       "json",
        "limit":        1,
        "countrycodes": "ph",
        "viewbox":      _VIEWBOX,
        "bounded":      0,
    })
    url = f"{_NOMINATIM_URL}?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data:
            return float(data[0]["lat"]), float(data[0]["lon"])
        return None
    except Exception as exc:
        logger.warning("Nominatim request failed for %r: %s", name, exc)
        return None


def geocode_list(
    stop_names: List[str],
    direction: str,
) -> Tuple[List[dict], List[dict]]:
    """
    Geocode a list of stop names with live progress printing.

    Returns (successes, failures) — each a list of dicts with keys:
    name, latitude, longitude, direction.
    """
    successes: List[dict] = []
    failures:  List[dict] = []
    total = len(stop_names)

    for idx, name in enumerate(stop_names, start=1):
        result = geocode_stop(name)
        if result is not None:
            lat, lon = result
            successes.append({"name": name, "latitude": lat, "longitude": lon, "direction": direction})
            print(f"  Geocoded {idx:>3}/{total}: {name[:55]!r:<57}  → ({lat:.5f}, {lon:.5f})")
        else:
            failures.append({"name": name, "direction": direction, "latitude": "", "longitude": ""})
            print(f"  FAILED   {idx:>3}/{total}: {name[:55]!r}")
        if idx < total:
            time.sleep(_DELAY_S)

    return successes, failures


def run_geocoding() -> Tuple[int, int, int]:
    """
    Geocode all forward and return stops and persist three CSV files.

    Returns (n_forward_ok, n_return_ok, n_failures).
    Raises OSError if output files cannot be written.
    """
    _DATA_DIR.mkdir(parents=True, exist_ok=True)

    all_failures: List[dict] = []
    csv_fields = ["name", "latitude", "longitude", "direction"]

    print(f"\n── Forward stops ({len(FORWARD_STOPS)}) ──")
    fwd_ok, fwd_fail = geocode_list(FORWARD_STOPS, "forward")
    all_failures.extend(fwd_fail)

    print(f"\n── Return stops ({len(RETURN_STOPS)}) ──")
    ret_ok, ret_fail = geocode_list(RETURN_STOPS, "return")
    all_failures.extend(ret_fail)

    for path, rows in [
        (_DATA_DIR / "ground_truth_stops_forward.csv", fwd_ok),
        (_DATA_DIR / "ground_truth_stops_return.csv",  ret_ok),
    ]:
        with open(path, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=csv_fields)
            writer.writeheader()
            writer.writerows(rows)
        logger.info("Wrote %d rows → %s", len(rows), path)

    fail_path = _DATA_DIR / "geocode_failures.csv"
    with open(fail_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=csv_fields)
        writer.writeheader()
        writer.writerows(all_failures)
    if all_failures:
        logger.info("%d stops could not be geocoded → %s", len(all_failures), fail_path)

    return len(fwd_ok), len(ret_ok), len(all_failures)


# ── Standalone entry point ────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
    print("RutaSmart — Geocode Ground Truth Stops")
    try:
        n_fwd, n_ret, n_fail = run_geocoding()
    except OSError as exc:
        print(f"ERROR: {exc}")
        sys.exit(1)
    print(f"\nForward geocoded : {n_fwd}/{len(FORWARD_STOPS)}")
    print(f"Return  geocoded : {n_ret}/{len(RETURN_STOPS)}")
    print(f"Failures logged  : {n_fail}  (see data/geocode_failures.csv)")
