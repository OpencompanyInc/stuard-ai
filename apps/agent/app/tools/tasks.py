from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, List

from ..storage import tasks_db
from ..connections import manager

# In-memory scheduled jobs map (metadata persisted in SQLite)
_REMINDER_TASKS: Dict[str, asyncio.Task] = {}


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def _ensure_default_calendar() -> str:
    try:
        return tasks_db.ensure_default_calendar()
    except Exception:
        # Fallback to UUID if DB failed (should not happen)
        return str(uuid.uuid4())


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
    action = str(args.get("action") or "").lower()
    data = args.get("data") or {}

    if action == "list":
        items = tasks_db.list_calendars()
        if not items:
            try:
                tasks_db.ensure_default_calendar()
            except Exception:
                pass
            items = tasks_db.list_calendars()
        return {"ok": True, "items": items}
    if action == "create":
        name = str(data.get("name") or "Untitled")
        cid = str(uuid.uuid4())
        cal = tasks_db.create_calendar(cid, name)
        return {"ok": True, "calendar": cal}
    if action == "read":
        cid = str(data.get("id") or "").strip()
        cal = tasks_db.read_calendar(cid)
        return {"ok": bool(cal), "calendar": cal}
    if action == "update":
        cid = str(data.get("id") or "").strip()
        name = data.get("name") if ("name" in data) else None
        cal = tasks_db.update_calendar(cid, name if (isinstance(name, str) or name is None) else None)
        if not cal:
            return {"ok": False, "error": "not_found"}
        return {"ok": True, "calendar": cal}
    if action == "delete":
        cid = str(data.get("id") or "").strip()
        ok = tasks_db.delete_calendar(cid)
        return {"ok": bool(ok)}

    return {"ok": False, "error": "unknown_action"}


async def task_crud(args: Dict[str, Any]) -> Dict[str, Any]:
    action = str(args.get("action") or "").lower()
    data = args.get("data") or {}

    if action == "list":
        cal = str(data.get("calendarId") or "").strip()
        items = tasks_db.list_tasks(cal if cal else None)
        return {"ok": True, "items": items}

    if action == "create":
        title = str(data.get("title") or "Untitled Task")
        calendar_id = str(data.get("calendarId") or "").strip() or _ensure_default_calendar()
        tid = str(uuid.uuid4())
        due = data.get("due")
        priority = str(data.get("priority") or "normal")
        tags = data.get("tags") or []
        recurrence = data.get("recurrence")
        if not isinstance(tags, list):
            tags = []
        completed = bool(data.get("completed") or False)
        task = tasks_db.create_task(tid, title, calendar_id, due, priority, tags, completed, recurrence)
        return {"ok": True, "task": task}

    if action == "read":
        tid = str(data.get("id") or "").strip()
        task = tasks_db.read_task(tid)
        return {"ok": bool(task), "task": task}

    if action == "update":
        tid = str(data.get("id") or "").strip()
        changes = {k: data[k] for k in ("title", "calendarId", "due", "priority", "tags", "completed", "recurrence") if k in data}
        task = tasks_db.update_task(tid, changes)
        if not task:
            return {"ok": False, "error": "not_found"}
        return {"ok": True, "task": task}

    if action == "delete":
        tid = str(data.get("id") or "").strip()
        ok = tasks_db.delete_task(tid)
        return {"ok": bool(ok)}

    return {"ok": False, "error": "unknown_action"}


