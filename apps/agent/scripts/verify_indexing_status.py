
import sys
import os
import sqlite3

# Add the parent directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
agent_root = os.path.dirname(current_dir)
sys.path.append(agent_root)

from app.storage import file_index_db as db

print("=== Indexed Roots ===")
roots = db.list_roots()
for r in roots:
    print(f"- {r.path} ({r.schedule})")

print("\n=== File Counts by Kind ===")
stats = db.get_stats()
for kind, count in stats.get('files_by_kind', {}).items():
    print(f"{kind}: {count}")

print("\n=== Application Files Sample ===")
with db.get_conn() as conn:
    rows = conn.execute("SELECT path, filename FROM indexed_files WHERE kind='application' LIMIT 5").fetchall()
    for r in rows:
        print(f"- {r['filename']}")
