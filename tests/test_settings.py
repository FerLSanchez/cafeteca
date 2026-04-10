"""Tests for /api/settings, /api/options, and /api/lookup-tables endpoints."""
import pytest
from lookup_config import LOOKUP_TABLES


class TestGetSettings:
    def test_requires_auth(self, client):
        assert client.get('/api/settings').status_code == 401

    def test_default_grams_per_shot(self, auth_client):
        resp = auth_client.get('/api/settings')
        assert resp.status_code == 200
        assert resp.get_json()['grams_per_shot'] == 17


class TestUpdateSettings:
    def test_requires_auth(self, client):
        assert client.put('/api/settings', json={'grams_per_shot': 20}).status_code == 401

    def test_update_valid_value(self, auth_client):
        resp = auth_client.put('/api/settings', json={'grams_per_shot': 20})
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

    def test_updated_value_persists(self, auth_client):
        auth_client.put('/api/settings', json={'grams_per_shot': 25})
        resp = auth_client.get('/api/settings')
        assert resp.get_json()['grams_per_shot'] == 25

    def test_boundary_one(self, auth_client):
        assert auth_client.put('/api/settings', json={'grams_per_shot': 1}).status_code == 200

    def test_boundary_100(self, auth_client):
        assert auth_client.put('/api/settings', json={'grams_per_shot': 100}).status_code == 200

    def test_zero_returns_400(self, auth_client):
        resp = auth_client.put('/api/settings', json={'grams_per_shot': 0})
        assert resp.status_code == 400

    def test_over_100_returns_400(self, auth_client):
        resp = auth_client.put('/api/settings', json={'grams_per_shot': 101})
        assert resp.status_code == 400

    def test_negative_returns_400(self, auth_client):
        resp = auth_client.put('/api/settings', json={'grams_per_shot': -1})
        assert resp.status_code == 400

    def test_float_returns_400(self, auth_client):
        resp = auth_client.put('/api/settings', json={'grams_per_shot': 18.5})
        assert resp.status_code == 400

    def test_bool_returns_400(self, auth_client):
        resp = auth_client.put('/api/settings', json={'grams_per_shot': True})
        assert resp.status_code == 400

    def test_missing_field_returns_400(self, auth_client):
        resp = auth_client.put('/api/settings', json={})
        assert resp.status_code == 400


class TestOptions:
    def test_requires_auth(self, client):
        assert client.get('/api/options').status_code == 401

    def test_returns_all_lookup_tables(self, auth_client):
        resp = auth_client.get('/api/options')
        assert resp.status_code == 200
        data = resp.get_json()
        for table in LOOKUP_TABLES:
            assert table in data, f"Missing table '{table}' in /api/options"

    def test_regions_include_origin_id(self, auth_client):
        # Add a region via a coffee
        auth_client.post('/api/coffees', json={
            'name': 'X', 'origin': 'Colombia', 'region': 'Huila'
        })
        resp = auth_client.get('/api/options')
        regions = resp.get_json().get('regions', [])
        assert len(regions) >= 1
        assert all('origin_id' in r for r in regions)

    def test_milk_types_seeded(self, auth_client):
        resp = auth_client.get('/api/options')
        milk_types = [m['name'] for m in resp.get_json().get('milk_types', [])]
        assert 'Avena' in milk_types

    def test_lookup_entries_added_after_coffee(self, auth_client):
        auth_client.post('/api/coffees', json={'name': 'X', 'roaster': 'Unique Roaster'})
        resp = auth_client.get('/api/options')
        roasters = [r['name'] for r in resp.get_json().get('roasters', [])]
        assert 'Unique Roaster' in roasters


class TestGetLookupTables:
    def test_requires_auth(self, client):
        assert client.get('/api/lookup-tables').status_code == 401

    def test_returns_list_of_tables(self, auth_client):
        resp = auth_client.get('/api/lookup-tables')
        assert resp.status_code == 200
        data = resp.get_json()
        assert isinstance(data, list)
        assert len(data) == len(LOOKUP_TABLES)

    def test_contains_expected_tables(self, auth_client):
        data = auth_client.get('/api/lookup-tables').get_json()
        for t in LOOKUP_TABLES:
            assert t in data
