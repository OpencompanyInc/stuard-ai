
import requests
import json
import sys

try:
    url = "http://127.0.0.1:8765/v1/tools/exec"
    payload = {
        "tool": "segment_build_topic_drawers",
        "args": {
            "limit_topics": 10,
            "limit_segments_per_topic": 5,
            "max_clusters_per_topic": 3
        }
    }
    
    print(f"Sending POST to {url}...")
    print(json.dumps(payload, indent=2))
    
    resp = requests.post(url, json=payload, timeout=5)
    
    print(f"Status Code: {resp.status_code}")
    try:
        data = resp.json()
        print("Response JSON keys:", list(data.keys()))
        
        if data.get("ok"):
            drawers = data.get("drawers", [])
            print(f"Drawers found: {len(drawers)}")
            if drawers:
                print("First drawer topic:", drawers[0].get("topic"))
        else:
            print("Error in response:", data.get("error"))
            if "result" in data:
                 print("Result:", data["result"])

    except Exception as e:
        print("Failed to parse JSON:", resp.text)
        
except Exception as e:
    print(f"Request failed: {e}")
