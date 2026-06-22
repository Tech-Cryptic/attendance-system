import os
import psycopg2
from psycopg2 import pool
from dotenv import load_dotenv

load_dotenv()

# Railway gives postgres:// but psycopg2 requires postgresql://
_raw_url = os.getenv("DATABASE_URL", "")
DATABASE_URL = _raw_url.replace("postgres://", "postgresql://", 1) if _raw_url else None

# Lazy singleton — created on first use so the app can still start
# even if DATABASE_URL is not yet injected at import time.
_pool = None


def _get_pool():
    global _pool
    if _pool is None:
        if not DATABASE_URL:
            raise RuntimeError(
                "DATABASE_URL environment variable is not set. "
                "Add it in Railway → backend service → Variables."
            )
        _pool = psycopg2.pool.SimpleConnectionPool(1, 10, DATABASE_URL)
    return _pool


def get_connection():
    """Borrow a connection from the pool."""
    return _get_pool().getconn()


def release_connection(conn):
    """Return a connection to the pool."""
    _get_pool().putconn(conn)


def test_connection():
    """Quick sanity check used at startup."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT version();")
        version = cur.fetchone()
        cur.close()
        return version[0]
    finally:
        release_connection(conn)