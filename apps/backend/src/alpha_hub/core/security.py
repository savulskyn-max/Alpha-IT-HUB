"""
In-memory token revocation list.
Stores a SHA-256 fingerprint of revoked access_tokens with their expiry
timestamp. Entries are cleaned up lazily on access and eagerly at startup.
"""
import hashlib
import time


def _fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class TokenRevocationList:
    """
    Class-level store so there is a single instance per process.
    Keys are token fingerprints; values are the token's `exp` timestamp.
    """

    _store: dict[str, float] = {}

    @classmethod
    def revoke(cls, token: str, exp: float) -> None:
        cls._store[_fingerprint(token)] = exp

    @classmethod
    def is_revoked(cls, token: str) -> bool:
        key = _fingerprint(token)
        exp = cls._store.get(key)
        if exp is None:
            return False
        if time.time() > exp:
            # Token naturally expired — remove stale entry
            del cls._store[key]
            return False
        return True

    @classmethod
    def cleanup_expired(cls) -> int:
        """Remove all entries whose tokens have already expired. Returns count removed."""
        now = time.time()
        stale = [k for k, v in cls._store.items() if now > v]
        for k in stale:
            del cls._store[k]
        return len(stale)
