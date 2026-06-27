
import sys
import os
import time
import asyncio
import logging

# Add the parent directory to sys.path to import app modules
current_dir = os.path.dirname(os.path.abspath(__file__))
agent_root = os.path.dirname(current_dir)
sys.path.append(agent_root)

from app.storage import file_index_db as db
from app.tools import file_scanner

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

async def run_benchmark(path: str, reset: bool = False):
    logger.info(f"Starting benchmark for: {path} (reset={reset})")
    
    if not os.path.exists(path):
        logger.error(f"Path does not exist: {path}")
        return

    # Ensure root exists in DB
    root = db.get_root_by_path(path)
    if reset and root:
        logger.info("Resetting root (fresh index)...")
        db.delete_root(root.id)
        root = None

    if not root:
        logger.info("Adding root to database...")
        root = db.add_root(path, schedule='custom', interval_hours=0.25)
    else:
        logger.info(f"Root already exists with schedule: {root.schedule}")

    # Start timer
    start_time = time.time()
    
    logger.info("Scanning...")
    
    # Progress callback
    def on_progress(p):
        current_elapsed = time.time() - start_time
        sys.stdout.write(f"\rScanned: {p.total_files} files | New: {p.new_files} | Changed: {p.changed_files} | Time: {current_elapsed:.2f}s")
        sys.stdout.flush()

    # Run scan
    try:
        progress = await file_scanner.scan_root(
            root.id, 
            progress_callback=on_progress,
            compute_hashes=True
        )
        
        end_time = time.time()
        duration = end_time - start_time
        
        # Calculate final stats
        final_elapsed = end_time - progress.start_time
        speed = progress.total_files / final_elapsed if final_elapsed > 0 else 0
        
        print("\n\n" + "="*50)
        print("BENCHMARK RESULTS")
        print("="*50)
        print(f"Target Path:      {path}")
        print(f"Total Duration:   {duration:.2f} seconds")
        print(f"Total Files:      {progress.total_files}")
        print(f"Total Dirs:       {progress.total_dirs}")
        print(f"New Files:        {progress.new_files}")
        print(f"Changed Files:    {progress.changed_files}")
        print(f"Unchanged Files:  {progress.unchanged_files}")
        print(f"Moved Files:      {progress.moved_files}")
        print(f"Errors:           {len(progress.errors)}")
        print(f"Speed:            {speed:.1f} files/sec")
        print("="*50)
        
    except Exception as e:
        logger.error(f"Benchmark failed: {e}", exc_info=True)

if __name__ == "__main__":
    target_path = r"C:\Users\solar\Downloads"
    reset_mode = False
    
    args = sys.argv[1:]
    if "--reset" in args:
        reset_mode = True
        args.remove("--reset")
        
    if args:
        target_path = args[0]
        
    asyncio.run(run_benchmark(target_path, reset=reset_mode))
