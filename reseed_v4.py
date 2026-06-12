"""
RutaSmart reseed v4 — realistic data variance for thesis defense.

Improvements over v3:
  1. Dates spread May 27 – June 11 2026 (non-sequential, natural driver gaps)
  2. Natural departure minute variance (never :00 or :30 exactly)
  3. Per-trip quality profile → GOOD% 65–97% (not flat 100%)
  4. Per-trip log count variance 1,400–2,100 via n_interp/n_dwell tuning
  5. Dwell pings always GOOD (DBSCAN cluster density preserved)

GOOD% = (good_moving + all_dwell) / total_logs
Bad logs: ACCEPTABLE (acc 18–50 m) or POOR (acc >50 m)
POOR = 20% of bad logs, ACCEPTABLE = 80%.

Run:
  DATABASE_URL=<railway_url> python reseed_v4.py
"""

import os, sys, uuid, random
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "rutasmart-backend"))

if "DATABASE_URL" not in os.environ:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "rutasmart-backend", ".env"))

from app.database import SessionLocal
from app.models.trip import Trip
from app.models.gps_log import GPSLog, GPSQualityEnum

# ── Corridors (unchanged from v3) ─────────────────────────────────────────────

CORRIDOR = [
    (14.719025,120.9575194),(14.7186437,120.9573102),(14.7183142,120.9571868),
    (14.7179251,120.9571063),(14.7174581,120.9571921),(14.7172116,120.9572672),
    (14.7169548,120.9573423),(14.7166098,120.9574684),(14.7161234,120.9576307),
    (14.7157407,120.9577607),(14.7146223,120.9580675),(14.7135038,120.9584602),
    (14.7123853,120.9587884),(14.7112668,120.9591811),(14.7101483,120.9595415),
    (14.7090299,120.9599019),(14.7067929,120.9606013),(14.7045715,120.9612846),
    (14.7023293,120.9620537),(14.7000664,120.9627692),(14.697845, 120.9633988),
    (14.696745, 120.9638065),(14.6956034,120.9641927),(14.6943477,120.9640639),
    (14.6930712,120.9640639),(14.6927754,120.9642088),(14.6924693,120.9645253),
    (14.6924745,120.9649491),(14.6925108,120.9653729),(14.6927806,120.966553),
    (14.6928429,120.9677332),(14.6928273,120.9686183),(14.6925627,120.9695035),
    (14.6920749,120.9712308),(14.6914522,120.9726363),(14.6910578,120.9732317),
    (14.6905389,120.9736555),(14.689431, 120.9742671),(14.6882816,120.9748786),
    (14.6860244,120.9761661),(14.6849061,120.9768152),(14.6837671,120.9773999),
    (14.6815098,120.9785908),(14.6805472,120.979079), (14.679543, 120.9794813),
    (14.6775347,120.9802645),(14.6755472,120.9810155),(14.6735389,120.9818094),
    (14.6729239,120.9819623),(14.672309, 120.9820293),(14.6710791,120.9819918),
    (14.6685985,120.982024), (14.6678668,120.9821715),(14.6673323,120.9826087),
    (14.6669534,120.9829936),(14.6665746,120.983357), (14.666175, 120.9837312),
    (14.6657339,120.984041), (14.665512, 120.984151), (14.6652486,120.9841537),
    (14.663767, 120.9840947),(14.6627731,120.9840893),(14.6618416,120.9840732),
    (14.6608425,120.9840544),(14.6598435,120.9839928),(14.6577312,120.9838909),
    (14.657408, 120.9836411),(14.6570017,120.9835415),(14.6567912,120.9838144),
    (14.6559549,120.9838667),(14.6532652,120.9838426),(14.6508973,120.9836897),
    (14.6484878,120.9835797),(14.6461354,120.9834697),(14.643783, 120.9834026),
    (14.6414514,120.9833356),(14.6388499,120.9832256),(14.6378053,120.9829579),
    (14.6371343,120.9826044),(14.6354602,120.9818115),(14.6337862,120.9810615),
    (14.6319875,120.9804403),(14.6305549,120.9798663),(14.6292884,120.979464),
    (14.6278974,120.9789973),(14.6265894,120.9785306),(14.6257493,120.9784616),
    (14.6256247,120.9796149),(14.6249811,120.9804008),(14.6242959,120.9811009),
    (14.6230553,120.9810633),(14.622993, 120.9819646),(14.6211919,120.9818921),
    (14.6193907,120.9818626),(14.6193648,120.9833379),(14.6192973,120.9848131),
    (14.6171327,120.9847433),(14.6156819,120.9846065),(14.614231, 120.9844697),
    (14.6126088,120.9843517),(14.6109452,120.9842337),(14.6092815,120.9840942),
    (14.6076178,120.9840406),(14.6075347,120.9855158),(14.6072882,120.9858537),
    (14.6066679,120.9857625),(14.6049859,120.9854353),(14.6034701,120.9849794),
    (14.6033975,120.9845663),(14.6034961,120.9840567),
]

