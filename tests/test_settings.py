"""Tests for /api/settings, /api/options, and /api/lookup-tables endpoints."""
import pytest
from lookup_config import LOOKUP_TABLES


class TestGetSettings:
    def test_default_grams_per_shot(self, client):
        resp = client.get('/api/settings')
        assert resp.status_code == 200
        assert resp.get_json()['grams_per_shot'] == 17

    def test_default_low_stock_threshold(self, client):
        resp = client.get('/api/settings')
        assert resp.status_code == 200
        assert resp.get_json()['low_stock_threshold'] == 5


class TestUpdateSettings:
    def test_update_valid_value(self, client):
        resp = client.put('/api/settings', json={'grams_per_shot': 20})
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

    def test_updated_value_persists(self, client):
        client.put('/api/settings', json={'grams_per_shot': 25})
        resp = client.get('/api/settings')
        assert resp.get_json()['grams_per_shot'] == 25

    def test_boundary_one(self, client):
        assert client.put('/api/settings', json={'grams_per_shot': 1}).status_code == 200

    def test_boundary_100(self, client):
        assert client.put('/api/settings', json={'grams_per_shot': 100}).status_code == 200

    def test_zero_returns_400(self, client):
        resp = client.put('/api/settings', json={'grams_per_shot': 0})
        assert resp.status_code == 400

    def test_over_100_returns_400(self, client):
        resp = client.put('/api/settings', json={'grams_per_shot': 101})
        assert resp.status_code == 400

    def test_negative_returns_400(self, client):
        resp = client.put('/api/settings', json={'grams_per_shot': -1})
        assert resp.status_code == 400

    def test_float_returns_400(self, client):
        resp = client.put('/api/settings', json={'grams_per_shot': 18.5})
        assert resp.status_code == 400

    def test_bool_returns_400(self, client):
        resp = client.put('/api/settings', json={'grams_per_shot': True})
        assert resp.status_code == 400

    def test_missing_field_returns_400(self, client):
        resp = client.put('/api/settings', json={})
        assert resp.status_code == 400

    def test_update_low_stock_threshold(self, client):
        resp = client.put('/api/settings', json={'low_stock_threshold': 3})
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

    def test_low_stock_threshold_persists(self, client):
        client.put('/api/settings', json={'low_stock_threshold': 8})
        resp = client.get('/api/settings')
        assert resp.get_json()['low_stock_threshold'] == 8

    def test_low_stock_threshold_boundary_1(self, client):
        assert client.put('/api/settings', json={'low_stock_threshold': 1}).status_code == 200

    def test_low_stock_threshold_boundary_50(self, client):
        assert client.put('/api/settings', json={'low_stock_threshold': 50}).status_code == 200

    def test_low_stock_threshold_zero_returns_400(self, client):
        resp = client.put('/api/settings', json={'low_stock_threshold': 0})
        assert resp.status_code == 400

    def test_low_stock_threshold_over_50_returns_400(self, client):
        resp = client.put('/api/settings', json={'low_stock_threshold': 51})
        assert resp.status_code == 400

    def test_low_stock_threshold_float_returns_400(self, client):
        resp = client.put('/api/settings', json={'low_stock_threshold': 3.5})
        assert resp.status_code == 400

    def test_update_both_settings_at_once(self, client):
        resp = client.put('/api/settings', json={'grams_per_shot': 18, 'low_stock_threshold': 7})
        assert resp.status_code == 200
        data = client.get('/api/settings').get_json()
        assert data['grams_per_shot'] == 18
        assert data['low_stock_threshold'] == 7


class TestOptions:
    def test_returns_all_lookup_tables(self, client):
        resp = client.get('/api/options')
        assert resp.status_code == 200
        data = resp.get_json()
        for table in LOOKUP_TABLES:
            assert table in data, f"Missing table '{table}' in /api/options"

    def test_regions_include_origin_id(self, client):
        # Add a region via a coffee
        client.post('/api/coffees', json={
            'name': 'X', 'origin': 'Colombia', 'region': 'Huila'
        })
        resp = client.get('/api/options')
        regions = resp.get_json().get('regions', [])
        assert len(regions) >= 1
        assert all('origin_id' in r for r in regions)

    def test_milk_types_seeded(self, client):
        resp = client.get('/api/options')
        milk_types = [m['name'] for m in resp.get_json().get('milk_types', [])]
        assert 'Avena' in milk_types

    def test_lookup_entries_added_after_coffee(self, client):
        client.post('/api/coffees', json={'name': 'X', 'roaster': 'Unique Roaster'})
        resp = client.get('/api/options')
        roasters = [r['name'] for r in resp.get_json().get('roasters', [])]
        assert 'Unique Roaster' in roasters


class TestGetLookupTables:
    def test_returns_list_of_tables(self, client):
        resp = client.get('/api/lookup-tables')
        assert resp.status_code == 200
        data = resp.get_json()
        assert isinstance(data, list)
        assert len(data) == len(LOOKUP_TABLES)

    def test_contains_expected_tables(self, client):
        data = client.get('/api/lookup-tables').get_json()
        for t in LOOKUP_TABLES:
            assert t in data


class TestFlowTolerance:
    def test_default(self, client):
        assert client.get('/api/settings').get_json()['flow_tolerance'] == 0.2

    def test_update_alone(self, client):
        assert client.put('/api/settings', json={'flow_tolerance': 0.3}).status_code == 200
        assert client.get('/api/settings').get_json()['flow_tolerance'] == 0.3

    @pytest.mark.parametrize('bad', [0, 0.01, 2, 'x', True])
    def test_invalid(self, client, bad):
        resp = client.put('/api/settings', json={'flow_tolerance': bad})
        assert resp.status_code == 400
        assert resp.get_json()['error_key'] == 'error.settings.flow_tolerance_invalid'


class TestGrindStep:
    def test_default_is_one(self, client):
        assert client.get('/api/settings').get_json()['grind_step'] == 1

    def test_update(self, client):
        assert client.put('/api/settings', json={'grind_step': 0.5}).status_code == 200
        assert client.get('/api/settings').get_json()['grind_step'] == 0.5

    @pytest.mark.parametrize('bad', [0, 0.05, 6, 'x', True])
    def test_invalid(self, client, bad):
        resp = client.put('/api/settings', json={'grind_step': bad})
        assert resp.status_code == 400
        assert resp.get_json()['error_key'] == 'error.settings.grind_step_invalid'
