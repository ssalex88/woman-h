import hashlib
import time
from fastapi import Depends, HTTPException, Request
from pwdlib import PasswordHash
from sqlalchemy.orm import Session as DBSession
from .db import get_db
from .models import Membership, Session, User

passwords = PasswordHash.recommended()
DUMMY_HASH = passwords.hash("cuenta-inexistente-no-utilizable")
COOKIE = "vera_session"


def token_hash(token: str):
    return hashlib.sha256(token.encode()).hexdigest()


def current_user(request: Request, db: DBSession = Depends(get_db)):
    token = request.cookies.get(COOKIE)
    session = db.get(Session, token_hash(token)) if token else None
    user = db.get(User, session.user_id) if session and session.expires_at > time.time() else None
    if user is None or not user.active:
        raise HTTPException(401, "Inicia sesión para continuar")
    return user


def require_membership(db, user_id, institution_id):
    membership = db.get(Membership, (user_id, institution_id))
    if membership is None:
        raise HTTPException(403, "No tienes acceso a esta institución")
    return membership


def require_owner(user_id, owner_id):
    if user_id != owner_id:
        raise HTTPException(403, "Este espacio privado pertenece a otra persona")
