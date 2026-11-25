"""Idempotent database setup for the demo environment."""

import os, sys, secrets, hashlib, hmac
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv()

try:
    import psycopg2
except ImportError:
    print("psycopg2 not installed. Run:  pip install psycopg2-binary")
    sys.exit(1)

_raw_url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/attendance_db")
DATABASE_URL = _raw_url.replace("postgres://", "postgresql://", 1) if _raw_url else None


def apply_migrations(cur):
    """Apply idempotent SQL files in filename order."""
    migration_dir = os.path.join(os.path.dirname(__file__), "migrations")
    if not os.path.isdir(migration_dir):
        return

    for filename in sorted(os.listdir(migration_dir)):
        if not filename.endswith(".sql"):
            continue
        path = os.path.join(migration_dir, filename)
        with open(path, "r", encoding="utf-8") as f:
            cur.execute(f.read())
        print(f"   Applied migration {filename}")


# -- Accounts to seed ------------------------------------------
ACCOUNTS = [
    {
        "email":     "admin@unilorin.edu.ng",
        "password":  "Admin1234!",
        "role":      "admin",
        "full_name": "System Administrator",
    },
    {
        "email":     "lecturer@unilorin.edu.ng",
        "password":  "Lecturer1234!",
        "role":      "lecturer",
        "full_name": "Prof. Tinuke Oladele",
    },
    {
        "email":        "student@unilorin.edu.ng",
        "password":     "Student1234!",
        "role":         "student",
        "full_name":    "Awoyemi Gabriel Oluwaseun",
        "linked_matric": "22/01DL068",
    },
]

COURSE = {
    "course_code":  "CSC401",
    "course_title": "Computer Networks and Security",
}

def hash_password(plain: str) -> str:
    """Hash password using bcrypt directly (compatible with passlib verify)."""
    import bcrypt
    # bcrypt.hashpw returns bytes; decode to str for PostgreSQL storage
    hashed = bcrypt.hashpw(plain.encode('utf-8'), bcrypt.gensalt(rounds=12))
    return hashed.decode('utf-8')


def main():
    import sys
    # Force UTF-8 output on Windows to handle any unicode
    if sys.stdout.encoding != 'utf-8':
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    print("[seed] FaceAttend database setup")

    try:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False
        cur = conn.cursor()
        print(f"[seed] connected to {DATABASE_URL.split('@')[-1]}")
    except Exception as e:
        print(f"[seed] connection failed: {e}")
        sys.exit(1)

    # Apply schema if tables don't exist
    try:
        cur.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'users'
            );
        """)
        exists = cur.fetchone()[0]
        if not exists:
            schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
            with open(schema_path, "r", encoding="utf-8") as f:
                cur.execute(f.read())
            conn.commit()
            print("[seed] applied schema.sql")

        apply_migrations(cur)
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[seed] schema setup failed: {e}")
        sys.exit(1)

    print("[seed] accounts")
    user_ids = {}
    for acc in ACCOUNTS:
        cur.execute("SELECT id FROM users WHERE email = %s", (acc["email"],))
        existing = cur.fetchone()
        if existing:
            user_ids[acc['role']] = existing[0]
            continue

        ph = hash_password(acc["password"])
        cur.execute(
            "INSERT INTO users (email, password_hash, role, full_name, linked_matric) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (acc["email"], ph, acc["role"], acc["full_name"], acc.get("linked_matric"))
        )
        user_ids[acc["role"]] = cur.fetchone()[0]

    cur.execute("SELECT course_code FROM courses WHERE course_code = %s", (COURSE["course_code"],))
    if not cur.fetchone():
        cur.execute(
            "INSERT INTO courses (course_code, course_title, lecturer_id) VALUES (%s, %s, %s)",
            (COURSE["course_code"], COURSE["course_title"], user_ids.get("lecturer"))
        )
    token = secrets.token_urlsafe(24)
    expires = datetime.now(timezone.utc) + timedelta(hours=72)

    # Check if student already has a pending token
    cur.execute(
        "SELECT token FROM enrollment_tokens WHERE matric_number = %s AND used = FALSE",
        ("22/01DL068",)
    )
    existing_token = cur.fetchone()
    if existing_token:
        token = existing_token[0]
    else:
        cur.execute(
            "INSERT INTO enrollment_tokens (token, course_code, matric_number, expires_at) "
            "VALUES (%s, %s, %s, %s)",
            (token, COURSE["course_code"], "22/01DL068", expires)
        )

    conn.commit()
    cur.close()
    conn.close()

    if os.getenv("SHOW_SEED_SUMMARY", "1") != "0":
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
        print(f"[seed] ready at {frontend_url}/login")
        for account in ACCOUNTS:
            print(f"[seed] {account['role']}: {account['email']} / {account['password']}")
        print(f"[seed] enrollment: {frontend_url}/enroll?token={token}")


if __name__ == "__main__":
    main()
