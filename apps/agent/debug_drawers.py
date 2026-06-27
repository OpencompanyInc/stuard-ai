
import sys
import os
import json
import logging

# Add the parent directory to sys.path to allow imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from app.storage.memory_db import get_memory_db
    
    # Configure logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("debug_drawers")

    print("Initializing MemoryDB...")
    db = get_memory_db()
    
    print("Checking total conversation segments...")
    with db._get_conn() as conn:
        count = conn.execute("SELECT COUNT(*) FROM conversation_segments").fetchone()[0]
        print(f"Total segments in DB: {count}")
        
        # Check if they have embeddings
        emb_count = 0
        rows = conn.execute("SELECT embedding FROM conversation_segments LIMIT 10").fetchall()
        for row in rows:
            if row[0]:
                emb_count += 1
        print(f"Sampled 10 segments, found embeddings in: {emb_count}")

    print("Running build_topic_drawers...")
    drawers = db.build_topic_drawers(
        limit_topics=50,
        limit_segments_per_topic=200,
        cluster_threshold=0.82
    )
    
    print(f"Drawers returned: {len(drawers)}")
    for d in drawers:
        print(f"- Topic: {d['topic']} ({d['count']} items, {len(d['clusters'])} clusters)")
        
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
