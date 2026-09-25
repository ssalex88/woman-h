from datetime import datetime, timezone
from uuid import uuid4
import pytest
from app.db import SessionLocal
from app.models import Account
from conftest import login

UNKNOWN = {'description': 'Hecho ficticio sin fecha conocida', 'date_kind': 'unknown'}


def record(client):
    response = client.post('/api/records', json={'title': 'Caso ficticio', 'description': 'Contexto ficticio'})
    assert response.status_code == 201
    return response.json()['id']


@pytest.mark.parametrize('fields', [
    {'date_kind': 'unknown'},
    {'date_kind': 'approximate', 'approximate_date': 'A mediados de marzo de 2025'},
    {'date_kind': 'exact', 'event_date': '2025-03-14'},
])
def test_dates_persistence_and_optional_fields_without_files(client, fields):
    login(client)
    record_id = record(client)
    path = f'/api/records/{record_id}/accounts'
    assert client.get(path).json() == []
    before = datetime.now(timezone.utc)
    result = client.post(path, json={**UNKNOWN, **fields, 'place': '  ', 'mentioned_people': ''})
    assert result.status_code == 201
    account = result.json()
    assert account['event_date'] == fields.get('event_date')
    assert account['approximate_date'] == fields.get('approximate_date')
    assert account['place'] is None and account['mentioned_people'] is None
    assert before <= datetime.fromisoformat(account['created_at']) <= datetime.now(timezone.utc)
    with SessionLocal() as db:
        assert db.get(Account, account['id']).record_id == record_id
    client.post('/api/auth/logout')
    login(client)
    assert client.get(path).json() == [account]
    assert client.get(f"{path}/{account['id']}").json() == account


def test_edit_date_precision_and_clear_optional_fields_keeps_registration_date(client):
    login(client)
    path = f'/api/records/{record(client)}/accounts'
    account = client.post(path, json={**UNKNOWN, 'date_kind': 'exact', 'event_date': '2020-01-02',
                                     'place': 'Lugar ficticio', 'mentioned_people': 'Persona ficticia'}).json()
    for payload in [
        {**UNKNOWN, 'date_kind': 'approximate', 'approximate_date': 'Durante 2020'}, UNKNOWN,
    ]:
        response = client.put(f"{path}/{account['id']}", json=payload)
        assert response.status_code == 200
        edited = response.json()
        assert edited['created_at'] == account['created_at']
        assert edited['updated_at'] >= account['updated_at']
        assert edited['event_date'] is None
        assert edited['approximate_date'] == payload.get('approximate_date')
        assert edited['place'] is None and edited['mentioned_people'] is None


@pytest.mark.parametrize('email', ['bea@example.test', 'admin@example.test', 'revisora@example.test'])
def test_parent_permissions_apply_to_all_operations_and_wrong_parent(client, email):
    login(client)
    record_id = record(client)
    path = f'/api/records/{record_id}/accounts'
    account = client.post(path, json=UNKNOWN).json()
    login(client, email)
    own_record = record(client)
    assert client.get(path).status_code == 404
    assert client.post(path, json=UNKNOWN).status_code == 404
    assert client.get(f"{path}/{account['id']}").status_code == 404
    assert client.put(f"{path}/{account['id']}", json={**UNKNOWN, 'description': 'Cambio ajeno'}).status_code == 404
    disguised_path = f"/api/records/{own_record}/accounts/{account['id']}"
    assert client.get(disguised_path).status_code == 404
    assert client.put(disguised_path, json=UNKNOWN).status_code == 404
    with SessionLocal() as db:
        assert db.get(Account, account['id']).description == UNKNOWN['description']


@pytest.mark.parametrize('extra', [
    {'description': '   '}, {'date_kind': 'inventada'},
    {'date_kind': 'exact'}, {'date_kind': 'approximate'},
    {'date_kind': 'approximate', 'approximate_date': '   '},
    {'date_kind': 'unknown', 'event_date': '2025-01-01'},
    {'date_kind': 'unknown', 'approximate_date': 'En enero'},
    {'date_kind': 'exact', 'event_date': '2025-02-30'},
    {'date_kind': 'exact', 'event_date': 0},
    {'date_kind': 'exact', 'event_date': '2025-01-01T00:00:00Z'},
    {'date_kind': 'exact', 'event_date': '2025-01-01', 'approximate_date': 'Enero'},
    {'created_at': '2020-01-01T00:00:00Z'}, {'record_id': str(uuid4())},
    {'owner_id': str(uuid4())}, {'description': 'x' * 10001},
    {'place': 'x' * 501}, {'mentioned_people': 'x' * 2001},
])
def test_invalid_or_injected_values_rejected_without_changes(client, extra):
    login(client)
    path = f'/api/records/{record(client)}/accounts'
    account = client.post(path, json=UNKNOWN).json()
    assert client.post(path, json={**UNKNOWN, **extra}).status_code == 422
    assert client.put(f"{path}/{account['id']}", json={**UNKNOWN, **extra}).status_code == 422
    assert client.get(path).json() == [account]


def test_anonymous_and_csrf_denied(client):
    path = f'/api/records/{uuid4()}/accounts'
    assert client.get(path).status_code == 401
    assert client.post(path, json=UNKNOWN).status_code == 401
    assert client.get(f'{path}/{uuid4()}').status_code == 401
    assert client.put(f'{path}/{uuid4()}', json=UNKNOWN).status_code == 401
    login(client)
    path = f'/api/records/{record(client)}/accounts'
    account = client.post(path, json=UNKNOWN).json()
    headers = {'Origin': 'https://ajeno.test'}
    assert client.post(path, json=UNKNOWN, headers=headers).status_code == 403
    assert client.put(f"{path}/{account['id']}", json=UNKNOWN, headers=headers).status_code == 403