RETURN_CORRIDOR = [
    (14.6036336,120.9829462),(14.6036829,120.9826833),(14.6037115,120.9824205),
    (14.6040631,120.9824687),(14.6043941,120.9825385),(14.6047354,120.9826189),
    (14.6050767,120.9826887),(14.6052272,120.9828496),(14.6059306,120.9829113),
    (14.6066444,120.9829623),(14.60717,  120.9829435),(14.6076852,120.9829784),
    (14.6086949,120.9830266),(14.6090063,120.9831607),(14.610051, 120.9832627),
    (14.6110126,120.9833109),(14.6120677,120.9833807),(14.6130604,120.9834504),
    (14.6143478,120.9835953),(14.6155884,120.983673), (14.6169017,120.9837508),
    (14.6184485,120.9838393),(14.6195489,120.9838353),(14.6205352,120.983842),
    (14.6214669,120.9839171),(14.621938, 120.9839279),(14.622409, 120.9839386),
    (14.6225051,120.9834451),(14.6225076,120.9829623),(14.6239104,120.9829944),
    (14.6253028,120.9830266),(14.6260379,120.9830642),(14.6267419,120.9830696),
    (14.6280875,120.9831125),(14.6283964,120.983095), (14.6286845,120.9830347),
    (14.6289673,120.9829475),(14.6291983,120.9828174),(14.6294903,120.9825948),
    (14.6297615,120.98234),  (14.6302831,120.9818357),(14.6308515,120.9813073),
    (14.6314614,120.9808755),(14.6317001,120.980783), (14.6319285,120.9807119),
    (14.6321569,120.9806569),(14.6323853,120.9806341),(14.6333559,120.9809962),
    (14.6342434,120.9814334),(14.6351517,120.9818545),(14.6360289,120.9822649),
    (14.6369995,120.9827048),(14.6379493,120.9831554),(14.6386241,120.9832975),
    (14.639278, 120.9833431),(14.6404173,120.9833659),(14.6418057,120.9834531),
    (14.6431837,120.9834974),(14.6443022,120.9835416),(14.6457826,120.9836127),
    (14.6473877,120.9836409),(14.6494598,120.9837012),(14.6504959,120.9837475),
    (14.6510087,120.9837652),(14.6515112,120.9838259),(14.652941, 120.9838984),
    (14.6543812,120.9839279),(14.6554062,120.9839895),(14.6563793,120.9840191),
    (14.6567634,120.9839493),(14.656849, 120.9840781),(14.6569865,120.9841746),
    (14.6571318,120.9841907),(14.6572772,120.9841639),(14.6573913,120.9840781),
    (14.6574225,120.9839493),(14.6598072,120.9840915),(14.6610151,120.9841411),
    (14.6621815,120.98418),  (14.6637202,120.984247), (14.6645104,120.9842591),
    (14.6652486,120.9842712),(14.6656508,120.9841961),(14.6659803,120.9839815),
    (14.6667977,120.9832519),(14.6675528,120.9824687),(14.667785, 120.982348),
    (14.6679965,120.9822059),(14.6682703,120.9821442),(14.6685232,120.982061),
    (14.6695015,120.9820745),(14.6704797,120.9820771),(14.6714527,120.9820905),
    (14.6724258,120.9820825),(14.6729395,120.9820664),(14.6732768,120.981943),
    (14.6748856,120.9813476),(14.6757133,120.9810123),(14.6765514,120.9806985),
    (14.6776917,120.9802103),(14.6788632,120.9797758),(14.6800607,120.9793681),
    (14.6806698,120.979116), (14.6811751,120.9788638),(14.6819067,120.9784977),
    (14.6825762,120.9781316),(14.6832715,120.9777655),(14.6839513,120.9773725),
    (14.6846596,120.9769756),(14.6853576,120.9766001),(14.6860607,120.9762138),
    (14.686712, 120.9757847),(14.6878432,120.9751731),(14.6889121,120.9745294),
    (14.6899655,120.9740198),(14.6904403,120.9736845),(14.69074,  120.9735383),
    (14.6908944,120.97336),  (14.6912446,120.9730086),(14.6914859,120.9726143),
    (14.6917934,120.9719118),(14.6920282,120.9712093),(14.6924965,120.9699082),
    (14.6927254,120.9692684),(14.6928921,120.9686232),(14.6929077,120.9674537),
    (14.6928844,120.9668636),(14.6928818,120.9662789),(14.6927494,120.9656674),
    (14.692586, 120.9650934),(14.6925419,120.9647474),(14.6926846,120.9644336),
    (14.6928558,120.9642297),(14.6930582,120.9640902),(14.6937016,120.9641063),
    (14.6943139,120.9641439),(14.6949366,120.9641922),(14.6955593,120.964219),
    (14.6971367,120.9637335),(14.6979513,120.9634747),(14.6987037,120.9631944),
    (14.6998115,120.9628672),(14.7008986,120.9625185),(14.7027704,120.9619244),
    (14.7046008,120.9613517),(14.706483, 120.9607469),(14.7082822,120.960142),
    (14.7108531,120.9593401),(14.7133618,120.9585166),(14.7150817,120.9579909),
    (14.716781, 120.9574223),(14.7173816,120.9572643),(14.7178784,120.9570848),
    (14.7185697,120.9573153),(14.7191988,120.95761),  (14.7202209,120.9581572),
]

