"""SMTP sifreleri icin Fernet (AES128-CBC+HMAC) sifreleme yardimcilari.

Anahtar /etc/nextep/.smtp_secret dosyasinda tutulur (chmod 600).
DB sizsa bile sifreler anahtar olmadan cozulemez.
"""

import os

SECRET_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".smtp_secret")
SECRET_PATH = os.path.normpath(SECRET_PATH)

_ENC_PREFIX = "enc:"


def _load_or_create_key():
    try:
        with open(SECRET_PATH, "rb") as f:
            key = f.read().strip()
        if key:
            return key
    except FileNotFoundError:
        pass
    from cryptography.fernet import Fernet

    key = Fernet.generate_key()
    fd = os.open(SECRET_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key)
    try:
        os.chmod(SECRET_PATH, 0o600)
    except OSError:
        pass
    return key


def encrypt_secret(plain):
    """Duz metni 'enc:<fernet-token>' biciminde sifreler. Bos girdi -> bos."""
    plain = plain or ""
    if not plain:
        return ""
    if plain.startswith(_ENC_PREFIX):
        return plain
    from cryptography.fernet import Fernet

    f = Fernet(_load_or_create_key())
    token = f.encrypt(plain.encode("utf-8")).decode("ascii")
    return _ENC_PREFIX + token


def decrypt_secret(stored):
    """'enc:' on ekli degeri cozer; onsuz duz metni geriye uyumlu dondurur."""
    stored = stored or ""
    if not stored.startswith(_ENC_PREFIX):
        return stored
    try:
        from cryptography.fernet import Fernet

        f = Fernet(_load_or_create_key())
        return f.decrypt(stored[len(_ENC_PREFIX):].encode("ascii")).decode("utf-8")
    except Exception:
        return ""
