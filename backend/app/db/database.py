import os
import psycopg2
from psycopg2 import pool
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# Connection pool: min 1, max 10 connections
connection_pool = psycopg2.pool.SimpleConnectionPool(
    1, 10, DATABASE_URL
)

def get_connection():
    """Borrow a connection from the pool."""
    return connection_pool.getconn()

def release_connection(conn):
    """Return a connection to the pool."""
    connection_pool.putconn(conn)

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