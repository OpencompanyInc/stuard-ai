"""
Cross-Platform Encryption Layer for Stuard Memory System

Provides:
- Device key storage via OS keychain (Windows DPAPI, macOS Keychain, Linux Secret Service)
- AES-256-GCM encryption for data at rest
- Key derivation from device key + optional user password
- Secure key rotation support
"""

from __future__ import annotations

import os
import sys
import base64
import hashlib
import secrets
from typing import Optional, Tuple
from dataclasses import dataclass

import keyring
import keyring.errors
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend

# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════

SERVICE_NAME = "StuardAI"
DEVICE_KEY_ACCOUNT = "device_master_key"
SALT_ACCOUNT = "encryption_salt"
KEY_SIZE = 32  # AES-256
NONCE_SIZE = 12  # GCM standard
PBKDF2_ITERATIONS = 100_000

# Prefix marker for values stored without encryption. Lets the same column
# hold either an AES-GCM base64 ciphertext or a plaintext string without an
# ambiguity (base64 cannot contain ':').
PLAINTEXT_PREFIX = "pt1:"


def _plaintext_mode_enabled() -> bool:
    """True when the runtime has opted out of memory.db encryption.

    Set on the VM (where the user's device key never lives) so conversation
    rows remain readable after sync. Desktop runs leave this unset and keep
    encrypting at rest.
    """
    return os.getenv("STUARD_MEMORY_PLAINTEXT", "").strip() in ("1", "true", "yes")


# ═══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class EncryptedData:
    """Container for encrypted data with nonce."""
    nonce: bytes
    ciphertext: bytes
    
    def to_bytes(self) -> bytes:
        """Serialize to bytes (nonce + ciphertext)."""
        return self.nonce + self.ciphertext
    
    @classmethod
    def from_bytes(cls, data: bytes) -> "EncryptedData":
        """Deserialize from bytes."""
        if len(data) < NONCE_SIZE:
            raise ValueError("Invalid encrypted data: too short")
        return cls(nonce=data[:NONCE_SIZE], ciphertext=data[NONCE_SIZE:])
    
    def to_base64(self) -> str:
        """Encode as base64 string."""
        return base64.b64encode(self.to_bytes()).decode('utf-8')
    
    @classmethod
    def from_base64(cls, data: str) -> "EncryptedData":
        """Decode from base64 string."""
        return cls.from_bytes(base64.b64decode(data))


# ═══════════════════════════════════════════════════════════════════════════════
# DEVICE KEY MANAGEMENT (OS Keychain)
# ═══════════════════════════════════════════════════════════════════════════════

def _get_keyring_backend_name() -> str:
    """Get the name of the active keyring backend."""
    backend = keyring.get_keyring()
    return type(backend).__name__


# ─── File-based fallback for headless environments (e.g. Linux VMs) ───────────

_KEY_FILE_DIR = os.path.join(os.path.expanduser("~"), ".stuard", "keys")


def _file_key_path(account: str) -> str:
    return os.path.join(_KEY_FILE_DIR, f"{account}.key")


def _file_get(account: str) -> Optional[str]:
    path = _file_key_path(account)
    try:
        if os.path.exists(path):
            with open(path, "r") as f:
                return f.read().strip() or None
    except OSError:
        pass
    return None


def _file_set(account: str, value: str) -> None:
    os.makedirs(_KEY_FILE_DIR, mode=0o700, exist_ok=True)
    path = _file_key_path(account)
    with open(path, "w") as f:
        f.write(value)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _keyring_get(account: str) -> Optional[str]:
    try:
        return keyring.get_password(SERVICE_NAME, account)
    except (keyring.errors.NoKeyringError, Exception):
        return _file_get(account)


def _keyring_set(account: str, value: str) -> None:
    try:
        keyring.set_password(SERVICE_NAME, account, value)
    except (keyring.errors.NoKeyringError, Exception):
        _file_set(account, value)


# ─────────────────────────────────────────────────────────────────────────────


def get_device_key() -> bytes:
    """
    Get or create the device master key from OS keychain, with file-based
    fallback for headless Linux environments (e.g. GCE VMs) where no keyring
    backend is available.
    """
    stored = _keyring_get(DEVICE_KEY_ACCOUNT)

    if stored:
        return base64.b64decode(stored)

    device_key = secrets.token_bytes(KEY_SIZE)
    _keyring_set(DEVICE_KEY_ACCOUNT, base64.b64encode(device_key).decode('utf-8'))

    print(f"[crypto] Created new device key using {_get_keyring_backend_name()}")
    return device_key


