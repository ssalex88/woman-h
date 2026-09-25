from datetime import datetime, timezone
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_serializer
from sqlalchemy import select
from sqlalchemy.orm import Session
from .db import get_db
from .models import PrivateRecord, User
from .security import current_user

router = APIRouter(prefix="/api/records", tags=["Registros privados"])


class RecordInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=10000)


class RecordOutput(RecordInput):
    model_config = ConfigDict(from_attributes=True)
    id: str
    status: str
    created_at: datetime
    updated_at: datetime

    @field_serializer("created_at", "updated_at")
    def utc_timestamp(self, value: datetime):
        # SQLite omite zona en pruebas; PostgreSQL puede devolver la zona de su sesión.
        return value.replace(tzinfo=value.tzinfo or timezone.utc).astimezone(timezone.utc).isoformat()


def owned_record(db: Session, record_id: UUID, user: User):
    record = db.scalar(select(PrivateRecord).where(
        PrivateRecord.id == str(record_id), PrivateRecord.owner_id == user.id))
    if record is None:
        # La misma respuesta para IDs inexistentes y ajenos evita revelar su existencia.
        raise HTTPException(404, "Registro no encontrado")
    return record


@router.post("", response_model=RecordOutput, status_code=201)
def create_record(data: RecordInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    record = add_record(db, user, data)
    db.commit()
    return record


def add_record(db: Session, user: User, data: RecordInput):
    """Construcción compartida; el llamador controla la transacción."""
    now = datetime.now(timezone.utc)
    record = PrivateRecord(id=str(uuid4()), owner_id=user.id, title=data.title,
                           description=data.description, status="private_draft",
                           created_at=now, updated_at=now)
    db.add(record)
    db.flush()
    return record


def edit_record(record: PrivateRecord, data: RecordInput):
    record.title = data.title
    record.description = data.description
    record.updated_at = datetime.now(timezone.utc)


@router.get("", response_model=list[RecordOutput])
def list_records(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(PrivateRecord).where(PrivateRecord.owner_id == user.id)
                      .order_by(PrivateRecord.created_at.desc(), PrivateRecord.id)).all()


@router.get("/{record_id}", response_model=RecordOutput)
def get_record(record_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return owned_record(db, record_id, user)


@router.put("/{record_id}", response_model=RecordOutput)
def update_record(record_id: UUID, data: RecordInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    record = owned_record(db, record_id, user)
    edit_record(record, data)
    db.commit()
    return record
