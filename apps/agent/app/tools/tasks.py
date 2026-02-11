from __future__ import annotations

import asyncio
import uuid
import json
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, List

from ..connections import manager

# In-memory scheduled jobs map
_REMINDER_TASKS: Dict[str, asyncio.Task] = {}


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def _calculate_next_occurrence(last_dt: datetime, recurrence: Dict[str, Any]) -> Optional[datetime]:
    freq = str(recurrence.get("frequency") or "daily").lower()
    interval = int(recurrence.get("interval") or 1)
    days = recurrence.get("days")  # List[int] 0=Mon, 6=Sun

    if freq == "daily":
        return last_dt + timedelta(days=interval)
    
    if freq == "weekly":
        if days and isinstance(days, list) and len(days) > 0:
            current_weekday = last_dt.weekday()
            sorted_days = sorted([int(d) % 7 for d in days])
            
            # Find next day in this week
            next_day = next((d for d in sorted_days if d > current_weekday), None)
            
            if next_day is not None:
                delta = next_day - current_weekday
                return last_dt + timedelta(days=delta)
            else:
                # Jump to next week's first day
                first_day = sorted_days[0]
                delta = (7 - current_weekday) + first_day
                # Add (interval - 1) weeks
                delta += (7 * max(0, interval - 1))
                return last_dt + timedelta(days=delta)
        else:
            return last_dt + timedelta(weeks=interval)

    if freq == "monthly":
        # Approximating 30 days
        return last_dt + timedelta(days=30 * interval)
        
    return None


async def calendar_crud(args: Dict[str, Any]) -> Dict[str, Any]:
    # Deprecated: Unified tasks system doesn't explicitly support multiple calendars via Agent yet
    return {"ok": True, "items": [{"id": "default", "name": "Default"}]}


async def task_crud(args: Dict[str, Any]) -> Dict[str, Any]:
    action = str(args.get("action") or "").lower()
    data = args.get("data") or {}

    try:
        if action == "list":
            resp = await manager.send_request("unified_tasks_list", {})
            return resp if isinstance(resp, dict) else {"ok": False, "error": "invalid_response"}

        if action == "create":
            resp = await manager.send_request("unified_tasks_add", data)
            return resp

        if action == "read":
            resp = await manager.send_request("unified_tasks_get", {"taskId": data.get("id")})
            return resp

        if action == "update":
            resp = await manager.send_request("unified_tasks_update", data)
            return resp

        if action == "delete":
            resp = await manager.send_request("unified_tasks_delete", {"id": data.get("id")})
            return resp

    except Exception as e:
        return {"ok": False, "error": str(e)}

    return {"ok": False, "error": "unknown_action"}


