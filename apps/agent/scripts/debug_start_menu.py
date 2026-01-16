
import sys
import os
import sqlite3

# Add the parent directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
agent_root = os.path.dirname(current_dir)
sys.path.append(agent_root)

from app.storage import file_index_db as db

print("Checking Start Menu Roots...")
roots = db.list_roots()
start_menu_roots = [r for r in roots if "Start Menu" in r.path]

for r in start_menu_roots:
    print(f"Root: {r.path} (ID: {r.id})")
    with db.get_conn() as conn:
        count = conn.execute("SELECT COUNT(*) FROM indexed_files WHERE root_id = ?", (r.id,)).fetchone()[0]
        print(f"  Total Files: {count}")
        
        # Check kinds
        kinds = conn.execute("SELECT kind, COUNT(*) FROM indexed_files WHERE root_id = ? GROUP BY kind", (r.id,)).fetchall()
        for k, c in kinds:
            print(f"  - {k}: {c}")
            
        # Sample some files
        print("  Sample files:")
        rows = conn.execute("SELECT filename, kind, extension FROM indexed_files WHERE root_id = ? LIMIT 5", (r.id,)).fetchall()
        for row in rows:
            print(f"    {row['filename']} ({row['extension']}) -> {row['kind']}")
            
print("\nChecking Extension Mapping in DB...")
print(f".lnk maps to: {db.EXT_TO_KIND.get('.lnk')}")
print(f".exe maps to: {db.EXT_TO_KIND.get('.exe')}")
