from copy import deepcopy
from datetime import date, datetime, timezone
from hashlib import sha256
import json
import re
import subprocess
import sys
from typing import Literal
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from .accounts import AccountInput, owned_account
from .db import get_db
from .files import owned_file
from .models import Account, PrivateRecord, RecordFile, Timeline, User
from .records import owned_record
from .security import current_user
from .storage import get_storage, PrivateStorage
from .timeline_ai import get_timeline_adapter, TimelineAdapter

router = APIRouter(prefix="/api/records/{record_id}/timeline", tags=["Cronología privada"])


class Revision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)


class Review(AccountInput):
    revision: int = Field(ge=0)
    status: Literal["accepted", "discarded", "proposed"]


def state(row, mode):
    return {"revision": row.revision if row else 0,
            "confirmed": bool(row and row.confirmed_revision == row.revision),
            "mode": row.mode if row else mode,
            "configured_mode": mode,
            "events": row.events if row else [], "warnings": row.warnings if row else [],
            "processed_at": row.processed_at.isoformat() if row else None}


def lock(db, rid, user, revision):
    owned_record(db, rid, user)
    db.execute(select(PrivateRecord).where(PrivateRecord.id == str(rid)).with_for_update()).scalar_one()
    row = db.get(Timeline, str(rid))
    if (row.revision if row else 0) != revision:
        raise HTTPException(409, "La cronología cambió en otra ventana. Recarga antes de continuar")
    return row


def literal_date(text):
    # No resolver fechas relativas ni completar año/día. Solo fechas explícitas inequívocas.
    candidates = re.findall(r"\b(?:\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4})\b", text)
    if len(candidates) == 1 and not re.search(r"aproxim|quizá|tal vez|no recuerdo|creo", text, re.I):
        value = candidates[0]
        try:
            exact = date.fromisoformat(value if '-' in value else '-'.join(reversed(value.split('/'))))
            return {"date_kind": "exact", "event_date": exact.isoformat(), "approximate_date": None}
        except ValueError:
            pass
    approx = re.search(r"\b(?:a (?:principios|mediados|finales) de|aproximadamente en|alrededor de)\s+[^.;\n]{1,100}", text, re.I)
    return {"date_kind": "approximate" if approx else "unknown", "event_date": None,
            "approximate_date": approx.group(0) if approx else None}


def collect(db, rid, store):
    sources, warnings = [], []
    def add(kind, identifier, label, text, version, page=None, explicit=None):
        for part in re.split(r"(?<=[.!?])\s+|[\r\n]+", text):
            quote = part.strip()
            if not quote:
                continue
            if len(quote) > 2000:
                warnings.append(f"{label}: un fragmento supera 2000 caracteres; consúltalo en la fuente.")
                continue
            key = sha256(f"{kind}:{identifier}:{page}:{quote}".encode()).hexdigest()
            sources.append({"id": key, "kind": kind, "source_id": identifier, "label": label,
                            "quote": quote, "page": page, "version": version,
                            "date": explicit or literal_date(quote)})
    accounts = db.scalars(select(Account).where(Account.record_id == str(rid)).order_by(Account.created_at, Account.id)).all()
    for index, account in enumerate(accounts[:30]):
        explicit = {"date_kind": account.date_kind, "event_date": account.event_date.isoformat() if account.event_date else None,
                    "approximate_date": account.approximate_date} if account.date_kind != 'unknown' else None
        add("account", account.id, f"Relato {index + 1}", account.description,
            account.updated_at.isoformat(), explicit=explicit)
    if len(accounts) > 30:
        warnings.append("Se analizaron los primeros 30 relatos.")
    if not accounts:
        record = db.get(PrivateRecord, str(rid))
        add("record", record.id, "Descripción inicial", record.description, record.updated_at.isoformat())
    files = db.scalars(select(RecordFile).where(RecordFile.record_id == str(rid)).order_by(RecordFile.created_at, RecordFile.id)).all()
    for index, file in enumerate(files):
        if index >= 5:
            warnings.append(f"{file.filename}: no analizado; límite de cinco archivos por procesamiento.")
            continue
        if file.media_type != 'application/pdf':
            warnings.append(f"{file.filename}: no analizado; no hay OCR de imágenes configurado.")
            continue
        try:
            result = subprocess.run([sys.executable, '-m', 'app.pdf_text'], input=store.read(file.original_key),
                                    capture_output=True, timeout=5, check=True)
            extracted = json.loads(result.stdout)
            if not extracted['pages']:
                warnings.append(f"{file.filename}: no se encontró texto legible. Puedes continuar sin analizarlo.")
            for page in extracted['pages']:
                add("file", file.id, file.filename, page['text'], file.sha256, page['page'])
            if extracted['limited']:
                warnings.append(f"{file.filename}: extracción parcial (máximo 10 páginas y 20 000 caracteres).")
        except Exception:
            warnings.append(f"{file.filename}: no pudo analizarse. El original sigue disponible en Archivos.")
    if len(sources) > 150:
        warnings.append("Se consideraron los primeros 150 fragmentos. Revisa también tus fuentes.")
    return sources[:150], warnings