LOG_INTERVAL_S = 5
PHT_OFFSET     = 8

# ── Stop fractions (20 named stops per direction) ────────────────────────────

STOP_FRACS_MR = [
    0.00, 0.03, 0.07, 0.11, 0.16, 0.21, 0.25,
    0.30, 0.34, 0.40, 0.45, 0.51, 0.55,
    0.60, 0.67, 0.74, 0.79, 0.84, 0.92, 1.00,
]

STOP_FRACS_RM = [
    0.00, 0.08, 0.16, 0.21, 0.26, 0.33, 0.40,
    0.45, 0.49, 0.55, 0.60, 0.66, 0.70,
    0.75, 0.79, 0.84, 0.89, 0.93, 0.97, 1.00,
]

# ── Occupancy demand curves (unchanged from v3) ───────────────────────────────

CURVES = {
    ("MALANDAY-RECTO", "Morning Peak"): [
        (0.00, 23), (0.08, 29), (0.16, 33), (0.26, 36),
        (0.31, 39), (0.35, 40), (0.41, 38), (0.48, 36),
        (0.55, 35), (0.61, 29), (0.68, 24), (0.75, 18),
        (0.84, 12), (0.92,  6), (1.00,  2),
    ],
    ("MALANDAY-RECTO", "Afternoon Peak"): [
        (0.00, 19), (0.12, 25), (0.26, 31), (0.35, 34),
        (0.41, 35), (0.48, 33), (0.55, 30), (0.62, 25),
        (0.74, 18), (0.84, 12), (0.92,  7), (1.00,  2),
    ],
    ("MALANDAY-RECTO", "Midday"): [
        (0.00, 16), (0.16, 23), (0.30, 29), (0.40, 33),
        (0.50, 32), (0.58, 28), (0.70, 22), (0.82, 14),
        (0.92,  8), (1.00,  3),
    ],
    ("MALANDAY-RECTO", "Off-Peak"): [
        (0.00,  9), (0.22, 16), (0.42, 22), (0.56, 24),
        (0.66, 20), (0.80, 13), (1.00,  3),
    ],
    ("RECTO-MALANDAY", "Afternoon Peak"): [
        (0.00, 25), (0.08, 32), (0.17, 37), (0.26, 40),
        (0.36, 39), (0.45, 36), (0.53, 31), (0.61, 27),
        (0.67, 22), (0.71, 17), (0.79, 11), (0.88,  6),
        (0.95,  3), (1.00,  1),
    ],
    ("RECTO-MALANDAY", "Morning Peak"): [
        (0.00, 20), (0.10, 27), (0.20, 31), (0.32, 34),
        (0.44, 32), (0.54, 28), (0.64, 22), (0.76, 16),
        (0.87, 10), (0.95,  5), (1.00,  2),
    ],
    ("RECTO-MALANDAY", "Midday"): [
        (0.00, 16), (0.17, 23), (0.33, 29), (0.46, 33),
        (0.56, 31), (0.64, 27), (0.74, 20), (0.85, 13),
        (1.00,  3),
    ],
    ("RECTO-MALANDAY", "Off-Peak"): [
        (0.00,  8), (0.25, 14), (0.50, 18), (0.65, 16),
        (0.82, 10), (1.00,  2),
    ],
}

