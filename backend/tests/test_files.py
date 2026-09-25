from io import BytesIO
import hashlib
import json
from uuid import uuid4
import pytest
from PIL import Image
from pypdf import PdfWriter
from sqlalchemy import func, select
from app.config import settings
from app.db import SessionLocal
from app.main import app
from app.models import RecordFile
from app.storage import LocalStorage, get_storage
from conftest import login


def image_bytes(kind='PNG', size=(12, 10)):
    output = BytesIO()
    Image.new('RGB', size, '#336699').save(output, format=kind)
    return output.getvalue()


def pdf_bytes(encrypted=False):
    output = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    if encrypted:
        writer.encrypt('ficticia')
    writer.write(output)
    return output.getvalue()


@pytest.fixture(autouse=True)
def store(tmp_path):
    storage = LocalStorage(settings().model_copy(update={'storage_root': tmp_path}))
    app.dependency_overrides[get_storage] = lambda: storage
    yield storage
    app.dependency_overrides.pop(get_storage, None)


def record(client):
    return client.post('/api/records', json={'title': 'Archivos ficticios', 'description': 'Contexto ficticio'}).json()['id']


def account(client, record_id):
    return client.post(f'/api/records/{record_id}/accounts', json={'description': 'Hecho ficticio', 'date_kind': 'unknown'}).json()['id']


def upload(client, record_id, data=None, filename='captura.png', ids=None, description=''):
    return client.post(f'/api/records/{record_id}/files', files={'file': (filename, image_bytes() if data is None else data, 'application/octet-stream')},
                       data={'description': description, 'account_ids': json.dumps(ids or [])})


@pytest.mark.parametrize('kind,name', [('PNG','captura.png'), ('JPEG','foto.jpg'), ('WEBP','foto.webp'), ('PDF','documento.pdf')])
def test_real_file_persist_preview_download_and_no_public_storage_keys(client, store, kind, name):
    login(client)
    record_id = record(client)
    data = pdf_bytes() if kind == 'PDF' else image_bytes(kind)
    response = upload(client, record_id, data=data, filename=name)
    assert response.status_code == 201, response.text
    file = response.json()
    assert file['description'] is None and file['account_ids'] == []
    assert file['sha256'] == hashlib.sha256(data).hexdigest()
    assert not {'original_key', 'preview_key', 'url'} & file.keys()
    path = f"/api/records/{record_id}/files/{file['id']}"
    original = client.get(path + '/content')
    assert original.content == data
    assert original.headers['content-disposition'].startswith('attachment;')
    assert original.headers['cache-control'] == 'no-store'
    assert original.headers['x-content-type-options'] == 'nosniff'
    preview = client.get(path + '/preview')
    assert preview.status_code == 200 and preview.headers['content-type'] == 'image/png'
    with Image.open(BytesIO(preview.content)) as image:
        assert image.format == 'PNG' and max(image.size) <= 1200
    with SessionLocal() as db:
        stored = db.get(RecordFile, file['id'])
        assert stored.original_key.startswith('originals/') and stored.preview_key.startswith('previews/')
        assert store.read(stored.original_key) == data
        assert client.get('/' + stored.original_key).status_code == 404
    client.post('/api/auth/logout')
    assert client.get(path + '/content').status_code == 401
    assert client.get(path + '/preview').status_code == 401
    login(client)
    assert client.get(f'/api/records/{record_id}/files').json()['items'] == [file]


@pytest.mark.parametrize('email', ['bea@example.test', 'admin@example.test', 'revisora@example.test'])
def test_all_file_endpoints_deny_other_users_and_wrong_parent(client, email):
    login(client)
    record_id = record(client)
    file = upload(client, record_id).json()
    login(client, email)
    other_record = record(client)
    for parent in [record_id, other_record]:
        path = f"/api/records/{parent}/files/{file['id']}"
        for suffix in ['', '/content', '/preview']:
            assert client.get(path + suffix).status_code == 404
        assert client.put(path, json={'description': 'Ataque ficticio'}).status_code == 404
        assert client.delete(path).status_code == 404
    assert client.get(f'/api/records/{record_id}/files').status_code == 404
    assert upload(client, record_id).status_code == 404
    assert client.get(f'/api/records/{other_record}/files').json()['items'] == []


def test_remove_file_deletes_original_preview_links_but_keeps_story(client, store):
    login(client)
    rid = record(client)
    aid = account(client, rid)
    file = upload(client, rid, ids=[aid]).json()
    path = f"/api/records/{rid}/files/{file['id']}"
    with SessionLocal() as db:
        row = db.get(RecordFile, file['id'])
        keys = [row.original_key, row.preview_key]
    client.post('/api/auth/logout')
    assert client.delete(path).status_code == 401
    login(client)
    assert client.delete(path).status_code == 204
    assert client.delete(path).status_code == 404
    for suffix in ['', '/content', '/preview']:
        assert client.get(path + suffix).status_code == 404
    assert client.get(f'/api/records/{rid}/files').json()['items'] == []
    assert client.get(f'/api/records/{rid}/accounts').json()[0]['id'] == aid
    for key in keys:
        assert not store.path(key).exists()


