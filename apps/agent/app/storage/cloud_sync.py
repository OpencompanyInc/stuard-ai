"""
Cloud Sync Service

End-to-end encrypted cloud synchronization for conversations.
Data is encrypted locally before upload using a user-provided sync password.
Supabase stores only encrypted blobs - no plaintext data.
"""

from __future__ import annotations

import os
import sys
import json
import logging
import hashlib
import base64
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict

from .crypto import derive_key, encrypt, decrypt

logger = logging.getLogger("agent")

# Sync chunk size (max items per sync batch)
SYNC_BATCH_SIZE = 50


@dataclass
class SyncPacket:
    """Encrypted sync packet for cloud storage."""
    id: str  # Unique packet ID
    device_id: str  # Source device ID
    entity_type: str  # 'conversation', 'message', 'segment'
    entity_id: str  # ID of the entity
    operation: str  # 'create', 'update', 'delete'
    encrypted_data: str  # Base64-encoded encrypted JSON
    checksum: str  # SHA256 of plaintext for integrity
    created_at: str  # ISO timestamp
    version: int  # Schema version for migrations
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SyncPacket':
        return cls(**data)


class CloudSyncService:
    """
    Handles encrypted cloud synchronization.
    
    Flow:
    1. User enables sync and sets a sync password
    2. Sync password is used to derive encryption key (PBKDF2)
    3. Local changes are encrypted and queued for upload
    4. Encrypted packets are uploaded to Supabase
    5. On other devices, packets are downloaded and decrypted
    6. Conflicts are resolved by timestamp (last-write-wins)
    """
    
    def __init__(self, user_id: str, device_id: str):
        self.user_id = user_id
        self.device_id = device_id
        self._sync_key: Optional[bytes] = None
        self._supabase_url = os.getenv("SUPABASE_URL")
        self._supabase_key = os.getenv("SUPABASE_ANON_KEY")
    
    def set_sync_password(self, password: str) -> None:
        """Derive and store the sync encryption key from password."""
        # Use user_id as salt for key derivation
        salt = hashlib.sha256(f"stuard-sync-{self.user_id}".encode()).digest()[:16]
        self._sync_key = derive_key(password, salt)
    
    def is_configured(self) -> bool:
        """Check if sync is properly configured."""
        return (
            self._sync_key is not None and
            self._supabase_url is not None and
            self._supabase_key is not None
        )
    
    def _encrypt_entity(self, entity: Dict[str, Any]) -> Tuple[str, str]:
        """Encrypt an entity and return (encrypted_data, checksum)."""
        if not self._sync_key:
            raise ValueError("Sync password not set")
        
        plaintext = json.dumps(entity, separators=(',', ':'), ensure_ascii=False)
        checksum = hashlib.sha256(plaintext.encode()).hexdigest()[:16]
        encrypted = encrypt(plaintext.encode('utf-8'), self._sync_key)
        encrypted_b64 = base64.b64encode(encrypted).decode('ascii')
        
        return encrypted_b64, checksum
    
    def _decrypt_entity(self, encrypted_b64: str, expected_checksum: str) -> Dict[str, Any]:
        """Decrypt an entity and verify checksum."""
        if not self._sync_key:
            raise ValueError("Sync password not set")
        
        encrypted = base64.b64decode(encrypted_b64)
        plaintext = decrypt(encrypted, self._sync_key).decode('utf-8')
        
        # Verify checksum
        actual_checksum = hashlib.sha256(plaintext.encode()).hexdigest()[:16]
        if actual_checksum != expected_checksum:
            raise ValueError("Checksum mismatch - data may be corrupted")
        
        return json.loads(plaintext)
    
    def create_sync_packet(
        self,
        entity_type: str,
        entity_id: str,
        operation: str,
        entity_data: Dict[str, Any]
    ) -> SyncPacket:
        """Create an encrypted sync packet for an entity."""
        import uuid
        
        encrypted_data, checksum = self._encrypt_entity(entity_data)
        
        return SyncPacket(
            id=str(uuid.uuid4()),
            device_id=self.device_id,
            entity_type=entity_type,
            entity_id=entity_id,
            operation=operation,
            encrypted_data=encrypted_data,
            checksum=checksum,
            created_at=datetime.utcnow().isoformat() + 'Z',
            version=1,
        )
    
    def decrypt_sync_packet(self, packet: SyncPacket) -> Dict[str, Any]:
        """Decrypt a sync packet and return the entity data."""
        return self._decrypt_entity(packet.encrypted_data, packet.checksum)
    
    async def upload_packets(self, packets: List[SyncPacket]) -> Dict[str, Any]:
        """Upload encrypted sync packets to Supabase."""
        if not self.is_configured():
            return {"ok": False, "error": "sync_not_configured"}
        
        try:
            import httpx
            
            headers = {
                "apikey": self._supabase_key,
                "Authorization": f"Bearer {self._supabase_key}",
                "Content-Type": "application/json",
            }
            
            # Insert packets into memory_sync table
            rows = [
                {
                    "id": p.id,
                    "user_id": self.user_id,
                    "device_id": p.device_id,
                    "entity_type": p.entity_type,
                    "entity_id": p.entity_id,
                    "operation": p.operation,
                    "encrypted_data": p.encrypted_data,
                    "checksum": p.checksum,
                    "version": p.version,
                }
                for p in packets
            ]
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self._supabase_url}/rest/v1/memory_sync",
                    headers=headers,
                    json=rows,
                )
                
                if response.status_code not in (200, 201):
                    return {"ok": False, "error": response.text}
            
            return {"ok": True, "uploaded": len(packets)}
        
        except Exception as e:
            logger.exception("upload_packets failed")
            return {"ok": False, "error": str(e)}
    
    async def download_packets(
        self,
        since: Optional[str] = None,
        entity_type: Optional[str] = None,
        limit: int = 100
    ) -> Dict[str, Any]:
        """Download encrypted sync packets from Supabase."""
        if not self.is_configured():
            return {"ok": False, "error": "sync_not_configured", "packets": []}
        
        try:
            import httpx
            
            headers = {
                "apikey": self._supabase_key,
                "Authorization": f"Bearer {self._supabase_key}",
            }
            
            # Build query
            url = f"{self._supabase_url}/rest/v1/memory_sync"
            params = {
                "user_id": f"eq.{self.user_id}",
                "order": "created_at.asc",
                "limit": str(limit),
            }
            
            if since:
                params["created_at"] = f"gt.{since}"
            if entity_type:
                params["entity_type"] = f"eq.{entity_type}"
            
            # Exclude packets from this device (already have them)
            params["device_id"] = f"neq.{self.device_id}"
            
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers, params=params)
                
                if response.status_code != 200:
                    return {"ok": False, "error": response.text, "packets": []}
                
                rows = response.json()
            
            packets = [
                SyncPacket(
                    id=row["id"],
                    device_id=row["device_id"],
                    entity_type=row["entity_type"],
                    entity_id=row["entity_id"],
                    operation=row["operation"],
                    encrypted_data=row["encrypted_data"],
                    checksum=row["checksum"],
                    created_at=row["created_at"],
                    version=row["version"],
                )
                for row in rows
            ]
            
            return {"ok": True, "packets": packets}
        
        except Exception as e:
            logger.exception("download_packets failed")
            return {"ok": False, "error": str(e), "packets": []}
    
    async def sync_full(self, memory_db: Any) -> Dict[str, Any]:
        """
        Perform a full sync cycle.
        
        1. Process pending local changes (upload)
        2. Download remote changes
        3. Apply remote changes locally
        4. Mark sync complete
        """
        if not self.is_configured():
            return {"ok": False, "error": "sync_not_configured"}
        
        stats = {
            "uploaded": 0,
            "downloaded": 0,
            "applied": 0,
            "conflicts": 0,
            "errors": [],
        }
        
        try:
            # 1. Get pending sync items from local DB
            pending = memory_db.get_pending_sync(limit=SYNC_BATCH_SIZE)
            
            if pending:
                # Create packets for pending items
                packets = []
                for item in pending:
                    try:
                        packet = self.create_sync_packet(
                            entity_type=item["entity_type"],
                            entity_id=item["entity_id"],
                            operation=item["operation"],
                            entity_data=item["data"],
                        )
                        packets.append((packet, item["id"]))
                    except Exception as e:
                        stats["errors"].append(f"create_packet: {e}")
                
                # Upload packets
                if packets:
                    result = await self.upload_packets([p for p, _ in packets])
                    if result.get("ok"):
                        stats["uploaded"] = result.get("uploaded", 0)
                        # Mark as synced
                        for _, sync_id in packets:
                            try:
                                memory_db.mark_synced(sync_id)
                            except Exception as e:
                                stats["errors"].append(f"mark_synced: {e}")
                    else:
                        stats["errors"].append(f"upload: {result.get('error')}")
            
            # 2. Download remote changes
            settings = memory_db.get_security_settings()
            last_sync = settings.last_sync_at if settings else None
            
            download_result = await self.download_packets(since=last_sync)
            
            if download_result.get("ok"):
                remote_packets = download_result.get("packets", [])
                stats["downloaded"] = len(remote_packets)
                
                # 3. Apply remote changes
                for packet in remote_packets:
                    try:
                        entity_data = self.decrypt_sync_packet(packet)
                        
                        # Apply based on entity type and operation
                        applied = self._apply_remote_change(
                            memory_db,
                            packet.entity_type,
                            packet.entity_id,
                            packet.operation,
                            entity_data,
                            packet.created_at,
                        )
                        
                        if applied:
                            stats["applied"] += 1
                        else:
                            stats["conflicts"] += 1
                    
                    except Exception as e:
                        stats["errors"].append(f"apply: {e}")
                
                # 4. Update last sync timestamp
                if remote_packets:
                    latest = max(p.created_at for p in remote_packets)
                    memory_db.update_security_settings(last_sync_at=latest)
            else:
                stats["errors"].append(f"download: {download_result.get('error')}")
            
            return {"ok": True, "stats": stats}
        
        except Exception as e:
            logger.exception("sync_full failed")
            return {"ok": False, "error": str(e), "stats": stats}
    
    def _apply_remote_change(
        self,
        memory_db: Any,
        entity_type: str,
        entity_id: str,
        operation: str,
        entity_data: Dict[str, Any],
        remote_timestamp: str,
    ) -> bool:
        """
        Apply a remote change to the local database.
        Returns True if applied, False if conflict (local is newer).
        """
        # Simple last-write-wins conflict resolution
        # More sophisticated CRDT-based resolution could be added later
        
        if operation == "delete":
            if entity_type == "conversation":
                memory_db.update_conversation(entity_id, status="deleted")
            return True
        
        if entity_type == "conversation":
            existing = memory_db.get_conversation(entity_id)
            if existing and existing.updated_at > remote_timestamp:
                return False  # Local is newer
            
            if operation == "create" and not existing:
                memory_db.create_conversation(
                    title=entity_data.get("title"),
                    model=entity_data.get("model"),
                    conversation_id=entity_id,
                )
            elif operation == "update" and existing:
                memory_db.update_conversation(
                    entity_id,
                    title=entity_data.get("title"),
                    status=entity_data.get("status"),
                )
            return True
        
        if entity_type == "message":
            # Messages are append-only, just insert if not exists
            conversation_id = entity_data.get("conversation_id")
            if conversation_id:
                # Check if message exists by checking turn index
                messages = memory_db.get_messages(conversation_id)
                existing_ids = {m.id for m in messages}
                if entity_id not in existing_ids:
                    memory_db.add_message(
                        conversation_id=conversation_id,
                        role=entity_data.get("role", "user"),
                        content=entity_data.get("content", ""),
                        tool_calls=entity_data.get("tool_calls"),
                        tool_results=entity_data.get("tool_results"),
                        attachments=entity_data.get("attachments"),
                    )
            return True
        
        return False


# Singleton instances
_sync_service: Optional[CloudSyncService] = None


def get_sync_service(user_id: str, device_id: str) -> CloudSyncService:
    """Get or create the sync service singleton."""
    global _sync_service
    if _sync_service is None or _sync_service.user_id != user_id:
        _sync_service = CloudSyncService(user_id, device_id)
    return _sync_service
