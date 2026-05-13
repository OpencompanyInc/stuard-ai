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
    import calendar as _cal
    freq = str(recurrence.get("frequency") or "daily").lower()
    interval = int(recurrence.get("interval") or 1)
    days = recurrence.get("days")  # List[int] 0=Mon, 6=Sun
    until_str = recurrence.get("until")

    next_dt: Optional[datetime] = None

    if freq == "daily":
        next_dt = last_dt + timedelta(days=interval)

    elif freq == "weekly":
        if days and isinstance(days, list) and len(days) > 0:
            current_weekday = last_dt.weekday()
            sorted_days = sorted([int(d) % 7 for d in days])

            next_day = next((d for d in sorted_days if d > current_weekday), None)
            if next_day is not None:
                next_dt = last_dt + timedelta(days=next_day - current_weekday)
            else:
                first_day = sorted_days[0]
                delta = (7 - current_weekday) + first_day + (7 * max(0, interval - 1))
                next_dt = last_dt + timedelta(days=delta)
        else:
            next_dt = last_dt + timedelta(weeks=interval)

    elif freq == "monthly":
        month = last_dt.month + interval
        year = last_dt.year + (month - 1) // 12
        month = ((month - 1) % 12) + 1
        max_day = _cal.monthrange(year, month)[1]
        next_dt = last_dt.replace(year=year, month=month, day=min(last_dt.day, max_day))

    elif freq == "yearly":
        try:
            next_dt = last_dt.replace(year=last_dt.year + interval)
        except ValueError:
            # Feb 29 in non-leap year → use Feb 28
            next_dt = last_dt.replace(year=last_dt.year + interval, day=28)

    if next_dt is None:
        return None

    # Check 'until' constraint
    if until_str:
        try:
            until_dt = datetime.fromisoformat(str(until_str).replace('Z', '+00:00'))
            if until_dt.tzinfo is None:
                until_dt = until_dt.replace(tzinfo=datetime.now().astimezone().tzinfo)
            if next_dt.astimezone(timezone.utc) > until_dt.astimezone(timezone.utc):
                return None
        except Exception:
            pass

    return next_dt


def _parse_when_to_datetime(when: Any) -> datetime:
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

    return target_dt


async def _get_all_reminders() -> Dict[str, Any]:
    resp = await manager.send_request("unified_tasks_list", {})
    if not isinstance(resp, dict) or not resp.get("ok"):
        return {"ok": False, "error": "failed_to_list_tasks"}

    tasks = resp.get("tasks") or []
    items: List[Dict[str, Any]] = []
    for t in tasks:
        task = t if isinstance(t, dict) else {}
        task_id = task.get("id")
        assignments = task.get("agentAssignments") if isinstance(task.get("agentAssignments"), list) else []
        for a in assignments:
            assignment = a if isinstance(a, dict) else {}
            if assignment.get("type") != "reminder":
                continue
            items.append({
                "task": task,
                "assignment": assignment,
                "taskId": task_id,
            })

    return {"ok": True, "items": items}


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
            resp = await manager.send_request("unified_tasks_get_task", {"taskId": data.get("id")})
            return resp

        if action == "update":
            resp = await manager.send_request("unified_tasks_update", data)
            return resp

        if action == "delete":
            resp = await manager.send_request("unified_tasks_delete", {"id": data.get("id")})
            return resp

        if action in ("add_subtask", "create_subtask"):
            task_id = data.get("taskId")
            subtodo = data.get("subtodo") if isinstance(data.get("subtodo"), dict) else {"content": data.get("content")}
            return await manager.send_request("unified_tasks_add_subtodo", {"taskId": task_id, "subtodo": subtodo})

        if action in ("update_subtask", "edit_subtask"):
            task_id = data.get("taskId")
            subtodo_id = data.get("subtaskId") or data.get("subtodoId")
            updates = data.get("updates") if isinstance(data.get("updates"), dict) else {}
            if data.get("content") is not None:
                updates["content"] = data.get("content")
            return await manager.send_request("unified_tasks_update_subtodo", {
                "taskId": task_id,
                "subtodoId": subtodo_id,
                "updates": updates,
            })

        if action in ("toggle_subtask", "complete_subtask"):
            task_id = data.get("taskId")
            subtodo_id = data.get("subtaskId") or data.get("subtodoId")
            return await manager.send_request("unified_tasks_toggle_subtodo", {"taskId": task_id, "subtodoId": subtodo_id})

        if action in ("delete_subtask", "remove_subtask"):
            task_id = data.get("taskId")
            subtodo_id = data.get("subtaskId") or data.get("subtodoId")
            return await manager.send_request("unified_tasks_delete_subtodo", {"taskId": task_id, "subtodoId": subtodo_id})

        if action in ("add_reminder", "create_reminder"):
            task_id = data.get("taskId")
            assignment = {
                "type": "reminder",
                "scheduledAt": data.get("scheduledAt") or _parse_when_to_datetime(data.get("when")).astimezone().isoformat(),
                "message": data.get("message") or "Reminder",
                "recurring": data.get("recurrence"),
            }
            return await manager.send_request("unified_tasks_add_agent_assignment", {"taskId": task_id, "assignment": assignment})

        if action in ("update_reminder", "edit_reminder"):
            task_id = data.get("taskId")
            reminder_id = data.get("reminderId") or data.get("assignmentId") or data.get("id")
            updates = data.get("updates") if isinstance(data.get("updates"), dict) else {}
            if data.get("scheduledAt") is not None:
                updates["scheduledAt"] = data.get("scheduledAt")
            elif data.get("when") is not None:
                updates["scheduledAt"] = _parse_when_to_datetime(data.get("when")).astimezone().isoformat()
            if data.get("message") is not None:
                updates["message"] = data.get("message")
            if data.get("recurrence") is not None:
                updates["recurring"] = data.get("recurrence")
            return await manager.send_request("unified_tasks_update_agent_assignment", {
                "taskId": task_id,
                "assignmentId": reminder_id,
                "updates": updates,
            })

        if action in ("delete_reminder", "remove_reminder"):
            task_id = data.get("taskId")
            reminder_id = data.get("reminderId") or data.get("assignmentId") or data.get("id")
            return await manager.send_request("unified_tasks_delete_agent_assignment", {
                "taskId": task_id,
                "assignmentId": reminder_id,
            })

    except Exception as e:
        return {"ok": False, "error": str(e)}

    return {"ok": False, "error": "unknown_action"}


