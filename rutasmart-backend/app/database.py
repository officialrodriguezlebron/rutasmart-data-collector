import os
import logging
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")

# ── Connection pool configuration ────────────────────────────────────────────
# Railway PostgreSQL free tier allows 25 simultaneous connections.
# Default SQLAlchemy pool_size=5, max_overflow=10 → up to 15 connections, safe.
# pool_pre_ping=True tests each connection before handing it to a request,
# preventing "connection closed" errors after Railway's idle-connection eviction.
# pool_recycle=300 drops connections older than 5 minutes so they don't go stale.
engine = create_engine(
    DATABASE_URL,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
    pool_recycle=300,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