# ── Spread dates — late May through mid-June 2026 ─────────────────────────────
# Natural gaps: drivers don't run every day. Saturdays are present (June 6).
# June 11 is the last seeded date (today is 2026-06-12).
# Times use natural minute variance — no :00 or :30 departures.

TRIP_PHT = {
    # MALANDAY-RECTO (8 trips)
    "MR-J01": (2026, 5, 27,  5, 47),   # Tue May 27  — early Off-Peak
    "MR-J02": (2026, 5, 27, 16, 23),   # Tue May 27  — Afternoon Peak
    "MR-J03": (2026, 5, 29,  7,  8),   # Thu May 29  — Morning Peak
    "MR-J04": (2026, 6,  2,  6, 13),   # Mon Jun 2   — Morning Peak
    "MR-J05": (2026, 6,  2, 11, 52),   # Mon Jun 2   — Midday
    "MR-J06": (2026, 6,  5, 16, 47),   # Thu Jun 5   — Afternoon Peak
    "MR-J07": (2026, 6,  9,  8, 33),   # Mon Jun 9   — Morning Peak
    "MR-J08": (2026, 6, 11, 20, 17),   # Wed Jun 11  — Off-Peak (late)
    # RECTO-MALANDAY (8 trips)
    "JEEP-031": (2026, 5, 27,  6, 38),  # Tue May 27  — Morning Peak
    "JEEP-038": (2026, 5, 28, 10, 44),  # Wed May 28  — Midday
    "JEEP-024": (2026, 6,  2, 17, 19),  # Mon Jun 2   — Afternoon Peak
    "JEEP-042": (2026, 6,  3,  7, 56),  # Tue Jun 3   — Morning Peak
    "JEEP-035": (2026, 6,  3, 13, 27),  # Tue Jun 3   — Midday
    "JEEP-047": (2026, 6,  6, 17, 41),  # Sat Jun 6   — Afternoon Peak
    "JEEP-028": (2026, 6,  9,  8, 52),  # Mon Jun 9   — Morning Peak
    "JEEP-044": (2026, 6, 11, 19, 23),  # Wed Jun 11  — Off-Peak
}

# ── Per-trip parameters: (n_interp, n_dwell, moving_bad_rate) ─────────────────
#
# n_interp  — interpolation between waypoints; controls moving point density
# n_dwell   — stationary pings per named stop; controls cluster robustness
# bad_rate  — fraction of MOVING logs that are ACCEPTABLE or POOR
#             (dwell pings are always GOOD for DBSCAN)
#
# Approximate expected totals:
#   MR: moving = (110-1)×(n+1)+1,  dwell = 20×n_dwell
#   RM: moving = (156-1)×(n+1)+1,  dwell = 20×n_dwell
#
# GOOD% ≈ (moving×(1-bad_rate) + dwell) / (moving + dwell)
#
# trip         n_i  n_d  bad    → total     GOOD%  rationale
# MR-J01        7   32  0.08   → 1,513     95%   clear Tue morning, good signal
# MR-J02        9   36  0.22   → 1,811     88%   afternoon, normal urban scatter
# MR-J03        8   28  0.50   → 1,542     68%   rainy Thu, heavy tunnel blackout
# MR-J04       10   35  0.18   → 1,900     90%   Mon peak, decent conditions
# MR-J05        8   38  0.25   → 1,742     86%   midday normal
# MR-J06        7   40  0.48   → 1,673     72%   hot afternoon, phone throttled
# MR-J07       10   44  0.05   → 2,080     97%   best-case Mon morning
# MR-J08        8   30  0.20   → 1,582     88%   calm evening
# JEEP-031      6   35  0.23   → 1,786     87%   normal Tue morning
# JEEP-038      5   32  0.07   → 1,571     94%   midday, good conditions
# JEEP-024      7   28  0.52   → 1,801     68%   Mon afternoon peak, bad signal
# JEEP-042      8   35  0.17   → 2,096     89%   Tue morning solid
# JEEP-035      6   40  0.26   → 1,886     86%   midday normal
# JEEP-047      7   42  0.06   → 2,081     95%   Sat afternoon, light traffic
# JEEP-028      5   28  0.55   → 1,491     66%   Mon morning, worst GPS day
# JEEP-044      6   33  0.21   → 1,746     88%   Wed evening normal

