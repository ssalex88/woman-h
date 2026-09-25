from datetime import date, datetime, timezone
from typing import Literal
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from .db import get_db
from .models import Account, User
from .records import owned_record
from .security import current_user

router = APIRouter(prefix="/api/records/{record_id}/accounts", tags=["Relatos privados"])


class AccountInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    description: str = Field(min_length=1, max_length=10000)
    date_kind: Literal["exact", "approximate", "unknown"]
    event_date: date | None = None
    approximate_date: str | None = Field(default=None, max_length=200)
    place: str | None = Field(default=None, max_length=500)
    mentioned_people: str | None = Field(default=None, max_length=2000)

    @field_validator("approximate_date", "place", "mentioned_people", mode="before")
    @classmethod
    def empty_to_null(cls, value):
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("event_date", mode="before")
    @classmethod
    def calendar_date_only(cls, value):
        if value is not None and not (type(value) is date or
                isinstance(value, str) and len(value) == 10 and value[4] == '-' and value[7] == '-'):
            raise ValueError("Usa una fecha de calendario AAAA-MM-DD")
        return value

    @model_validator(mode="after")
    def consistent_date(self):
        valid = {
            "exact": self.event_date is not None and self.approximate_date is None,
            "approximate": self.event_date is None and self.approximate_date is not None,
            "unknown": self.event_date is None and self.approximate_date is None,
        }
        if not valid[self.date_kind]:
            raise ValueError("La fecha debe corresponder al tipo seleccionado")
        return self


class AccountOutput(AccountInput):
    model_config = ConfigDict(from_attributes=True)
    id: str
    record_id: str
    created_at: datetime
    updated_at: datetime

    @field_serializer("created_at", "updated_at")
    def utc_timestamp(self, value: datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc).astimezone(timezone.utc).isoformat()


def owned_account(db, record_id, account_id, user):
    owned_record(db, record_id, user)
    account = db.scalar(select(Account).where(Account.id == str(account_id), Account.record_id == str(record_id)))
    if account is None:
        raise HTTPException(404, "Relato no encontrado")
    return account


@router.post("", response_model=AccountOutput, status_code=201)
def create_account(record_id: UUID, data: AccountInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_record(db, record_id, user)
    account = add_account(db, record_id, data)
    db.commit()
    return account


def add_account(db: Session, record_id: UUID, data: AccountInput):
    now = datetime.now(timezone.utc)
    account = Account(id=str(uuid4()), record_id=str(record_id), **data.model_dump(), created_at=now, updated_at=now)
    db.add(account)
    db.flush()
    return account


def edit_account(account: Account, data: AccountInput):
    for key, value in data.model_dump().items():
        setattr(account, key, value)
    account.updated_at = datetime.now(timezone.utc)


@router.get("", response_model=list[AccountOutput])
def list_accounts(record_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_record(db, record_id, user)
    return db.scalars(select(Account).where(Account.record_id == str(record_id)).order_by(Account.created_at, Account.id)).all()


@router.get("/{account_id}", response_model=AccountOutput)
def get_account(record_id: UUID, account_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return owned_account(db, record_id, account_id, user)


@router.put("/{account_id}", response_model=AccountOutput)
def update_account(record_id: UUID, account_id: UUID, data: AccountInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    account = owned_account(db, record_id, account_id, user)
    edit_account(account, data)
    db.commit()
    return account
