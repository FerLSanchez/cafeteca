"""Tests for /api/lookup/<table> CRUD endpoints."""
import pytest
from tests.helpers import make_coffee


class TestLookupList:
    def test_requires_auth(self, client):
        assert client.get('/api/lookup/roasters').status_code == 401

    def test_unknown_table_returns_404(self, auth_client):
        assert auth_client.get('/api/lookup/nonexistent').status_code == 404

    def test_empty_table(self, auth_client):
        resp = auth_client.get('/api/lookup/roasters')
        assert resp.status_code == 200
        assert resp.get_json() == []

    def test_list_after_coffee_added(self, auth_client):
        make_coffee(auth_client, {'roaster': 'Test Roaster'})
        resp = auth_client.get('/api/lookup/roasters')
        data = resp.get_json()
        assert len(data) == 1
        assert data[0]['name'] == 'Test Roaster'

    def test_coffee_count_for_fk_table(self, auth_client):
        make_coffee(auth_client, {'roaster': 'Count Roaster'})
        make_coffee(auth_client, {'name': 'Second', 'roaster': 'Count Roaster'})
        resp = auth_client.get('/api/lookup/roasters')
        entry = next((r for r in resp.get_json() if r['name'] == 'Count Roaster'), None)
        assert entry is not None
        assert entry['coffee_count'] == 2

    def test_coffee_count_for_junction_table(self, auth_client):
        make_coffee(auth_client, {'varieties': ['Bourbon']})
        make_coffee(auth_client, {'name': 'Second', 'varieties': ['Bourbon', 'Typica']})
        resp = auth_client.get('/api/lookup/varieties')
        bourbon = next((r for r in resp.get_json() if r['name'] == 'Bourbon'), None)
        assert bourbon is not None
        assert bourbon['coffee_count'] == 2

    def test_regions_include_origin_name(self, auth_client):
        make_coffee(auth_client, {'origin': 'Ethiopia', 'region': 'Yirgacheffe'})
        resp = auth_client.get('/api/lookup/regions')
        yirgacheffe = next((r for r in resp.get_json() if r['name'] == 'Yirgacheffe'), None)
        assert yirgacheffe is not None
        assert yirgacheffe.get('origin_name') == 'Ethiopia'

    def test_all_tables_accessible(self, auth_client):
        from lookup_config import LOOKUP_TABLES
        for table in LOOKUP_TABLES:
            resp = auth_client.get(f'/api/lookup/{table}')
            assert resp.status_code == 200, f"Table {table} returned {resp.status_code}"


class TestLookupRename:
    def test_requires_auth(self, client):
        assert client.put('/api/lookup/roasters/1', json={'name': 'New'}).status_code == 401

    def test_unknown_table_returns_404(self, auth_client):
        assert auth_client.put('/api/lookup/nonexistent/1', json={'name': 'X'}).status_code == 404

    def test_rename_success(self, auth_client):
        make_coffee(auth_client, {'roaster': 'Old Name'})
        entry = auth_client.get('/api/lookup/roasters').get_json()[0]
        resp = auth_client.put(f'/api/lookup/roasters/{entry["id"]}', json={'name': 'New Name'})
        assert resp.status_code == 200
        # Verify rename
        entries = auth_client.get('/api/lookup/roasters').get_json()
        names = [e['name'] for e in entries]
        assert 'New Name' in names
        assert 'Old Name' not in names

    def test_rename_empty_name_returns_400(self, auth_client):
        make_coffee(auth_client, {'roaster': 'Roaster'})
        entry = auth_client.get('/api/lookup/roasters').get_json()[0]
        resp = auth_client.put(f'/api/lookup/roasters/{entry["id"]}', json={'name': ''})
        assert resp.status_code == 400

    def test_rename_conflict_returns_409(self, auth_client):
        make_coffee(auth_client, {'roaster': 'Roaster A'})
        make_coffee(auth_client, {'name': 'Second', 'roaster': 'Roaster B'})
        entries = auth_client.get('/api/lookup/roasters').get_json()
        id_a = next(e['id'] for e in entries if e['name'] == 'Roaster A')
        resp = auth_client.put(f'/api/lookup/roasters/{id_a}', json={'name': 'Roaster B'})
        assert resp.status_code == 409

    def test_rename_to_same_name_succeeds(self, auth_client):
        """Renaming an entry to its own name should not conflict."""
        make_coffee(auth_client, {'roaster': 'Same Name'})
        entry = auth_client.get('/api/lookup/roasters').get_json()[0]
        resp = auth_client.put(f'/api/lookup/roasters/{entry["id"]}', json={'name': 'Same Name'})
        assert resp.status_code == 200


