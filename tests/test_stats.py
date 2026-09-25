"""Tests for /api/stats endpoint."""
import pytest
from tests.helpers import make_coffee


class TestStats:
    def test_empty_db_returns_zeros(self, client):
        resp = client.get('/api/stats')
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

    def test_total_count(self, client):
        make_coffee(client)
        make_coffee(client, {'name': 'Second'})
        make_coffee(client, {'name': 'Third'})
        data = client.get('/api/stats').get_json()
        assert data['total'] == 3

    def test_finished_count(self, client):
        coffee = make_coffee(client)
        client.post(f'/api/coffees/{coffee["id"]}/open')
        client.post(f'/api/coffees/{coffee["id"]}/finish')
        make_coffee(client, {'name': 'Active', 'opened_date': '2026-01-01'})
        data = client.get('/api/stats').get_json()
        assert data['finished'] == 1

    def test_active_count(self, client):
        make_coffee(client, {'name': 'Active', 'opened_date': '2026-01-01'})
        make_coffee(client, {'name': 'Pending'})
        make_coffee(client, {'name': 'Finished', 'opened_date': '2026-01-01', 'finished_date': '2026-02-01'})
        data = client.get('/api/stats').get_json()
        assert data['active'] == 1

    def test_pending_weight(self, client):
        make_coffee(client, {'name': 'P1', 'quantity_g': 250})
        make_coffee(client, {'name': 'P2', 'quantity_g': 250})
        data = client.get('/api/stats').get_json()
        assert data['pending_weight_g'] == 500

    def test_active_weight(self, client):
        # Active coffee uses remaining_g, not quantity_g
        coffee = make_coffee(client, {'name': 'Active', 'quantity_g': 250})
        client.put(f'/api/coffees/{coffee["id"]}/remaining', json={'remaining_g': 200})
        client.post(f'/api/coffees/{coffee["id"]}/open', json={'date': '2026-01-01'})
        data = client.get('/api/stats').get_json()
        assert data['active_weight_g'] == 200

    def test_avg_rating(self, client):
        make_coffee(client, {'name': 'A', 'rating': 3})
        make_coffee(client, {'name': 'B', 'rating': 5})
        data = client.get('/api/stats').get_json()
        assert data['avg_rating'] == 4.0

    def test_avg_rating_ignores_unrated(self, client):
        make_coffee(client, {'name': 'Rated', 'rating': 4})
        make_coffee(client, {'name': 'Unrated', 'rating': None})
        data = client.get('/api/stats').get_json()
        assert data['avg_rating'] == 4.0

    def test_total_spent(self, client):
        # 1 kg at 30 €/kg = 30 €
        make_coffee(client, {'name': 'X', 'quantity_g': 1000, 'price_kg': 30.0})
        data = client.get('/api/stats').get_json()
        assert data['total_spent'] == 30.0

    def test_total_spent_two_coffees(self, client):
        make_coffee(client, {'name': 'A', 'quantity_g': 500, 'price_kg': 30.0})  # 15€
        make_coffee(client, {'name': 'B', 'quantity_g': 250, 'price_kg': 20.0})  # 5€
        data = client.get('/api/stats').get_json()
        assert data['total_spent'] == 20.0

    def test_top_roasters_structure(self, client):
        make_coffee(client, {'name': 'A', 'roaster': 'Best Roaster', 'rating': 5})
        make_coffee(client, {'name': 'B', 'roaster': 'Best Roaster', 'rating': 4})
        data = client.get('/api/stats').get_json()
        assert len(data['top_roasters']) >= 1
        roaster = data['top_roasters'][0]
        assert 'name' in roaster
        assert 'cnt' in roaster
        assert 'avg_rating' in roaster
        assert roaster['name'] == 'Best Roaster'
        assert roaster['cnt'] == 2

    def test_origins_breakdown(self, client):
        make_coffee(client, {'name': 'A', 'origin': 'Ethiopia', 'rating': 5})
        data = client.get('/api/stats').get_json()
        origins = [o['name'] for o in data['origins_breakdown']]
        assert 'Ethiopia' in origins

    def test_processes_breakdown(self, client):
        make_coffee(client, {'name': 'A', 'processes': ['Washed']})
        data = client.get('/api/stats').get_json()
        processes = [p['name'] for p in data['processes_breakdown']]
        assert 'Washed' in processes

    def test_varieties_breakdown(self, client):
        make_coffee(client, {'name': 'A', 'varieties': ['Bourbon']})
        data = client.get('/api/stats').get_json()
        varieties = [v['name'] for v in data['varieties_breakdown']]
        assert 'Bourbon' in varieties

    def test_response_has_all_keys(self, client):
        data = client.get('/api/stats').get_json()
        expected_keys = {'total', 'finished', 'active', 'pending_weight_g', 'active_weight_g',
                         'avg_rating', 'total_spent', 'avg_cost_kg', 'days_per_kg',
                         'top_roasters', 'origins_breakdown', 'processes_breakdown', 'varieties_breakdown',
                         'current_month', 'active_bags'}
        assert expected_keys.issubset(set(data.keys()))

    def test_current_month_structure(self, client):
        data = client.get('/api/stats').get_json()
        cm = data['current_month']
        assert 'consumed_g' in cm
        assert 'brews_count' in cm
        assert 'avg_rating' in cm

    def test_active_bags_is_list(self, client):
        data = client.get('/api/stats').get_json()
        assert isinstance(data['active_bags'], list)
