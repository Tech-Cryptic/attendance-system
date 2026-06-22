import os
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv

load_dotenv()

JWT_SECRET    = os.getenv("JWT_SECRET")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRY    = int(os.getenv("JWT_EXPIRY_MINUTES", 60))

bearer_scheme = HTTPBearer()


def create_token(payload: dict, expires_in_minutes: int = JWT_EXPIRY) -> str:
    """Mint a signed JWT containing the given payload."""
    data = payload.copy()
    data["exp"] = datetime.now(timezone.utc) + timedelta(minutes=expires_in_minutes)
    return jwt.encode(data, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Verify and decode a JWT. Raises HTTPException on failure."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
) -> dict:
    """FastAPI dependency — extracts and validates the JWT from the Authorization header."""
    return decode_token(credentials.credentials)


def require_roles(*roles: str):
    """FastAPI dependency factory — raises 403 if the user's role is not in `roles`."""
    def _check(user: dict = Depends(get_current_user)):
        if user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role(s): {', '.join(roles)}"
            )
        return user
    return _check