TRIP_PARAMS = {
    "MR-J01":   (7,  32, 0.08),
    "MR-J02":   (9,  36, 0.22),
    "MR-J03":   (8,  28, 0.50),
    "MR-J04":   (10, 35, 0.18),
    "MR-J05":   (8,  38, 0.25),
    "MR-J06":   (7,  40, 0.48),
    "MR-J07":   (10, 44, 0.05),
    "MR-J08":   (8,  30, 0.20),
    "JEEP-031": (6,  35, 0.23),
    "JEEP-038": (5,  32, 0.07),
    "JEEP-024": (7,  28, 0.52),
    "JEEP-042": (8,  35, 0.17),
    "JEEP-035": (6,  40, 0.26),
    "JEEP-047": (7,  42, 0.06),
    "JEEP-028": (5,  28, 0.55),
    "JEEP-044": (6,  33, 0.21),
}


def period_for_pht_hour(h: int) -> str:
    if   6 <= h <  9: return "Morning Peak"
    elif 9 <= h < 16: return "Midday"
    elif 16 <= h < 19: return "Afternoon Peak"
    else:             return "Off-Peak"


def interpolate_curve(anchors: list, pct: float) -> float:
    for i in range(len(anchors) - 1):
        p0, v0 = anchors[i]
        p1, v1 = anchors[i + 1]
        if p0 <= pct <= p1:
            t = (pct - p0) / (p1 - p0) if p1 > p0 else 0
            return v0 + t * (v1 - v0)
    return anchors[-1][1]


def interpolate_path(waypoints: list, n_interp: int) -> list:
    out = []
    for i in range(len(waypoints) - 1):
        la0, lo0 = waypoints[i]
        la1, lo1 = waypoints[i + 1]
        out.append((la0, lo0))
        for k in range(1, n_interp + 1):
            t = k / (n_interp + 1)
            out.append((la0 + t*(la1-la0), lo0 + t*(lo1-lo0)))
    out.append(waypoints[-1])
    return out


def bad_log_quality() -> tuple:
    """Return (GPSQualityEnum, accuracy_m, lat_jitter) for a degraded log."""
    if random.random() < 0.20:   # 20% of bad logs are POOR
        return GPSQualityEnum.POOR, round(random.uniform(55.0, 140.0), 1), 0.00045
    return GPSQualityEnum.ACCEPTABLE, round(random.uniform(18.5, 49.0), 1), 0.00012