async def task_reminders(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    action = str(args.get("action") or "").lower()
    if action not in ("schedule", "cancel", "list", "resume"):
        return {"ok": False, "error": "unknown_action"}

    # Common firing logic
    async def _fire_logic(assignment_id: str, task_id: str, message: str, target_dt: datetime, recurrence: Optional[Dict]):
        try:
            # Wait until target time
            now_ts = datetime.now(timezone.utc).timestamp()
            target_ts = target_dt.astimezone(timezone.utc).timestamp()
            delay = max(0.0, target_ts - now_ts)
            
            await asyncio.sleep(delay)
            
            # Fire!
            # Broadcast reminder trigger event
            try:
                await manager.broadcast(json.dumps({
                    "type": "progress",
                    "event": "reminder_triggered",
                    "data": {"id": assignment_id, "taskId": task_id, "message": message},
                }))
            except Exception:
                pass
            if emit:
                try:
                    await emit("reminder_triggered", {"id": assignment_id, "taskId": task_id, "message": message})
                except Exception:
                    pass
            
            # Handle recurrence or finish
            next_dt = _calculate_next_occurrence(target_dt, recurrence) if recurrence else None
            
            if next_dt:
                # Reschedule in Unified Tasks
                next_iso = next_dt.astimezone().isoformat()
                try:
                    await manager.send_request("unified_tasks_update_agent_assignment", {
                        "taskId": task_id,
                        "assignmentId": assignment_id,
                        "updates": {
                            "scheduledAt": next_iso,
                            "status": "pending" 
                        }
                    })
                except Exception:
                    pass
                
                # Schedule next run in memory
                t = asyncio.create_task(_fire_logic(assignment_id, task_id, message, next_dt, recurrence))
                _REMINDER_TASKS[assignment_id] = t
            else:
                # Mark completed
                try:
                    await manager.send_request("unified_tasks_update_agent_assignment", {
                        "taskId": task_id,
                        "assignmentId": assignment_id,
                        "updates": {
                            "status": "completed"
                        }
                    })
                except Exception:
                    pass
                _REMINDER_TASKS.pop(assignment_id, None)
                
        except asyncio.CancelledError:
            pass
        except Exception:
            _REMINDER_TASKS.pop(assignment_id, None)

    try:
        if action == "list":
            resp = await manager.send_request("unified_tasks_get_pending", {})
            if resp.get("ok"):
                items = []
                for p in resp.get("pending", []):
                    a = p.get("assignment", {})
                    t = p.get("task", {})
                    items.append({
                        "id": a.get("id"),
                        "taskId": t.get("id"),
                        "message": a.get("message"),
                        "whenIso": a.get("scheduledAt"),
                        "recurrence": a.get("recurring") if isinstance(a.get("recurring"), dict) else None
                    })
                return {"ok": True, "items": items}
            return resp

        if action == "resume":
            # Fetch pending assignments from Desktop
            try:
                # Wait a bit for connection? task_reminders(resume) is called on startup.
                # If no desktop connection yet, this might fail or timeout.
                # But manager.send_request waits for response.
                # We should probably catch timeout and ignore.
                resp = await manager.send_request("unified_tasks_get_pending", {})
            except Exception:
                return {"ok": False, "error": "connection_failed"}
                
            if not resp.get("ok"):
                return resp
                
            resumed_count = 0
            for p in resp.get("pending", []):
                a = p.get("assignment", {})
                rid = a.get("id")
                if not rid or rid in _REMINDER_TASKS:
                    continue
                
                # Check type
                if a.get("type") != "reminder":
                    continue

                when_iso = a.get("scheduledAt")
                try:
                    target_dt = datetime.fromisoformat(when_iso)
                    if target_dt.tzinfo is None:
                         target_dt = target_dt.replace(tzinfo=datetime.now().astimezone().tzinfo)
                except:
                    continue

                recurrence = a.get("recurring")
                if not isinstance(recurrence, dict): recurrence = None
                
                t = asyncio.create_task(_fire_logic(rid, p.get("task", {}).get("id"), a.get("message"), target_dt, recurrence))
                _REMINDER_TASKS[rid] = t
                resumed_count += 1
                
            return {"ok": True, "scheduled": len(_REMINDER_TASKS), "resumed": resumed_count}

        if action == "schedule":
            when = args.get("when")
            message = str(args.get("message") or "Reminder")
            recurrence = args.get("recurrence")
            taskId = str(args.get("taskId") or "")
            
            # Determine target datetime
            target_dt: Optional[datetime] = None
            
            if isinstance(when, (int, float)):
                target_epoch = float(when) / 1000.0
                target_dt = datetime.fromtimestamp(target_epoch, tz=timezone.utc)
            elif isinstance(when, str):
                s = when.strip()
                try:
                    ss = s.replace('Z', '+00:00')
                    dt = datetime.fromisoformat(ss)
                    if dt.tzinfo is None:
                        local_tz = datetime.now().astimezone().tzinfo
                        dt = dt.replace(tzinfo=local_tz)
                    target_dt = dt
                except Exception:
                    try:
                        delay_sec = 0.0
                        if s.endswith("s"):
                            delay_sec = max(0.0, float(s[:-1]))
                        else:
                            delay_sec = max(0.0, float(s))
                        target_dt = datetime.now().astimezone() + timedelta(seconds=delay_sec)
                    except Exception:
                        target_dt = datetime.now().astimezone()
            
            if not target_dt:
                target_dt = datetime.now().astimezone()

            assignment = {
                "type": "reminder",
                "scheduledAt": target_dt.astimezone().isoformat(),
                "message": message,
                "recurring": recurrence
            }
            
            # If taskId is missing, create a task first? Or fail?
            # User might say "Remind me to X".
            if not taskId:
                # Create a task for it
                t_resp = await manager.send_request("unified_tasks_add", {
                    "title": message,
                    "status": "pending",
                    "priority": "normal"
                })
                if t_resp.get("ok"):
                    taskId = t_resp.get("task", {}).get("id")
                else:
                    return {"ok": False, "error": "failed_to_create_task_for_reminder"}

            resp = await manager.send_request("unified_tasks_add_agent_assignment", {"taskId": taskId, "assignment": assignment})
            
            if resp.get("ok"):
                rid = resp.get("assignment", {}).get("id")
                t = asyncio.create_task(_fire_logic(rid, taskId, message, target_dt, recurrence))
                _REMINDER_TASKS[rid] = t
                
            return resp

        if action == "cancel":
            rid = str(args.get("id") or "").strip()
            
            # First stop local task
            t = _REMINDER_TASKS.pop(rid, None)
            if t: t.cancel()

            # Find and delete in Desktop
            # We need taskId. If we don't have it, we search.
            # If we just removed locally, that's fine for "cancel firing", but we should persist deletion.
            
            pending_resp = await manager.send_request("unified_tasks_get_pending", {})
            if pending_resp.get("ok"):
                 for p in pending_resp.get("pending", []):
                     a = p.get("assignment", {})
                     if a.get("id") == rid:
                         t_id = p.get("task", {}).get("id")
                         return await manager.send_request("unified_tasks_delete_agent_assignment", {"taskId": t_id, "assignmentId": rid})
            
            return {"ok": True, "canceled": True, "note": "Removed from memory, could not find in DB to delete"}
            
    except Exception as e:
        return {"ok": False, "error": str(e)}

    return {"ok": False, "error": "unknown_action"}


async def unified_task_assignments(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    action = str(args.get("action") or "").lower()
    task_id = str(args.get("taskId") or "").strip()
    assignment_id = str(args.get("assignmentId") or "").strip()
    
    try:
        if action == "list_pending":
            return await manager.send_request("unified_tasks_get_pending", {})

        if action == "mark_triggered":
            return await manager.send_request("unified_tasks_mark_triggered", {"taskId": task_id, "assignmentId": assignment_id})

        if action == "mark_completed":
            return await manager.send_request("unified_tasks_mark_completed", {"taskId": task_id, "assignmentId": assignment_id})

        if action == "get_task":
            return await manager.send_request("unified_tasks_get_task", {"taskId": task_id})
            
    except Exception as e:
        return {"ok": False, "error": str(e)}

    return {"ok": False, "error": "unknown_action"}


async def send_notification(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    title = str(args.get("title") or "")
    body = str(args.get("body") or "")
    severity = str(args.get("severity") or "info").lower()
    task_id = str(args.get("taskId") or "")
    workflow_run_id = str(args.get("workflowRunId") or "")

    if not title and not body:
        return {"ok": False, "error": "missing_title_or_body"}

    payload = {
        "type": "progress",
        "event": "notification",
        "data": {
            "id": str(uuid.uuid4()),
            "title": title or "Notification",
            "body": body,
            "severity": severity or "info",
            "taskId": task_id,
            "workflowRunId": workflow_run_id,
            "createdAt": _now_iso(),
        },
    }

    try:
        await manager.broadcast(json.dumps(payload))
    except Exception:
        return {"ok": False, "error": "broadcast_failed"}

    if emit:
        try:
            await emit("notification", payload["data"])
        except Exception:
            pass

    return {"ok": True, "notification": payload["data"]}
