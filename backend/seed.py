"""
seed.py — One-shot database setup script for FaceAttend
=====================================================
Run this ONCE after applying schema.sql to create:
  • Admin account
  • Lecturer account
  • Student account (login only — biometric enrolled via the web app)
  • Sample course (CSC401)
  • Token pre-assigned to the student for enrollment

Usage (from /backend directory, with venv activated):
  python seed.py

Credentials printed at the end.
"""

import os, sys, secrets, hashlib, hmac
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv()

try:
    import psycopg2
except ImportError:
    print("psycopg2 not installed. Run:  pip install psycopg2-binary")
    sys.exit(1)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/attendance_db")

# ── Accounts to seed ──────────────────────────────────────────
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
        "full_name": "Dr. Tinuke Oladele",
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

    print("\n[*] FaceAttend -- Database Seed Script")
    print("=" * 45)

    try:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False
        cur  = conn.cursor()
        print(f"✅ Connected to database: {DATABASE_URL.split('@')[-1]}")
    except Exception as e:
        print(f"❌ Cannot connect to database: {e}")
        print("\n📋 Make sure PostgreSQL is running and DATABASE_URL is correct.")
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
            print("\n📝 Applying schema.sql…")
            schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
            with open(schema_path, "r", encoding="utf-8") as f:
                schema_sql = f.read()
            cur.execute(schema_sql)
            conn.commit()
            print("   ✅ Schema applied successfully.")
        else:
            print("\n📝 Schema check: tables already exist. Skipping schema apply.")
    except Exception as e:
        conn.rollback()
        print(f"❌ Error checking/applying schema: {e}")
        sys.exit(1)

    # ── 1. Create user accounts ──────────────────────────────────
    print("\n👤 Creating user accounts…")
    user_ids = {}
    for acc in ACCOUNTS:
        cur.execute("SELECT id FROM users WHERE email = %s", (acc["email"],))
        existing = cur.fetchone()
        if existing:
            print(f"   ⚠  {acc['email']} already exists — skipping")
            user_ids[acc["role"]] = existing[0]
            continue

        ph = hash_password(acc["password"])
        cur.execute(
            "INSERT INTO users (email, password_hash, role, full_name, linked_matric) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (acc["email"], ph, acc["role"], acc["full_name"], acc.get("linked_matric"))
        )
        uid = cur.fetchone()[0]
        user_ids[acc["role"]] = uid
        print(f"   ✅ {acc['role'].upper():10} {acc['email']}")

    # ── 2. Create course ─────────────────────────────────────────
    print("\n📚 Creating course…")
    cur.execute("SELECT course_code FROM courses WHERE course_code = %s", (COURSE["course_code"],))
    if cur.fetchone():
        print(f"   ⚠  {COURSE['course_code']} already exists — skipping")
    else:
        cur.execute(
            "INSERT INTO courses (course_code, course_title, lecturer_id) VALUES (%s, %s, %s)",
            (COURSE["course_code"], COURSE["course_title"], user_ids.get("lecturer"))
        )
        print(f"   ✅ {COURSE['course_code']} — {COURSE['course_title']}")

    # ── 3. Issue enrollment token for the student ────────────────
    print("\n🔑 Issuing enrollment token for student…")
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
        print(f"   ⚠  Reusing existing token for 22/01DL068")
    else:
        cur.execute(
            "INSERT INTO enrollment_tokens (token, course_code, matric_number, expires_at) "
            "VALUES (%s, %s, %s, %s)",
            (token, COURSE["course_code"], "22/01DL068", expires)
        )
        print(f"   ✅ Token issued (expires in 72h)")

    conn.commit()
    cur.close()
    conn.close()

    # ── Summary ──────────────────────────────────────────────────
    # Support both local dev and production (Railway) environments
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")

    print("\n" + "=" * 55)
    print("🎉 Seed complete! Use these credentials:\n")
    print("  ADMIN LOGIN")
    print(f"    Email:    admin@unilorin.edu.ng")
    print(f"    Password: Admin1234!")
    print(f"    URL:      {frontend_url}/login\n")
    print("  LECTURER LOGIN")
    print(f"    Email:    lecturer@unilorin.edu.ng")
    print(f"    Password: Lecturer1234!")
    print(f"    URL:      {frontend_url}/login\n")
    print("  STUDENT LOGIN  (after biometric enrollment)")
    print(f"    Email:    student@unilorin.edu.ng")
    print(f"    Password: Student1234!")
    print(f"    URL:      {frontend_url}/login\n")
    print("  ENROLLMENT LINK (share this with the student)")
    print(f"    {frontend_url}/enroll?token={token}")
    print(f"    Matric: 22/01DL068")
    print(f"    Token:  {token}")
    print("\n" + "=" * 55 + "\n")


if __name__ == "__main__":
    main()
