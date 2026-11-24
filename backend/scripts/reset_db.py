import os
import sys
import psycopg2
from dotenv import load_dotenv

# Reconfigure stdout to use UTF-8 just in case, but also use simple ASCII to be safe
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

load_dotenv()

_raw_url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres123@localhost:5432/attendance_db")
DATABASE_URL = _raw_url.replace("postgres://", "postgresql://", 1) if _raw_url else None

print("[*] FaceAttend -- Database Reset Script")
print("=" * 45)

try:
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()
    print(f"[OK] Connected to database: {DATABASE_URL.split('@')[-1]}")
except Exception as e:
    print(f"[ERROR] Cannot connect to database: {e}")
    sys.exit(1)

try:
    print("\n[INFO] Dropping and recreating public schema...")
    cur.execute("DROP SCHEMA public CASCADE;")
    cur.execute("CREATE SCHEMA public;")
    cur.execute("GRANT ALL ON SCHEMA public TO postgres;")
    cur.execute("GRANT ALL ON SCHEMA public TO public;")
    print("[OK] Public schema reset.")
    
    print("\n[INFO] Applying schema.sql...")
    schema_path = "schema.sql"
    with open(schema_path, "r", encoding="utf-8") as f:
        schema_sql = f.read()
    cur.execute(schema_sql)
    print("[OK] Schema applied successfully.")
    
    cur.close()
    conn.close()
    
    print("\n[INFO] Seeding database...")
    import seed
    seed.main()
    print("[OK] Seeding complete.")
    
except Exception as e:
    print(f"[ERROR] Error during reset: {e}")
    sys.exit(1)