async def task_reminders(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    action = str(args.get("action") or "").lower()
    if action not in ("schedule", "cancel", "list", "resume"):
        return {"ok": False, "error": "unknown_action"}

    if action == "list":
        return {"ok": True, "items": tasks_db.list_active_reminders()}

    # Common firing logic
    async def _fire_logic(rid: str, task_id: str, message: str, target_dt: datetime, recurrence: Optional[Dict]):
        try:
            # Wait until target time
            now_ts = datetime.now(timezone.utc).timestamp()
            target_ts = target_dt.astimezone(timezone.utc).timestamp()
            delay = max(0.0, target_ts - now_ts)
            
            await asyncio.sleep(delay)
            
            # Fire!
            # Broadcast reminder trigger event
            try:
                await manager.broadcast(__import__('json').dumps({
                    "type": "progress",
                    "event": "reminder_triggered",
                    "data": {"id": rid, "taskId": task_id, "message": message},
                }))
            except Exception:
                pass
            if emit:
                try:
                    await emit("reminder_triggered", {"id": rid, "taskId": task_id, "message": message})
                except Exception:
                    pass
            
            # Handle recurrence or finish
            next_dt = _calculate_next_occurrence(target_dt, recurrence) if recurrence else None
            
            if next_dt:
                # Reschedule
                next_iso = next_dt.astimezone().isoformat()
                next_epoch = int(next_dt.astimezone(timezone.utc).timestamp() * 1000)
                try:
                    tasks_db.update_reminder_reschedule(rid, next_iso, next_epoch)
                except Exception:
                    pass
                
                # Schedule next run in memory
                t = asyncio.create_task(_fire_logic(rid, task_id, message, next_dt, recurrence))
                _REMINDER_TASKS[rid] = t
            else:
                # Mark done
                try:
                    tasks_db.mark_fired(rid)
                except Exception:
                    pass
                _REMINDER_TASKS.pop(rid, None)
                
        except asyncio.CancelledError:
            pass
        except Exception:
            # If error, remove from map
            _REMINDER_TASKS.pop(rid, None)

    if action == "resume":
        try:
            items = tasks_db.list_active_reminders()
            resumed_count = 0
            for it in items:
                rid = str(it.get("id") or "").strip()
                if not rid or rid in _REMINDER_TASKS:
                    continue
                
                when_iso = str(it.get("whenIso"))
                try:
                    target_dt = datetime.fromisoformat(when_iso)
                    if target_dt.tzinfo is None:
                         target_dt = target_dt.replace(tzinfo=datetime.now().astimezone().tzinfo)
                except:
                    continue

                recurrence = it.get("recurrence")
                t = asyncio.create_task(_fire_logic(rid, str(it.get("taskId") or ""), str(it.get("message") or ""), target_dt, recurrence))
                _REMINDER_TASKS[rid] = t
                resumed_count += 1
            return {"ok": True, "scheduled": len(_REMINDER_TASKS), "resumed": resumed_count}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    if action == "schedule":
        when = args.get("when")
        message = str(args.get("message") or "Reminder")
        recurrence = args.get("recurrence") # Dict or None
        rid = str(uuid.uuid4())

        # Determine target datetime
        target_dt: Optional[datetime] = None
        now_utc_ts = datetime.now(timezone.utc).timestamp()
        
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

        meta = {
            "id": rid,
            "message": message,
            "taskId": str(args.get("taskId") or ""),
            "whenIso": target_dt.astimezone().isoformat(),
            "whenEpochMs": int(target_dt.astimezone(timezone.utc).timestamp() * 1000),
            "createdAt": _now_iso(),
        }
        try:
            tasks_db.insert_reminder(rid, meta["taskId"], meta["message"], meta["whenIso"], meta["whenEpochMs"], recurrence)
        except Exception:
            pass

        t = asyncio.create_task(_fire_logic(rid, meta["taskId"], meta["message"], target_dt, recurrence))
        _REMINDER_TASKS[rid] = t
        
        delay_sec = max(0.0, target_dt.astimezone(timezone.utc).timestamp() - now_utc_ts)
        return {"ok": True, "id": rid, "scheduledInSeconds": delay_sec, "whenIso": meta["whenIso"], "whenEpochMs": meta["whenEpochMs"]}

    if action == "cancel":
        rid = str(args.get("id") or "").strip()
        t = _REMINDER_TASKS.pop(rid, None)
        try:
            tasks_db.cancel_reminder(rid)
        except Exception:
            pass
        if t:
            try:
                t.cancel()
            except Exception:
                pass
            return {"ok": True, "id": rid, "canceled": True}
        return {"ok": False, "error": "not_found"}

    return {"ok": False, "error": "unknown_action"}


async def unified_task_assignments(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    """
    Manage user task assignments from the desktop unified tasks system.
    This tool allows the agent to interact with tasks assigned by the user.
    """
    action = str(args.get("action") or "").lower()
    task_id = str(args.get("taskId") or "").strip()
    assignment_id = str(args.get("assignmentId") or "").strip()

    # This tool communicates with the desktop app via IPC
    # The desktop app exposes the unified tasks API
    
    if action == "list_pending":
        # Request pending assignments from desktop
        try:
            await manager.broadcast(__import__('json').dumps({
                "type": "request",
                "event": "unified_tasks_get_pending",
                "data": {},
            }))
            return {"ok": True, "message": "Requested pending assignments from desktop. Check context for results."}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    if action == "mark_triggered":
        if not task_id or not assignment_id:
            return {"ok": False, "error": "taskId and assignmentId are required"}
        try:
            await manager.broadcast(__import__('json').dumps({
                "type": "request",
                "event": "unified_tasks_mark_triggered",
                "data": {"taskId": task_id, "assignmentId": assignment_id},
            }))
            return {"ok": True, "message": f"Marked assignment {assignment_id} as triggered."}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    if action == "mark_completed":
        if not task_id or not assignment_id:
            return {"ok": False, "error": "taskId and assignmentId are required"}
        try:
            await manager.broadcast(__import__('json').dumps({
                "type": "request",
                "event": "unified_tasks_mark_completed",
                "data": {"taskId": task_id, "assignmentId": assignment_id},
            }))
            return {"ok": True, "message": f"Marked assignment {assignment_id} as completed."}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    if action == "get_task":
        if not task_id:
            return {"ok": False, "error": "taskId is required"}
        try:
            await manager.broadcast(__import__('json').dumps({
                "type": "request",
                "event": "unified_tasks_get_task",
                "data": {"taskId": task_id},
            }))
            return {"ok": True, "message": f"Requested task {task_id} details from desktop."}
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
        await manager.broadcast(__import__("json").dumps(payload))
    except Exception:
        return {"ok": False, "error": "broadcast_failed"}

    if emit:
        try:
            await emit("notification", payload["data"])
        except Exception:
            pass

    return {"ok": True, "notification": payload["data"]}