@router.get("")
def read(record_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db),
         adapter: TimelineAdapter = Depends(get_timeline_adapter)):
    owned_record(db, record_id, user)
    return state(db.get(Timeline, str(record_id)), adapter.mode)


@router.post("/analyze")
def analyze(record_id: UUID, data: Revision, user: User = Depends(current_user), db: Session = Depends(get_db),
            store: PrivateStorage = Depends(get_storage), adapter: TimelineAdapter = Depends(get_timeline_adapter)):
    row = lock(db, record_id, user, data.revision)
    sources, warnings = collect(db, record_id, store)
    try:
        selected = adapter.propose([{"id": s['id'], "text": s['quote']} for s in sources])
        allowed = {s['id']: s for s in sources}
        if not isinstance(selected, list) or len(selected) > 8 or any(type(key) is not str or key not in allowed for key in selected):
            raise ValueError("Fuentes inválidas")
    except Exception:
        raise HTTPException(503, "No pudimos organizar la cronología. Tus relatos y revisiones siguen guardados. Intenta nuevamente")
    preserved = [deepcopy(event) for event in row.events if event['reviewed']] if row else []
    known = {event['source']['id'] for event in preserved}
    for key in dict.fromkeys(selected):
        if key in known:
            continue
        source = allowed[key]
        original = {"description": source['quote'], **source['date']}
        preserved.append({"id": str(uuid4()), "source": source, "original": original,
                          **original, "status": "proposed", "reviewed": False, "edited": False,
                          "mode": adapter.mode})
    if len(sources) > len(selected):
        warnings.append("La propuesta es una selección de fragmentos, no una reconstrucción completa. Revisa las fuentes.")
    now = datetime.now(timezone.utc)
    if row is None:
        row = Timeline(record_id=str(record_id), revision=0, mode=adapter.mode, events=[], warnings=[], processed_at=now)
        db.add(row)
    row.events, row.warnings, row.mode, row.processed_at = preserved, warnings, adapter.mode, now
    row.revision += 1
    row.confirmed_revision = None
    db.commit()
    return state(row, adapter.mode)


@router.put("/events/{event_id}")
def review(record_id: UUID, event_id: UUID, data: Review, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = lock(db, record_id, user, data.revision)
    events = deepcopy(row.events) if row else []
    event = next((item for item in events if item['id'] == str(event_id)), None)
    if event is None:
        raise HTTPException(404, "Evento no encontrado")
    content = data.model_dump(mode='json', include={'description', 'date_kind', 'event_date', 'approximate_date'})
    event.update(content)
    event.update(status=data.status, reviewed=True, edited=content != event['original'])
    row.events = events
    row.revision += 1
    row.confirmed_revision = None
    db.commit()
    return state(row, row.mode)


@router.post("/confirm")
def confirm(record_id: UUID, data: Revision, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = lock(db, record_id, user, data.revision)
    if row is None or not any(e['status'] == 'accepted' for e in row.events):
        raise HTTPException(422, "Acepta al menos un evento para confirmar la cronología")
    if any(e['status'] == 'proposed' for e in row.events):
        raise HTTPException(422, "Revisa, acepta o descarta todas las propuestas antes de confirmar")
    row.confirmed_revision = row.revision
    db.commit()
    return state(row, row.mode)


@router.get("/events/{event_id}/source")
def source(record_id: UUID, event_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_record(db, record_id, user)
    row = db.get(Timeline, str(record_id))
    event = next((e for e in row.events if e['id'] == str(event_id)), None) if row else None
    if not event:
        raise HTTPException(404, "Evento no encontrado")
    ref = event['source']
    if ref['kind'] == 'file':
        current = owned_file(db, record_id, ref['source_id'], user)
        text, version = None, current.sha256
    elif ref['kind'] == 'account':
        current = owned_account(db, record_id, ref['source_id'], user)
        text, version = current.description, current.updated_at.isoformat()
    else:
        current = owned_record(db, record_id, user)
        text, version = current.description, current.updated_at.isoformat()
    return {**ref, "current_text": text, "changed": version != ref['version']}
