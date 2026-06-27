"""
Tests for the crypto module - encryption/decryption and key management.
"""

import pytest
import keyring


@pytest.fixture(autouse=True)
def _mock_keyring(monkeypatch: pytest.MonkeyPatch):
    """Mock keyring to avoid actual OS keychain operations during tests."""
    store = {}

    def get_password(service: str, account: str):
        return store.get((service, account))

    def set_password(service: str, account: str, password: str):
        store[(service, account)] = password

    def delete_password(service: str, account: str):
        store.pop((service, account), None)

    monkeypatch.setattr(keyring, "get_password", get_password)
    monkeypatch.setattr(keyring, "set_password", set_password)
    monkeypatch.setattr(keyring, "delete_password", delete_password)
    monkeypatch.setattr(keyring, "get_keyring", lambda: object())

    # Reset the crypto manager singleton
    from app.storage import crypto as crypto_mod
    crypto_mod._crypto_manager = None


class TestEncryptedData:
    """Tests for the EncryptedData dataclass."""

    def test_to_bytes_and_from_bytes_roundtrip(self):
        from app.storage.crypto import EncryptedData, NONCE_SIZE
        import secrets

        nonce = secrets.token_bytes(NONCE_SIZE)
        ciphertext = b"encrypted_content_here"

        original = EncryptedData(nonce=nonce, ciphertext=ciphertext)
        serialized = original.to_bytes()
        restored = EncryptedData.from_bytes(serialized)

        assert restored.nonce == nonce
        assert restored.ciphertext == ciphertext

    def test_to_base64_and_from_base64_roundtrip(self):
        from app.storage.crypto import EncryptedData, NONCE_SIZE
        import secrets

        nonce = secrets.token_bytes(NONCE_SIZE)
        ciphertext = b"test_data"

        original = EncryptedData(nonce=nonce, ciphertext=ciphertext)
        b64 = original.to_base64()
        restored = EncryptedData.from_base64(b64)

        assert restored.nonce == nonce
        assert restored.ciphertext == ciphertext

    def test_from_bytes_raises_on_short_data(self):
        from app.storage.crypto import EncryptedData

        with pytest.raises(ValueError, match="too short"):
            EncryptedData.from_bytes(b"short")


class TestDeviceKey:
    """Tests for device key management."""

    def test_get_device_key_creates_new_key(self):
        from app.storage.crypto import get_device_key, KEY_SIZE

        key = get_device_key()

        assert isinstance(key, bytes)
        assert len(key) == KEY_SIZE

    def test_get_device_key_returns_same_key(self):
        from app.storage.crypto import get_device_key

        key1 = get_device_key()
        key2 = get_device_key()

        assert key1 == key2

    def test_get_salt_creates_new_salt(self):
        from app.storage.crypto import get_salt

        salt = get_salt()

        assert isinstance(salt, bytes)
        assert len(salt) == 16  # Salt is 16 bytes

    def test_get_salt_returns_same_salt(self):
        from app.storage.crypto import get_salt

        salt1 = get_salt()
        salt2 = get_salt()

        assert salt1 == salt2


class TestCryptoManager:
    """Tests for the CryptoManager class."""

    def test_get_crypto_manager_singleton(self):
        from app.storage.crypto import get_crypto_manager

        manager1 = get_crypto_manager()
        manager2 = get_crypto_manager()

        assert manager1 is manager2

    def test_get_crypto_manager_with_password(self):
        from app.storage.crypto import get_crypto_manager
        import app.storage.crypto as crypto_mod
        crypto_mod._crypto_manager = None

        manager = get_crypto_manager(user_password="test_password")

        assert manager is not None

    def test_encrypt_decrypt_roundtrip(self):
        from app.storage.crypto import get_crypto_manager

        manager = get_crypto_manager()
        original = b"secret data to encrypt"

        encrypted = manager.encrypt(original)
        decrypted = manager.decrypt(encrypted)

        assert decrypted == original

    def test_encrypt_returns_encrypted_data(self):
        from app.storage.crypto import get_crypto_manager, EncryptedData

        manager = get_crypto_manager()

        encrypted = manager.encrypt(b"test")

        assert isinstance(encrypted, EncryptedData)
        assert len(encrypted.nonce) == 12  # NONCE_SIZE
        assert len(encrypted.ciphertext) > 0

    def test_encrypt_produces_different_output_each_time(self):
        from app.storage.crypto import get_crypto_manager

        manager = get_crypto_manager()
        data = b"same input"

        encrypted1 = manager.encrypt(data)
        encrypted2 = manager.encrypt(data)

        # Different nonces mean different ciphertext
        assert encrypted1.nonce != encrypted2.nonce
        assert encrypted1.ciphertext != encrypted2.ciphertext

    def test_encrypt_string_and_decrypt_string(self):
        from app.storage.crypto import get_crypto_manager

        manager = get_crypto_manager()
        original = "Hello, World! Unicode: 你好世界"

        encrypted = manager.encrypt_string(original)
        decrypted = manager.decrypt_string(encrypted)

        assert decrypted == original

    def test_decrypt_with_different_password_fails(self):
        from app.storage.crypto import CryptoManager
        import app.storage.crypto as crypto_mod

        # Reset singleton
        crypto_mod._crypto_manager = None

        # Create manager with password1 and encrypt
        manager1 = CryptoManager(user_password="password1")
        encrypted = manager1.encrypt(b"secret")

        # Reset and create with different password
        crypto_mod._crypto_manager = None
        manager2 = CryptoManager(user_password="password2")

        # Decryption should fail
        with pytest.raises(Exception):
            manager2.decrypt(encrypted)


class TestKeyDerivation:
    """Tests for key derivation functions."""

    def test_derive_key_with_password(self):
        from app.storage.crypto import derive_key, KEY_SIZE, get_salt

        salt = get_salt()
        key = derive_key(b"device_key" * 4, "password123", salt)

        assert isinstance(key, bytes)
        assert len(key) == KEY_SIZE

    def test_derive_key_without_password(self):
        from app.storage.crypto import derive_key, KEY_SIZE, get_salt

        salt = get_salt()
        key = derive_key(b"device_key" * 4, salt=salt)

        assert isinstance(key, bytes)
        assert len(key) == KEY_SIZE

    def test_derive_key_produces_different_output_for_different_passwords(self):
        from app.storage.crypto import derive_key, get_salt

        salt = get_salt()
        device = b"device_key" * 4

        key1 = derive_key(device, "password1", salt)
        key2 = derive_key(device, "password2", salt)

        assert key1 != key2

    def test_derive_key_produces_same_output_for_same_inputs(self):
        from app.storage.crypto import derive_key, get_salt

        salt = get_salt()
        device = b"device_key" * 4

        key1 = derive_key(device, "password", salt)
        key2 = derive_key(device, "password", salt)

        assert key1 == key2


class TestPasswordHashing:
    """Tests for password hashing utilities."""

    def test_hash_and_verify_password(self):
        from app.storage.crypto import hash_password, verify_password

        password = "my_secure_password123"
        hashed = hash_password(password)

        assert verify_password(password, hashed) is True
        assert verify_password("wrong_password", hashed) is False

    def test_hash_format(self):
        from app.storage.crypto import hash_password

        hashed = hash_password("test")

        assert hashed.startswith("pbkdf2:")
        parts = hashed.split(":")
        assert len(parts) == 4

    def test_different_passwords_produce_different_hashes(self):
        from app.storage.crypto import hash_password

        hash1 = hash_password("password1")
        hash2 = hash_password("password2")

        assert hash1 != hash2
