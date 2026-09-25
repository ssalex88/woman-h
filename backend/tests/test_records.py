from uuid import uuid4
import pytest
from sqlalchemy import func, select
from app.db import SessionLocal
from app.models import Institution, Membership, PrivateRecord
from conftest import login

PAYLOAD = {"title": "Situación ficticia", "description": "Descripción inicial ficticia."}


def create(client):
    response = client.post('/api/records', json=PAYLOAD)
    assert response.status_code == 201
    return response.json()


def test_create_persist_list_detail_edit_no_institutional_side_effects(client):
    user = login(client)
    assert client.get('/api/records').json() == []
    with SessionLocal() as db:
        memberships = db.scalar(select(func.count()).select_from(Membership))
        institutions = db.scalar(select(func.count()).select_from(Institution))
    record = create(client)
    assert record['status'] == 'private_draft'
    with SessionLocal() as db:
        stored = db.get(PrivateRecord, record['id'])
        assert stored.owner_id == user['id'] and stored.description == PAYLOAD['description']
        assert db.scalar(select(func.count()).select_from(Membership)) == memberships
        assert db.scalar(select(func.count()).select_from(Institution)) == institutions
    client.post('/api/auth/logout')
    login(client)
    assert client.get('/api/records').json() == [record]
    assert client.get(f"/api/records/{record['id']}").json() == record
    changed = client.put(f"/api/records/{record['id']}", json={**PAYLOAD, 'title': 'Actualizado'})
    assert changed.status_code == 200
    assert changed.json()['status'] == 'private_draft'
    assert changed.json()['created_at'] == record['created_at']
    with SessionLocal() as db:
        assert db.get(PrivateRecord, record['id']).title == 'Actualizado'
    # El contexto institucional no recibe el registro creado.
    admin = login(client, 'admin@example.test')
    context = client.get(f"/api/institutions/{admin['memberships'][0]['institution_id']}/context").json()
    assert context['case_access'] is False
    assert record['id'] not in str(context)


@pytest.mark.parametrize('email', ['bea@example.test', 'admin@example.test', 'revisora@example.test', 'otra@example.test'])
def test_other_users_cannot_list_read_or_modify_by_id(client, email):
    owner = login(client)
    record = create(client)
    login(client, email)
    own = create(client)
    listed = client.get(f"/api/records?owner_id={owner['id']}").json()
    assert [r['id'] for r in listed] == [own['id']]
    path = f"/api/records/{record['id']}"
    assert client.get(path).status_code == 404
    assert client.get(path).json() == client.get(f'/api/records/{uuid4()}').json()
    assert client.put(path, json={**PAYLOAD, 'title': 'Intento ajeno'}).status_code == 404
    with SessionLocal() as db:
        assert db.get(PrivateRecord, record['id']).title == PAYLOAD['title']


@pytest.mark.parametrize('method,path', [('get', '/api/records'), ('post', '/api/records'), ('get', f'/api/records/{uuid4()}'), ('put', f'/api/records/{uuid4()}')])
def test_records_require_authentication(client, method, path):
    kwargs = {'json': PAYLOAD} if method in ('post', 'put') else {}
    assert getattr(client, method)(path, **kwargs).status_code == 401


@pytest.mark.parametrize('payload', [
    {**PAYLOAD, 'title': '   '}, {**PAYLOAD, 'description': '\n '},
    {**PAYLOAD, 'title': 'x' * 201}, {**PAYLOAD, 'description': 'x' * 10001},
    {**PAYLOAD, 'owner_id': str(uuid4())}, {**PAYLOAD, 'status': 'sent'},
    {**PAYLOAD, 'institution_id': str(uuid4())}, {'title': 'Sin descripción'},
])
def test_invalid_fields_cannot_create_or_change_records(client, payload):
    login(client)
    record = create(client)
    assert client.post('/api/records', json=payload).status_code == 422
    assert client.put(f"/api/records/{record['id']}", json=payload).status_code == 422
    assert len(client.get('/api/records').json()) == 1
    assert client.get(f"/api/records/{record['id']}").json() == record


def test_record_writes_require_csrf_headers(client):
    login(client)
    record = create(client)
    headers = {'Origin': 'https://ajeno.test', 'X-VERA-Request': '1'}
    assert client.post('/api/records', headers=headers, json=PAYLOAD).status_code == 403
    assert client.put(f"/api/records/{record['id']}", headers=headers, json=PAYLOAD).status_code == 403
