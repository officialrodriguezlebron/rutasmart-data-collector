"""
Migration — unique index on gps_logs (trip_id, client_seq)

LOCAL ONLY. This script refuses to run against anything that is not a local
PostgreSQL host. It has not been applied to Railway; do that only after the
local run is proven and an independent backup exists.

Why
---
The PWA stamps client_seq per trip and only rewrites its offline queue once a
whole flush finishes. A flush interrupted by a reload or a crash therefore
replays logs the backend already stored. log_id is minted server-side on every
request (uuid4), so it cannot detect a replay — the duplicate simply became a
second row, inflating the point counts DBSCAN clusters on, which is a
research-data problem rather than a tidiness one.

Safety
------
* Aborts on any non-local host, or if the database is not rutasmart_db.
* Refuses to create the index if conflicting rows already exist, and prints
  them instead of destroying anything. It never deletes or edits a row.
* Idempotent: creating an index that already exists is a no-op.
* NULL client_seq is unaffected. Postgres treats NULLs as distinct in a unique
  index, so imported and legacy rows without a sequence number may coexist
  freely for the same trip.

Usage
-----
    python migrations/2026_11_05_gps_logs_unique_trip_seq.py          # apply
    python migrations/2026_11_05_gps_logs_unique_trip_seq.py --check  # dry run
    python migrations/2026_11_05_gps_logs_unique_trip_seq.py --down   # revert
"""
import sys

from sqlalchemy import text
from sqlalchemy.engine.url import make_url

sys.path.insert(0, __file__.rsplit("migrations", 1)[0])

from app.database import DATABASE_URL, SessionLocal  # noqa: E402

INDEX_NAME = "uq_gps_logs_trip_seq"
REMOTE_TOKENS = ("railway", "rlwy", "render", "amazonaws", "rds.",
                 "azure", "gcp", "neon", "supabase")


def guard():
    u = make_url(DATABASE_URL)
    host = (u.host or "").lower()
    print("target: %s:%s/%s" % (u.host, u.port, u.database))
    if any(tok in host for tok in REMOTE_TOKENS):
        sys.exit("ABORT: host looks remote (%s). This migration is local-only." % host)
    if host not in ("localhost", "127.0.0.1", "::1"):
        sys.exit("ABORT: host is not local (%s)." % host)
    if u.database != "rutasmart_db":
        sys.exit("ABORT: unexpected database name (%s)." % u.database)
    print("guard: local PostgreSQL confirmed")


def conflicts(db):
    return db.execute(text("""
        select trip_id, client_seq, count(*) as n
          from gps_logs
         where client_seq is not null
      group by trip_id, client_seq
        having count(*) > 1
      order by n desc
    """)).all()


def index_exists(db):
    return db.execute(text(
        "select 1 from pg_indexes where indexname = :n"), {"n": INDEX_NAME}).scalar() is not None


def report(db):
    total = db.execute(text("select count(*) from gps_logs")).scalar()
    nulls = db.execute(text("select count(*) from gps_logs where client_seq is null")).scalar()
    print("rows: %d total, %d with NULL client_seq (unaffected by the index)" % (total, nulls))
    rows = conflicts(db)
    print("conflicting (trip_id, client_seq) groups: %d" % len(rows))
    for trip_id, seq, n in rows[:10]:
        print("   %s seq=%s -> %d rows" % (trip_id, seq, n))
    return rows


def up(db):
    if index_exists(db):
        print("index %s already present — nothing to do" % INDEX_NAME)
        return 0
    rows = report(db)
    if rows:
        print("\nABORT: duplicates exist. Resolve them deliberately before adding")
        print("the constraint — this script will not delete or merge rows.")
        return 1
    db.execute(text("CREATE UNIQUE INDEX %s ON gps_logs (trip_id, client_seq)" % INDEX_NAME))
    db.commit()
    print("created unique index %s" % INDEX_NAME)
    return 0


def down(db):
    if not index_exists(db):
        print("index %s not present — nothing to drop" % INDEX_NAME)
        return 0
    db.execute(text("DROP INDEX %s" % INDEX_NAME))
    db.commit()
    print("dropped index %s" % INDEX_NAME)
    return 0


def main():
    guard()
    db = SessionLocal()
    try:
        if "--check" in sys.argv:
            report(db)
            print("index present:", index_exists(db))
            return 0
        if "--down" in sys.argv:
            return down(db)
        return up(db)
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
