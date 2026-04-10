"""Tests for /api/stats endpoint."""
import pytest
from tests.helpers import make_coffee


class TestStats:
    def test_requires_auth(self, client):
        assert client.get('/api/stats').status_code == 401

    def test_empty_db_returns_zeros(self, auth_client):
        resp = auth_client.get('/api/stats')
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['total'] == 0
        assert data['finished'] == 0
        assert data['active'] == 0
        assert data['pending_weight_g'] == 0
        assert data['active_weight_g'] == 0
        assert data['avg_rating'] is None
        assert data['total_spent'] == 0
        assert data['top_roasters'] == []

    def test_total_count(self, auth_client):
        make_coffee(auth_client)
        make_coffee(auth_client, {'name': 'Second'})
        make_coffee(auth_client, {'name': 'Third'})
        data = auth_client.get('/api/stats').get_json()
        assert data['total'] == 3

    def test_finished_count(self, auth_client):
        coffee = make_coffee(auth_client)
        auth_client.post(f'/api/coffees/{coffee["id"]}/open')
        auth_client.post(f'/api/coffees/{coffee["id"]}/finish')
        make_coffee(auth_client, {'name': 'Active', 'opened_date': '2026-01-01'})
        data = auth_client.get('/api/stats').get_json()
        assert data['finished'] == 1

    def test_active_count(self, auth_client):
        make_coffee(auth_client, {'name': 'Active', 'opened_date': '2026-01-01'})
        make_coffee(auth_client, {'name': 'Pending'})
        make_coffee(auth_client, {'name': 'Finished', 'opened_date': '2026-01-01', 'finished_date': '2026-02-01'})
        data = auth_client.get('/api/stats').get_json()
        assert data['active'] == 1

    def test_pending_weight(self, auth_client):
        make_coffee(auth_client, {'name': 'P1', 'quantity_g': 250})
        make_coffee(auth_client, {'name': 'P2', 'quantity_g': 250})
        data = auth_client.get('/api/stats').get_json()
        assert data['pending_weight_g'] == 500

    def test_active_weight(self, auth_client):
        # Active coffee uses remaining_g, not quantity_g
        coffee = make_coffee(auth_client, {'name': 'Active', 'quantity_g': 250})
        auth_client.put(f'/api/coffees/{coffee["id"]}/remaining', json={'remaining_g': 200})
        auth_client.post(f'/api/coffees/{coffee["id"]}/open', json={'date': '2026-01-01'})
        data = auth_client.get('/api/stats').get_json()
        assert data['active_weight_g'] == 200

    def test_avg_rating(self, auth_client):
        make_coffee(auth_client, {'name': 'A', 'rating': 3})
        make_coffee(auth_client, {'name': 'B', 'rating': 5})
        data = auth_client.get('/api/stats').get_json()
        assert data['avg_rating'] == 4.0

    def test_avg_rating_ignores_unrated(self, auth_client):
        make_coffee(auth_client, {'name': 'Rated', 'rating': 4})
        make_coffee(auth_client, {'name': 'Unrated', 'rating': None})
        data = auth_client.get('/api/stats').get_json()
        assert data['avg_rating'] == 4.0

    def test_total_spent(self, auth_client):
        # 1 kg at 30 €/kg = 30 €
        make_coffee(auth_client, {'name': 'X', 'quantity_g': 1000, 'price_kg': 30.0})
        data = auth_client.get('/api/stats').get_json()
        assert data['total_spent'] == 30.0

    def test_total_spent_two_coffees(self, auth_client):
        make_coffee(auth_client, {'name': 'A', 'quantity_g': 500, 'price_kg': 30.0})  # 15€
        make_coffee(auth_client, {'name': 'B', 'quantity_g': 250, 'price_kg': 20.0})  # 5€
        data = auth_client.get('/api/stats').get_json()
        assert data['total_spent'] == 20.0

    def test_top_roasters_structure(self, auth_client):
        make_coffee(auth_client, {'name': 'A', 'roaster': 'Best Roaster', 'rating': 5})
        make_coffee(auth_client, {'name': 'B', 'roaster': 'Best Roaster', 'rating': 4})
        data = auth_client.get('/api/stats').get_json()
        assert len(data['top_roasters']) >= 1
        roaster = data['top_roasters'][0]
        assert 'name' in roaster
        assert 'cnt' in roaster
        assert 'avg_rating' in roaster
        assert roaster['name'] == 'Best Roaster'
        assert roaster['cnt'] == 2

    def test_origins_breakdown(self, auth_client):
        make_coffee(auth_client, {'name': 'A', 'origin': 'Ethiopia', 'rating': 5})
        data = auth_client.get('/api/stats').get_json()
        origins = [o['name'] for o in data['origins_breakdown']]
        assert 'Ethiopia' in origins

    def test_processes_breakdown(self, auth_client):
        make_coffee(auth_client, {'name': 'A', 'processes': ['Washed']})
        data = auth_client.get('/api/stats').get_json()
        processes = [p['name'] for p in data['processes_breakdown']]
        assert 'Washed' in processes

    def test_varieties_breakdown(self, auth_client):
        make_coffee(auth_client, {'name': 'A', 'varieties': ['Bourbon']})
        data = auth_client.get('/api/stats').get_json()
        varieties = [v['name'] for v in data['varieties_breakdown']]
        assert 'Bourbon' in varieties

    def test_response_has_all_keys(self, auth_client):
        data = auth_client.get('/api/stats').get_json()
        expected_keys = {'total', 'finished', 'active', 'pending_weight_g', 'active_weight_g',
                         'avg_rating', 'total_spent', 'avg_cost_kg', 'days_per_kg',
                         'top_roasters', 'origins_breakdown', 'processes_breakdown', 'varieties_breakdown'}
        assert expected_keys.issubset(set(data.keys()))
