
import sys
import os
import asyncio

# Add the parent directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
agent_root = os.path.dirname(current_dir)
sys.path.append(agent_root)

from app.storage import file_index_db as db
from app.tools import file_scanner

async def add_start_menu_paths():
    print("Detecting Start Menu paths...")
    paths_to_add = []
    
    if sys.platform == "win32":
        appdata = os.getenv("APPDATA")
        programdata = os.getenv("PROGRAMDATA")
        
        if appdata:
            user_programs = os.path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs")
            if os.path.exists(user_programs):
                paths_to_add.append(user_programs)
                
        if programdata:
            common_programs = os.path.join(programdata, "Microsoft", "Windows", "Start Menu", "Programs")
            if os.path.exists(common_programs):
                paths_to_add.append(common_programs)
    
    print(f"Found {len(paths_to_add)} Start Menu paths.")
    
    for path in paths_to_add:
        print(f"Processing root: {path}")
        
        # Check if exists first
        root = db.get_root_by_path(path)
        if not root:
            print(f"Adding new root: {path}")
            try:
                db.add_root(path, schedule='daily')
            except sqlite3.IntegrityError:
                print(f"Root already exists (caught IntegrityError): {path}")
            
            # Fetch again
            root = db.get_root_by_path(path)
        else:
            print(f"Root already exists: {path}")
        
        if root:
            print(f"Scanning {path}...")
            # Trigger immediate scan
            await file_scanner.scan_root(root.id)
            print("Scan complete.")

if __name__ == "__main__":
    asyncio.run(add_start_menu_paths())