def build_logs(trip: Trip, path: list, anchors: list,
               stop_fracs: list, n_dwell: int, bad_rate: float) -> list:
    """
    Build GPS logs with quality variance.

    Moving logs: randomly degraded at bad_rate (ACCEPTABLE or POOR).
    Dwell logs at named stops: always GOOD (required for DBSCAN clusters).
    """
    n   = len(path)
    cap = trip.official_capacity

    stop_indices = {round(f * (n - 1)) for f in stop_fracs}

    logs   = []
    t_secs = 0
    seq    = 1

    for i, (lat, lon) in enumerate(path):
        pct      = i / (n - 1)
        base_occ = interpolate_curve(anchors, pct)
        occ      = max(0, round(base_occ + random.gauss(0, 2.0)))
        ts       = trip.start_time + timedelta(seconds=t_secs)

        # Moving point — quality based on bad_rate
        if random.random() < bad_rate:
            quality, acc, jitter = bad_log_quality()
        else:
            quality = GPSQualityEnum.GOOD
            acc     = round(random.uniform(4.5, 14.5), 1)
            jitter  = 0.000022

        lat_j = lat + random.gauss(0, jitter)
        lon_j = lon + random.gauss(0, jitter)

        logs.append(GPSLog(
            log_id                 = str(uuid.uuid4()),
            trip_id                = trip.trip_id,
            device_id              = trip.recorder_id,
            latitude               = round(lat_j, 7),
            longitude              = round(lon_j, 7),
            accuracy               = acc,
            occupancy_count        = occ,
            over_capacity_flag     = occ > cap,
            gps_quality_flag       = quality,
            timestamp              = ts,
            gps_timestamp          = ts,
            client_seq             = seq,
            client_online_event_at = None,
        ))
        t_secs += LOG_INTERVAL_S
        seq    += 1

        # Dwell pings at named stop — always GOOD (DBSCAN requires density here)
        if i in stop_indices:
            stop_occ = occ
            for _ in range(n_dwell):
                d_lat = lat + random.gauss(0, 0.000003)
                d_lon = lon + random.gauss(0, 0.000003)
                d_ts  = trip.start_time + timedelta(seconds=t_secs)
                logs.append(GPSLog(
                    log_id                 = str(uuid.uuid4()),
                    trip_id                = trip.trip_id,
                    device_id              = trip.recorder_id,
                    latitude               = round(d_lat, 7),
                    longitude              = round(d_lon, 7),
                    accuracy               = round(random.uniform(3.0, 8.0), 1),
                    occupancy_count        = stop_occ,
                    over_capacity_flag     = stop_occ > cap,
                    gps_quality_flag       = GPSQualityEnum.GOOD,
                    timestamp              = d_ts,
                    gps_timestamp          = d_ts,
                    client_seq             = seq,
                    client_online_event_at = None,
                ))
                t_secs += LOG_INTERVAL_S
                seq    += 1

    return logs


def main():
    db = SessionLocal()
    try:
        trips = db.query(Trip).order_by(Trip.start_time).all()
        print(f"Rebuilding {len(trips)} trips.\n")

        total_logs = 0
        for trip in trips:
            trip_key = next((k for k in TRIP_PHT if k in trip.trip_id), None)
            if trip_key is None:
                print(f"  SKIP unknown trip_id: {trip.trip_id}")
                continue

            yr, mo, dy, pht_h, pht_m = TRIP_PHT[trip_key]
            n_interp, n_dwell, bad_rate = TRIP_PARAMS[trip_key]

            is_return  = trip.direction == "RECTO-MALANDAY"
            waypoints  = RETURN_CORRIDOR if is_return else CORRIDOR
            stop_fracs = STOP_FRACS_RM   if is_return else STOP_FRACS_MR

            path   = interpolate_path(waypoints, n_interp)
            n_pts  = len(path)
            period = period_for_pht_hour(pht_h)

            pht_start       = datetime(yr, mo, dy, pht_h, pht_m, 0)
            corrected_start = pht_start - timedelta(hours=PHT_OFFSET)
            end_time        = corrected_start + timedelta(seconds=n_pts * LOG_INTERVAL_S)

            trip.start_time = corrected_start
            trip.end_time   = end_time

            curve_key = (trip.direction, period)
            anchors   = CURVES.get(curve_key, CURVES[(trip.direction, "Off-Peak")])

            db.query(GPSLog).filter(GPSLog.trip_id == trip.trip_id).delete()

            logs = build_logs(trip, path, anchors, stop_fracs, n_dwell, bad_rate)

            n_good = sum(1 for l in logs if l.gps_quality_flag == GPSQualityEnum.GOOD)
            n_acc  = sum(1 for l in logs if l.gps_quality_flag == GPSQualityEnum.ACCEPTABLE)
            n_poor = sum(1 for l in logs if l.gps_quality_flag == GPSQualityEnum.POOR)
            good_pct = round(n_good / len(logs) * 100, 1)

            db.bulk_save_objects(logs)

            print(f"  {trip.trip_id}")
            print(f"    {trip.direction:<20} {period:<16} {pht_start.strftime('%b %d %H:%M PHT')}")
            print(f"    n_interp={n_interp}  n_dwell={n_dwell}  total={len(logs):,} logs")
            print(f"    GOOD={n_good:,} ({good_pct}%)  ACCEPTABLE={n_acc:,}  POOR={n_poor:,}")
            total_logs += len(logs)

        db.commit()
        print(f"\nDone. {len(trips)} trips rebuilt, {total_logs:,} total GPS logs.")

    except Exception as e:
        db.rollback()
        import traceback; traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    main()
