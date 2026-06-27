
import sys
import os

# Add the parent directory to sys.path to import app modules
current_dir = os.path.dirname(os.path.abspath(__file__))
agent_root = os.path.dirname(current_dir)
sys.path.append(agent_root)

from app.storage import file_index_db as db

print("Running database initialization/migration...")
try:
    db.init()
    print("Database init complete.")
except Exception as e:
    print(f"Error during init: {e}")
