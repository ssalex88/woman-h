"""Carga explícita e idempotente; nunca cambia contraseñas de cuentas existentes."""
from uuid import NAMESPACE_URL, uuid5
from sqlalchemy import select
from .config import settings
from .db import SessionLocal
from .models import Institution, Membership, User
from .security import passwords

DEMO_USERS = [
    ("ana@example.test", "Ana Demo", None, None),
    ("bea@example.test", "Bea Demo", None, None),
    ("revisora@example.test", "Lucía Demo", "reviewer", "Institución Aurora · ficticia"),
    ("admin@example.test", "María Demo", "admin", "Institución Aurora · ficticia"),
    ("otra@example.test", "Elena Demo", "reviewer", "Institución Brisa · ficticia"),
]


def demo_id(value):
    return str(uuid5(NAMESPACE_URL, "vera-demo:" + value))


def seed():
    config = settings()
    if config.app_env == "production" or not config.demo_enabled:
        raise RuntimeError("La carga ficticia requiere DEMO_ENABLED=true en desarrollo o pruebas")
    if not config.demo_password or len(config.demo_password) < 16:
        raise RuntimeError("Configura DEMO_PASSWORD con al menos 16 caracteres")
    with SessionLocal.begin() as db:
        for email, name, role, institution_name in DEMO_USERS:
            user = db.scalar(select(User).where(User.email == email))
            if user is not None:
                if user.id != demo_id(email):
                    raise RuntimeError("El correo ficticio ya pertenece a otra cuenta")
                continue
            user = User(id=demo_id(email), email=email, name=name,
                        password_hash=passwords.hash(config.demo_password), active=True)
            db.add(user)
            db.flush()
            if role:
                institution_id = demo_id(institution_name)
                if db.get(Institution, institution_id) is None:
                    db.add(Institution(id=institution_id, name=institution_name))
                    db.flush()
                db.add(Membership(user_id=user.id, institution_id=institution_id, role=role))
    print("Usuarios ficticios preparados. No se modificaron cuentas existentes.")


if __name__ == "__main__":
    seed()