def test_failed_cleanup_never_restores_access(client, store, monkeypatch, caplog):
    login(client)
    rid = record(client)
    file = upload(client, rid).json()
    path = f"/api/records/{rid}/files/{file['id']}"
    def fail(key):
        raise OSError('Fallo ficticio del almacenamiento')
    monkeypatch.setattr(store, 'delete', fail)
    assert client.delete(path).status_code == 204
    assert client.get(path + '/content').status_code == 404
    assert client.get(path + '/preview').status_code == 404
    assert 'pendiente de limpieza' in caplog.text


def test_links_same_record_only_edit_without_mutating_original(client):
    login(client)
    record_id = record(client)
    ids = [account(client, record_id), account(client, record_id)]
    other = account(client, record(client))
    assert upload(client, record_id, ids=[other]).status_code == 404
    result = upload(client, record_id, ids=ids, description='Descripción ficticia').json()
    path = f"/api/records/{record_id}/files/{result['id']}"
    assert result['account_ids'] == sorted(ids)
    assert client.put(path, json={'account_ids': [other]}).status_code == 404
    update = client.put(path, json={'description': 'Editada', 'account_ids': [ids[1]]}).json()
    assert update['account_ids'] == [ids[1]] and update['description'] == 'Editada'
    assert update['created_at'] == result['created_at'] and update['sha256'] == result['sha256']
    assert client.get(path + '/content').content == image_bytes()
    assert client.put(path, json={'account_ids': []}).json()['account_ids'] == []
    for key in ['original_key', 'record_id', 'filename', 'owner_id', 'media_type']:
        assert client.put(path, json={key: str(uuid4())}).status_code == 422


@pytest.mark.parametrize('data,name', [(b'', 'foto.png'), (b'<html>ficticio</html>', 'foto.jpg'),
    (b'\x89PNG\r\n\x1a\nrota', 'rota.png'), (b'%PDF-1.7\nroto\n%%EOF', 'roto.pdf'),
    (image_bytes(), 'disfraz.pdf'), (image_bytes(), 'imagen.svg'), (image_bytes()[:40], 'truncada.png')])
def test_invalid_real_types_leave_no_objects(client, store, data, name):
    login(client)
    record_id = record(client)
    assert upload(client, record_id, data=data, filename=name).status_code == 415
    assert not [path for path in store.root.rglob('*') if path.is_file()]
    assert client.get(f'/api/records/{record_id}/files').json()['items'] == []


def test_encrypted_pdf_and_resource_limits(client, monkeypatch):
    login(client)
    record_id = record(client)
    assert upload(client, record_id, data=pdf_bytes(True), filename='protegido.pdf').status_code == 415
    monkeypatch.setattr(settings(), 'max_image_pixels', 50)
    assert upload(client, record_id).status_code == 413
    monkeypatch.setattr(settings(), 'max_upload_bytes', 1024)
    assert upload(client, record_id, data=b'x' * 1025).status_code == 413
    # Supera incluso el margen multipart; sin cabecera Content-Length fiable.
    chunks = (b'x' * 1024 for _ in range(70))
    assert client.post(f'/api/records/{record_id}/files', content=chunks,
        headers={'Content-Type': 'multipart/form-data; boundary=demo'}).status_code == 413


@pytest.mark.parametrize('name', ['../../foto.png', 'C:\\carpeta\\foto.png', '../../CON.png'])
def test_filename_never_becomes_storage_path(client, store, name):
    login(client)
    record_id = record(client)
    result = upload(client, record_id, filename=name)
    assert result.status_code == 201
    assert '/' not in result.json()['filename'] and '\\' not in result.json()['filename']
    files = [path for path in store.root.rglob('*') if path.is_file()]
    assert len(files) == 2 and all(len(path.name) == 32 for path in files)
    for key in ['../secreto', 'originals/../../secreto', '/etc/passwd', 'originals/C:\\secreto']:
        with pytest.raises(ValueError):
            store.read(key)


def test_failed_storage_rolls_back_and_removes_original(client, store, monkeypatch):
    login(client)
    record_id = record(client)
    original_put = store.put
    def failing_put(key, data):
        if key.startswith('previews/'):
            raise OSError('Fallo ficticio')
        original_put(key, data)
    monkeypatch.setattr(store, 'put', failing_put)
    assert upload(client, record_id).status_code == 503
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(RecordFile)) == 0
    assert not [path for path in store.root.rglob('*') if path.is_file()]


def test_storage_is_replaceable_and_authorization_before_read(client):
    class MemoryStorage:
        def __init__(self): self.objects = {}; self.reads = 0
        def put(self, key, data): self.objects[key] = data
        def read(self, key): self.reads += 1; return self.objects[key]
        def delete(self, key): self.objects.pop(key, None)
    store = MemoryStorage()
    app.dependency_overrides[get_storage] = lambda: store
    login(client)
    record_id = record(client)
    result = upload(client, record_id).json()
    path = f"/api/records/{record_id}/files/{result['id']}/content"
    assert client.get(path).status_code == 200 and store.reads == 1
    login(client, 'admin@example.test')
    assert client.get(path).status_code == 404 and store.reads == 1


def test_upload_requires_auth_and_csrf(client):
    assert upload(client, str(uuid4())).status_code == 401
    login(client)
    record_id = record(client)
    result = client.post(f'/api/records/{record_id}/files', files={'file': ('foto.png', image_bytes())}, headers={'Origin': 'https://ajeno.test'})
    assert result.status_code == 403
