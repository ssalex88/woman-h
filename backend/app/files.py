from datetime import datetime, timezone
import hashlib
import json
import logging
from uuid import UUID, uuid4
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException
from .config import settings
from .db import get_db
from .file_validation import inspect_file, safe_filename
from .models import Account, FileAccount, RecordFile, User
from .records import owned_record
from .security import current_user
from .storage import PrivateStorage, get_storage

router = APIRouter(prefix="/api/records/{record_id}/files", tags=["Archivos privados"])
logger = logging.getLogger(__name__)


class FileMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    description: str | None = Field(default=None, max_length=2000)
    account_ids: list[UUID] = Field(default_factory=list, max_length=50)

    @field_validator("description", mode="before")
    @classmethod
    def empty_to_null(cls, value):
        return None if isinstance(value, str) and not value.strip() else value


def validate_links(db, record_id, account_ids):
    ids = {str(value) for value in account_ids}
    if ids:
        found = set(db.scalars(select(Account.id).where(Account.record_id == str(record_id), Account.id.in_(ids))))
        if found != ids:
            raise HTTPException(404, "Uno de los relatos no pertenece a este registro")
    return sorted(ids)


def file_data(file):
    return {"id": file.id, "filename": file.filename, "description": file.description,
            "media_type": file.media_type, "size": file.size, "sha256": file.sha256,
            "created_at": file.created_at.replace(tzinfo=file.created_at.tzinfo or timezone.utc).astimezone(timezone.utc).isoformat(),
            "account_ids": sorted(link.account_id for link in file.links), "preview_available": True}


def owned_file(db, record_id, file_id, user):
    owned_record(db, record_id, user)
    file = db.scalar(select(RecordFile).where(RecordFile.id == str(file_id), RecordFile.record_id == str(record_id)))
    if file is None:
        raise HTTPException(404, "Archivo no encontrado")
    return file


@router.get("")
def list_files(record_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    owned_record(db, record_id, user)
    files = db.scalars(select(RecordFile).where(RecordFile.record_id == str(record_id)).order_by(RecordFile.created_at, RecordFile.id)).all()
    return {"items": [file_data(file) for file in files], "max_upload_bytes": settings().max_upload_bytes,
            "accepted_extensions": [".png", ".jpg", ".jpeg", ".webp", ".pdf"]}


async def bounded_form(request: Request):
    # Limitar los bytes reales ANTES del parser multipart; no confiar en Content-Length.
    limit = settings().max_upload_bytes + 65536
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > limit:
            raise HTTPException(413, "La carga supera el tamaño permitido")
        body.extend(chunk)
    async def receive():
        return {"type": "http.request", "body": bytes(body), "more_body": False}
    replay = Request(request.scope, receive)
    try:
        return await replay.form(max_files=1, max_fields=2, max_part_size=16384)
    except StarletteHTTPException:
        raise HTTPException(400, "Formulario de carga inválido: envía un archivo y sus campos permitidos")


def persist_file(db, store, record_id, filename, data, meta):
    ids = validate_links(db, record_id, meta.account_ids)
    mime, preview = inspect_file(data, filename)
    identifier = uuid4()
    original_key, preview_key = f"originals/{identifier.hex}", f"previews/{identifier.hex}"
    written = []
    try:
        store.put(original_key, data)
        written.append(original_key)
        store.put(preview_key, preview)
        written.append(preview_key)
        file = RecordFile(id=str(identifier), record_id=str(record_id), filename=filename,
            description=meta.description, media_type=mime, size=len(data), sha256=hashlib.sha256(data).hexdigest(),
            original_key=original_key, preview_key=preview_key, created_at=datetime.now(timezone.utc),
            links=[FileAccount(account_id=value) for value in ids])
        db.add(file)
        db.commit()
        return file_data(file)
    except Exception:
        db.rollback()
        for key in written:
            try:
                store.delete(key)
            except Exception:
                logger.exception("No se pudo limpiar un objeto tras una carga fallida")
        logger.exception("No se pudo guardar un archivo privado")
        raise HTTPException(503, "No se pudo guardar el archivo. Intenta nuevamente")


@router.post("", status_code=201)
async def upload_file(record_id: UUID, request: Request, user: User = Depends(current_user),
                      db: Session = Depends(get_db), store: PrivateStorage = Depends(get_storage)):
    owned_record(db, record_id, user)
    if not request.headers.get("content-type", "").lower().startswith("multipart/form-data;"):
        raise HTTPException(415, "Envía el archivo como formulario multipart")
    form = await bounded_form(request)
    try:
        if set(form.keys()) - {"file", "description", "account_ids"} or any(len(form.getlist(key)) != 1 for key in form):
            raise HTTPException(422, "Campos de carga inválidos o duplicados")
        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            raise HTTPException(422, "Selecciona un archivo")
        filename = safe_filename(upload.filename or "")
        data = await upload.read(settings().max_upload_bytes + 1)
        if not data:
            raise HTTPException(415, "El archivo está vacío")
        if len(data) > settings().max_upload_bytes:
            raise HTTPException(413, "El archivo supera el tamaño permitido")
        try:
            meta = FileMetadata(description=form.get("description"), account_ids=json.loads(form.get("account_ids", "[]")))
        except (ValidationError, ValueError, TypeError):
            raise HTTPException(422, "Revisa la descripción y los relatos seleccionados")
        return await run_in_threadpool(persist_file, db, store, record_id, filename, data, meta)
    finally:
        await form.close()


@router.get("/{file_id}")
def get_file(record_id: UUID, file_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return file_data(owned_file(db, record_id, file_id, user))


@router.put("/{file_id}")
def update_metadata(record_id: UUID, file_id: UUID, data: FileMetadata, user: User = Depends(current_user), db: Session = Depends(get_db)):
    file = owned_file(db, record_id, file_id, user)
    ids = validate_links(db, record_id, data.account_ids)
    file.description = data.description
    existing = {link.account_id: link for link in file.links}
    file.links = [existing[value] if value in existing else FileAccount(account_id=value) for value in ids]
    db.commit()
    return file_data(file)


@router.delete("/{file_id}", status_code=204)
def remove_file(record_id: UUID, file_id: UUID, user: User = Depends(current_user),
                db: Session = Depends(get_db), store: PrivateStorage = Depends(get_storage)):
    file = owned_file(db, record_id, file_id, user)
    keys = (file.original_key, file.preview_key)
    # Revocar el acceso primero: una limpieza fallida nunca vuelve a publicar el archivo.
    db.delete(file)
    db.commit()
    for key in keys:
        try:
            store.delete(key)
        except Exception:
            logger.exception("Objeto privado pendiente de limpieza: %s", key)
    return Response(status_code=204)


def private_bytes(store, key):
    try:
        return store.read(key)
    except Exception:
        logger.exception("No se pudo recuperar un archivo privado")
        raise HTTPException(503, "El archivo no está disponible. Intenta nuevamente")


@router.get("/{file_id}/content")
def download_file(record_id: UUID, file_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db),
                  store: PrivateStorage = Depends(get_storage)):
    file = owned_file(db, record_id, file_id, user)
    return Response(private_bytes(store, file.original_key), media_type=file.media_type,
        headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(file.filename, safe=""),
                 "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin"})


@router.get("/{file_id}/preview")
def preview_file(record_id: UUID, file_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db),
                 store: PrivateStorage = Depends(get_storage)):
    file = owned_file(db, record_id, file_id, user)
    return Response(private_bytes(store, file.preview_key), media_type="image/png",
                    headers={"Content-Disposition": 'inline; filename="vista-previa.png"', "Cross-Origin-Resource-Policy": "same-origin"})
