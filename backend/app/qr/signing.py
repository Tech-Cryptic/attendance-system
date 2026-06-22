import hmac
import hashlib
import os
import json
from dotenv import load_dotenv

load_dotenv()

HMAC_KEY = os.getenv("HMAC_KEY").encode()


def sign_qr_payload(matric_number: str, course_code: str) -> dict:
    """Create a signed, tamper-evident QR payload for a student/course pair."""
    payload = {"matric_number": matric_number, "course_code": course_code}
    payload_str = json.dumps(payload, sort_keys=True)
    signature = hmac.new(HMAC_KEY, payload_str.encode(), hashlib.sha256).hexdigest()
    return {"payload": payload_str, "signature": signature}


def verify_qr_payload(payload_str: str, signature: str) -> bool:
    """Verify a QR payload\'s signature without trusting client input."""
    expected = hmac.new(HMAC_KEY, payload_str.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def sign_session_payload(session_id: str, course_code: str, expires_at: str) -> dict:
    """Create a signed QR payload for an attendance session."""
    payload = {"session_id": session_id, "course_code": course_code, "expires_at": expires_at}
    payload_str = json.dumps(payload, sort_keys=True)
    signature = hmac.new(HMAC_KEY, payload_str.encode(), hashlib.sha256).hexdigest()
    return {"payload": payload_str, "signature": signature}


def verify_session_payload(payload_str: str, signature: str) -> dict | None:
    """Verify a session QR payload. Returns parsed dict if valid, None if tampered."""
    expected = hmac.new(HMAC_KEY, payload_str.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return None
    return json.loads(payload_str)