class TestLookupDelete:
    def test_requires_auth(self, client):
        assert client.delete('/api/lookup/roasters/1').status_code == 401

    def test_unknown_table_returns_404(self, auth_client):
        assert auth_client.delete('/api/lookup/nonexistent/1').status_code == 404

    def test_delete_unused_fk_entry(self, auth_client, db):
        # Insert a roaster directly without using it in any coffee
        db.execute("INSERT INTO roasters (name) VALUES ('Orphan Roaster')")
        db.commit()
        entry = auth_client.get('/api/lookup/roasters').get_json()
        orphan = next(e for e in entry if e['name'] == 'Orphan Roaster')
        resp = auth_client.delete(f'/api/lookup/roasters/{orphan["id"]}')
        assert resp.status_code == 200

    def test_delete_in_use_fk_returns_409(self, auth_client):
        make_coffee(auth_client, {'roaster': 'Used Roaster'})
        entry = auth_client.get('/api/lookup/roasters').get_json()[0]
        resp = auth_client.delete(f'/api/lookup/roasters/{entry["id"]}')
        assert resp.status_code == 409

    def test_delete_unused_junction_entry(self, auth_client, db):
        # Insert a variety directly without any coffees
        db.execute("INSERT INTO varieties (name) VALUES ('Orphan Variety')")
        db.commit()
        entries = auth_client.get('/api/lookup/varieties').get_json()
        orphan = next(e for e in entries if e['name'] == 'Orphan Variety')
        resp = auth_client.delete(f'/api/lookup/varieties/{orphan["id"]}')
        assert resp.status_code == 200

    def test_delete_in_use_junction_returns_409(self, auth_client):
        make_coffee(auth_client, {'varieties': ['Used Variety']})
        entries = auth_client.get('/api/lookup/varieties').get_json()
        used = next(e for e in entries if e['name'] == 'Used Variety')
        resp = auth_client.delete(f'/api/lookup/varieties/{used["id"]}')
        assert resp.status_code == 409


class TestLookupPurge:
    def test_requires_auth(self, client):
        assert client.post('/api/lookup/roasters/purge').status_code == 401

    def test_unknown_table_returns_404(self, auth_client):
        assert auth_client.post('/api/lookup/nonexistent/purge').status_code == 404

    def test_purge_removes_orphan_fk_entries(self, auth_client, db):
        # Two roasters: one used, one not
        make_coffee(auth_client, {'roaster': 'Used Roaster'})
        db.execute("INSERT INTO roasters (name) VALUES ('Orphan Roaster')")
        db.commit()
        resp = auth_client.post('/api/lookup/roasters/purge')
        assert resp.status_code == 200
        assert resp.get_json()['deleted'] == 1
        entries = auth_client.get('/api/lookup/roasters').get_json()
        names = [e['name'] for e in entries]
        assert 'Used Roaster' in names
        assert 'Orphan Roaster' not in names

    def test_purge_removes_orphan_junction_entries(self, auth_client, db):
        make_coffee(auth_client, {'varieties': ['Used Variety']})
        db.execute("INSERT INTO varieties (name) VALUES ('Orphan Variety')")
        db.commit()
        resp = auth_client.post('/api/lookup/varieties/purge')
        assert resp.status_code == 200
        assert resp.get_json()['deleted'] == 1

    def test_purge_empty_table_returns_zero(self, auth_client):
        resp = auth_client.post('/api/lookup/roasters/purge')
        assert resp.get_json()['deleted'] == 0

    def test_purge_nothing_if_all_in_use(self, auth_client):
        make_coffee(auth_client, {'roaster': 'Used Roaster'})
        resp = auth_client.post('/api/lookup/roasters/purge')
        assert resp.get_json()['deleted'] == 0