def get_salt() -> bytes:
    """Get or create the encryption salt."""
    stored = _keyring_get(SALT_ACCOUNT)

    if stored:
        return base64.b64decode(stored)

    salt = secrets.token_bytes(16)
    _keyring_set(SALT_ACCOUNT, base64.b64encode(salt).decode('utf-8'))

    return salt


def clear_device_keys() -> None:
    """Clear all stored keys (for reset/uninstall)."""
    try:
        keyring.delete_password(SERVICE_NAME, DEVICE_KEY_ACCOUNT)
    except keyring.errors.PasswordDeleteError:
        pass
    try:
        keyring.delete_password(SERVICE_NAME, SALT_ACCOUNT)
    except keyring.errors.PasswordDeleteError:
        pass


# ═══════════════════════════════════════════════════════════════════════════════
# KEY DERIVATION
# ═══════════════════════════════════════════════════════════════════════════════

def derive_key(
    device_key: bytes,
    user_password: Optional[str] = None,
    salt: Optional[bytes] = None
) -> bytes:
    """
    Derive encryption key from device key + optional user password.
    
    Uses PBKDF2-HMAC-SHA256 with 100k iterations.
    """
    if salt is None:
        salt = get_salt()
    
    # Combine device key with user password if provided
    if user_password:
        key_material = device_key + user_password.encode('utf-8')
    else:
        key_material = device_key
    
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=KEY_SIZE,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
        backend=default_backend()
    )
    
    return kdf.derive(key_material)


def derive_sync_key(sync_password: str, user_salt: bytes) -> bytes:
    """
    Derive key for cloud sync encryption from user's sync password.
    
    This key is never stored - user must remember their sync password.
    """
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=KEY_SIZE,
        salt=user_salt,
        iterations=PBKDF2_ITERATIONS,
        backend=default_backend()
    )
    
    return kdf.derive(sync_password.encode('utf-8'))


# ═══════════════════════════════════════════════════════════════════════════════
# ENCRYPTION / DECRYPTION
# ═══════════════════════════════════════════════════════════════════════════════

def encrypt(plaintext: bytes, key: bytes) -> EncryptedData:
    """
    Encrypt data using AES-256-GCM.
    
    Returns EncryptedData containing nonce and ciphertext.
    """
    nonce = secrets.token_bytes(NONCE_SIZE)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)
    
    return EncryptedData(nonce=nonce, ciphertext=ciphertext)


def decrypt(encrypted: EncryptedData, key: bytes) -> bytes:
    """
    Decrypt data using AES-256-GCM.
    
    Raises InvalidTag if decryption fails (wrong key or tampered data).
    """
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(encrypted.nonce, encrypted.ciphertext, None)


def encrypt_string(plaintext: str, key: bytes) -> str:
    """Encrypt string to base64-encoded result."""
    encrypted = encrypt(plaintext.encode('utf-8'), key)
    return encrypted.to_base64()


def decrypt_string(ciphertext: str, key: bytes) -> str:
    """Decrypt base64-encoded ciphertext to string."""
    encrypted = EncryptedData.from_base64(ciphertext)
    return decrypt(encrypted, key).decode('utf-8')


# ═══════════════════════════════════════════════════════════════════════════════
# PASSWORD HASHING (for memory lock feature)
# ═══════════════════════════════════════════════════════════════════════════════

def hash_password(password: str) -> str:
    """
    Hash password for storage using PBKDF2.
    
    Returns: "pbkdf2:iterations:salt_b64:hash_b64"
    """
    salt = secrets.token_bytes(16)
    
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
        backend=default_backend()
    )
    
    hash_bytes = kdf.derive(password.encode('utf-8'))
    
    salt_b64 = base64.b64encode(salt).decode('utf-8')
    hash_b64 = base64.b64encode(hash_bytes).decode('utf-8')
    
    return f"pbkdf2:{PBKDF2_ITERATIONS}:{salt_b64}:{hash_b64}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify password against stored hash."""
    try:
        parts = stored_hash.split(':')
        if len(parts) != 4 or parts[0] != 'pbkdf2':
            return False
        
        iterations = int(parts[1])
        salt = base64.b64decode(parts[2])
        expected_hash = base64.b64decode(parts[3])
        
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=iterations,
            backend=default_backend()
        )
        
        actual_hash = kdf.derive(password.encode('utf-8'))
        
        return secrets.compare_digest(actual_hash, expected_hash)
    except Exception:
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# CRYPTO MANAGER (convenience class)
# ═══════════════════════════════════════════════════════════════════════════════