async def _assignment_still_exists(assignment_id: str) -> bool:
    """Check whether the assignment is still present and pending in the DB.

    The desktop reminder scheduler may have already fired and marked it completed,
    or the user may have deleted it. In either case we should not double-fire.
    """
    try:
        resp = await manager.send_request("unified_tasks_find_assignment", {"assignmentId": assignment_id})
        if not isinstance(resp, dict) or not resp.get("ok"):
            return False
        assignment = resp.get("assignment") or {}
        status = str(assignment.get("status") or "pending").lower()
        return status == "pending"
    except Exception:
        # If we can't verify (e.g. desktop bridge down), default to firing — the
        # in-app notification is more useful than silent suppression.
        return True


async def task_reminders(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    action = str(args.get("action") or "").lower()
    if action not in ("schedule", "update", "cancel", "delete", "list", "resume"):
        return {"ok": False, "error": "unknown_action"}

    # Common firing logic
    async def _fire_logic(assignment_id: str, task_id: str, message: str, target_dt: datetime, recurrence: Optional[Dict]):
        try:
            # Wait until target time
            now_ts = datetime.now(timezone.utc).timestamp()
            target_ts = target_dt.astimezone(timezone.utc).timestamp()
            delay = max(0.0, target_ts - now_ts)

            await asyncio.sleep(delay)

            # Skip firing if the assignment was deleted, cancelled, or already
            # handled by the desktop scheduler while we were sleeping.
            if not await _assignment_still_exists(assignment_id):
                _REMINDER_TASKS.pop(assignment_id, None)
                return

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
            updated_recurrence: Optional[Dict] = None
            next_dt_val: Optional[datetime] = None

            if isinstance(recurrence, dict) and recurrence:
                # Check count: if count is set, decrement and stop when exhausted
                count = recurrence.get("count")
                if count is not None:
                    remaining = int(count) - 1
                    if remaining <= 0:
                        next_dt_val = None
                    else:
                        updated_recurrence = dict(recurrence)
                        updated_recurrence["count"] = remaining
                        next_dt_val = _calculate_next_occurrence(target_dt, updated_recurrence)
                else:
                    updated_recurrence = recurrence
                    next_dt_val = _calculate_next_occurrence(target_dt, recurrence)

                # Fast-forward past any missed occurrences so we don't fire stale ones.
                now_local = datetime.now().astimezone()
                skipped = 0
                while next_dt_val and next_dt_val.astimezone(timezone.utc) <= now_local.astimezone(timezone.utc) and skipped < 1000:
                    if updated_recurrence:
                        count_val = updated_recurrence.get("count")
                        if count_val is not None:
                            remaining = int(count_val) - 1
                            if remaining <= 0:
                                next_dt_val = None
                                updated_recurrence = None
                                break
                            updated_recurrence = dict(updated_recurrence)
                            updated_recurrence["count"] = remaining
                    next_dt_val = _calculate_next_occurrence(next_dt_val, updated_recurrence) if updated_recurrence else None
                    skipped += 1

            if next_dt_val and updated_recurrence:
                # Reschedule in Unified Tasks
                next_iso = next_dt_val.astimezone().isoformat()
                try:
                    await manager.send_request("unified_tasks_update_agent_assignment", {
                        "taskId": task_id,
                        "assignmentId": assignment_id,
                        "updates": {
                            "scheduledAt": next_iso,
                            "recurring": updated_recurrence,
                            "status": "pending",
                            "triggeredAt": None,
                        }
                    })
                except Exception:
                    pass

                # Schedule next run in memory
                t = asyncio.create_task(_fire_logic(assignment_id, task_id, message, next_dt_val, updated_recurrence))
                _REMINDER_TASKS[assignment_id] = t
            else:
                # Mark completed
                try:
                    await manager.send_request("unified_tasks_update_agent_assignment", {
                        "taskId": task_id,
                        "assignmentId": assignment_id,
                        "updates": {
                            "status": "completed",
                            "completedAt": _now_iso(),
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
            resp = await _get_all_reminders()
            if not resp.get("ok"):
                return resp

            items = []
            for p in resp.get("items", []):
                a = p.get("assignment", {})
                t = p.get("task", {})
                if a.get("status") != "pending":
                    continue
                items.append({
                    "id": a.get("id"),
                    "taskId": t.get("id"),
                    "message": a.get("message"),
                    "whenIso": a.get("scheduledAt"),
                    "recurrence": a.get("recurring") if isinstance(a.get("recurring"), dict) else None
                })
            return {"ok": True, "items": items}

        if action == "resume":
            try:
                resp = await _get_all_reminders()
            except Exception:
                return {"ok": False, "error": "connection_failed"}
                
            if not resp.get("ok"):
                return resp
                
            resumed_count = 0
            for p in resp.get("items", []):
                a = p.get("assignment", {})
                rid = a.get("id")
                if not rid or rid in _REMINDER_TASKS:
                    continue
                
                if a.get("type") != "reminder" or a.get("status") != "pending":
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
                
                t = asyncio.create_task(_fire_logic(rid, p.get("taskId"), a.get("message"), target_dt, recurrence))
                _REMINDER_TASKS[rid] = t
                resumed_count += 1
                
            return {"ok": True, "scheduled": len(_REMINDER_TASKS), "resumed": resumed_count}

        if action == "schedule":
            when = args.get("when")
            message = str(args.get("message") or "Reminder")
            recurrence = args.get("recurrence")
            taskId = str(args.get("taskId") or "")
            
            target_dt = _parse_when_to_datetime(when)

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

        if action == "update":
            rid = str(args.get("id") or "").strip()
            task_id_hint = str(args.get("taskId") or "").strip()

            if not rid:
                return {"ok": False, "error": "missing_id"}

            # Find the assignment across all tasks (don't depend on status — we want
            # to support resurrecting completed/triggered ones if the user is updating).
            find_resp = await manager.send_request("unified_tasks_find_assignment", {"assignmentId": rid})
            assignment: Dict[str, Any] = {}
            task_id = ""
            if isinstance(find_resp, dict) and find_resp.get("ok"):
                assignment = find_resp.get("assignment") or {}
                task_obj = find_resp.get("task") or {}
                task_id = str(task_obj.get("id") or "")
            else:
                # Fallback: walk the full list (covers older bridges without the new event)
                all_resp = await _get_all_reminders()
                if all_resp.get("ok"):
                    for p in all_resp.get("items", []):
                        a = p.get("assignment", {})
                        if a.get("id") == rid:
                            assignment = a
                            task_id = str(p.get("taskId") or "")
                            break

            if not assignment or not task_id:
                return {"ok": False, "error": "reminder_not_found"}

            if task_id_hint and task_id_hint != task_id:
                return {"ok": False, "error": "task_id_mismatch"}

            updates: Dict[str, Any] = {}
            target_dt: Optional[datetime] = None

            if args.get("when") is not None:
                target_dt = _parse_when_to_datetime(args.get("when"))
                updates["scheduledAt"] = target_dt.astimezone().isoformat()
            elif args.get("scheduledAt") is not None:
                try:
                    parsed = datetime.fromisoformat(str(args.get("scheduledAt")).replace('Z', '+00:00'))
                    if parsed.tzinfo is None:
                        parsed = parsed.replace(tzinfo=datetime.now().astimezone().tzinfo)
                    target_dt = parsed
                except Exception:
                    target_dt = None
                updates["scheduledAt"] = str(args.get("scheduledAt"))

            if args.get("message") is not None:
                updates["message"] = str(args.get("message") or "")

            if "recurrence" in args:
                # Allow caller to clear recurrence by passing null/None explicitly.
                rec = args.get("recurrence")
                if rec is None or rec == "none":
                    updates["recurring"] = None
                else:
                    updates["recurring"] = rec

            if not updates:
                return {"ok": False, "error": "no_updates"}

            # If the user is changing scheduledAt and the reminder was already
            # completed/triggered, resurrect it back to pending so it fires again.
            current_status = str(assignment.get("status") or "pending").lower()
            if "scheduledAt" in updates and current_status != "pending":
                updates["status"] = "pending"
                updates["triggeredAt"] = None
                updates["completedAt"] = None

            resp = await manager.send_request("unified_tasks_update_agent_assignment", {
                "taskId": task_id,
                "assignmentId": rid,
                "updates": updates,
            })

            if isinstance(resp, dict) and resp.get("ok"):
                # Cancel any existing in-memory firing task; we'll requeue below if appropriate.
                t = _REMINDER_TASKS.pop(rid, None)
                if t:
                    t.cancel()

                # Resolve effective scheduledAt
                if target_dt is None:
                    try:
                        existing_iso = str(updates.get("scheduledAt") or assignment.get("scheduledAt") or "")
                        if existing_iso:
                            parsed = datetime.fromisoformat(existing_iso.replace('Z', '+00:00'))
                            if parsed.tzinfo is None:
                                parsed = parsed.replace(tzinfo=datetime.now().astimezone().tzinfo)
                            target_dt = parsed
                    except Exception:
                        target_dt = None

                effective_status = str(updates.get("status") or assignment.get("status") or "pending").lower()
                if target_dt and effective_status == "pending":
                    message = str(updates.get("message") if updates.get("message") is not None else assignment.get("message") or "Reminder")
                    if "recurring" in updates:
                        recurrence = updates.get("recurring")
                    else:
                        recurrence = assignment.get("recurring")
                    if not isinstance(recurrence, dict):
                        recurrence = None
                    _REMINDER_TASKS[rid] = asyncio.create_task(_fire_logic(rid, task_id, message, target_dt, recurrence))

            return resp

        if action in ("cancel", "delete"):
            rid = str(args.get("id") or "").strip()
            task_id_hint = str(args.get("taskId") or "").strip()

            if not rid:
                return {"ok": False, "error": "missing_id"}

            # Always cancel the in-memory firing task first so it can't fire
            # against a now-deleted assignment.
            t = _REMINDER_TASKS.pop(rid, None)
            if t:
                t.cancel()

            # Try the targeted delete first (cheaper); the unified-tasks service
            # also falls back to a global search if taskId is missing/stale.
            resp = await manager.send_request("unified_tasks_delete_agent_assignment", {
                "taskId": task_id_hint or None,
                "assignmentId": rid,
            })

            if isinstance(resp, dict) and resp.get("ok"):
                return {"ok": True, "deleted": bool(resp.get("removed", True)), "id": rid}

            # As a last resort, scan and try again (older bridges without the global-search path)
            all_resp = await _get_all_reminders()
            if isinstance(all_resp, dict) and all_resp.get("ok"):
                for p in all_resp.get("items", []):
                    a = p.get("assignment", {})
                    if a.get("id") == rid:
                        retry = await manager.send_request("unified_tasks_delete_agent_assignment", {
                            "taskId": p.get("taskId"),
                            "assignmentId": rid,
                        })
                        if isinstance(retry, dict) and retry.get("ok"):
                            return {"ok": True, "deleted": True, "id": rid}

            # Nothing to delete in storage but we did cancel the in-memory task — treat as success.
            return {"ok": True, "deleted": False, "id": rid, "note": "no_persisted_assignment"}
            
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