class CryptoManager:
    """
    High-level encryption manager for Stuard memory system.

    Handles key management, encryption/decryption, and password verification.
    """

    def __init__(self, user_password: Optional[str] = None):
        self.plaintext_mode = _plaintext_mode_enabled()
        if self.plaintext_mode:
            # Skip key derivation entirely — no OS keyring access, no new
            # device key minted, no PBKDF2 work. This is the VM path.
            self._device_key = b""
            self._user_password = None
            self._encryption_key = b""
        else:
            self._device_key = get_device_key()
            self._user_password = user_password
            self._encryption_key = derive_key(self._device_key, user_password)

    @property
    def encryption_key(self) -> bytes:
        """Get the derived encryption key."""
        return self._encryption_key

    def encrypt(self, data: bytes) -> EncryptedData:
        """Encrypt data."""
        if self.plaintext_mode:
            raise RuntimeError("encrypt() not available in plaintext mode")
        return encrypt(data, self._encryption_key)

    def decrypt(self, encrypted: EncryptedData) -> bytes:
        """Decrypt data."""
        if self.plaintext_mode:
            raise RuntimeError("decrypt() not available in plaintext mode")
        return decrypt(encrypted, self._encryption_key)

    def encrypt_string(self, plaintext: str) -> str:
        """Encrypt string to base64, or tag as plaintext in plaintext mode."""
        if self.plaintext_mode:
            return PLAINTEXT_PREFIX + plaintext
        return encrypt_string(plaintext, self._encryption_key)

    def decrypt_string(self, ciphertext: str) -> str:
        """Decrypt base64 string, or strip plaintext prefix.

        In plaintext mode legacy AES-GCM rows become unreadable — we return
        an empty string instead of raising so the caller keeps walking the
        result set. Those rows will be overwritten when the desktop resyncs
        with a plaintext export.
        """
        if isinstance(ciphertext, str) and ciphertext.startswith(PLAINTEXT_PREFIX):
            return ciphertext[len(PLAINTEXT_PREFIX):]
        if self.plaintext_mode:
            return ""
        return decrypt_string(ciphertext, self._encryption_key)
    
    def update_password(self, new_password: Optional[str]) -> None:
        """Update user password and re-derive key."""
        self._user_password = new_password
        self._encryption_key = derive_key(self._device_key, new_password)
    
    @staticmethod
    def create_sync_key(sync_password: str) -> Tuple[bytes, bytes]:
        """
        Create a sync key from password.
        
        Returns: (key, salt) - salt must be stored to recreate key later.
        """
        salt = secrets.token_bytes(16)
        key = derive_sync_key(sync_password, salt)
        return key, salt
    
    @staticmethod
    def restore_sync_key(sync_password: str, salt: bytes) -> bytes:
        """Restore sync key from password and stored salt."""
        return derive_sync_key(sync_password, salt)


# ═══════════════════════════════════════════════════════════════════════════════
# MODULE INITIALIZATION
# ═══════════════════════════════════════════════════════════════════════════════

# Singleton instance
_crypto_manager: Optional[CryptoManager] = None


def get_crypto_manager(user_password: Optional[str] = None) -> CryptoManager:
    """Get or create the crypto manager singleton."""
    global _crypto_manager
    
    if _crypto_manager is None:
        _crypto_manager = CryptoManager(user_password)
    elif user_password is not None:
        _crypto_manager.update_password(user_password)
    
    return _crypto_manager


def init_crypto(user_password: Optional[str] = None) -> CryptoManager:
    """Initialize the crypto system."""
    global _crypto_manager
    _crypto_manager = CryptoManager(user_password)
    print(f"[crypto] Initialized with {_get_keyring_backend_name()} backend")
    return _crypto_manager
