"""Tests for coffee CRUD endpoints."""
import pytest
from tests.helpers import make_coffee, make_brew


class TestListCoffees:
    def test_empty_list(self, client):
        resp = client.get('/api/coffees')
        assert resp.status_code == 200
        assert resp.get_json() == []

    def test_list_after_add(self, client):
        make_coffee(client)
        make_coffee(client, {'name': 'Second Coffee'})
        resp = client.get('/api/coffees')
        data = resp.get_json()
        assert len(data) == 2

    def test_list_returns_all_added_coffees(self, client):
        make_coffee(client, {'name': 'First'})
        make_coffee(client, {'name': 'Second'})
        resp = client.get('/api/coffees')
        data = resp.get_json()
        names = {c['name'] for c in data}
        assert names == {'First', 'Second'}

    def test_filter_by_status_pending(self, client):
        make_coffee(client, {'name': 'Pending'})
        make_coffee(client, {'name': 'Opened', 'opened_date': '2026-01-01'})
        resp = client.get('/api/coffees?status=pending')
        data = resp.get_json()
        assert all(not c.get('opened_date') for c in data)
        assert any(c['name'] == 'Pending' for c in data)

    def test_filter_by_status_active(self, client):
        make_coffee(client, {'name': 'Active', 'opened_date': '2026-01-01'})
        make_coffee(client, {'name': 'Finished', 'opened_date': '2026-01-01', 'finished_date': '2026-02-01'})
        make_coffee(client, {'name': 'Pending'})
        resp = client.get('/api/coffees?status=active')
        data = resp.get_json()
        names = [c['name'] for c in data]
        assert 'Active' in names
        assert 'Finished' not in names
        assert 'Pending' not in names

    def test_filter_by_status_finished(self, client):
        make_coffee(client, {'name': 'Finished', 'opened_date': '2026-01-01', 'finished_date': '2026-02-01'})
        make_coffee(client, {'name': 'Active', 'opened_date': '2026-01-01'})
        resp = client.get('/api/coffees?status=finished')
        data = resp.get_json()
        assert all(c.get('finished_date') for c in data)

    def test_filter_by_status_unrated(self, client):
        make_coffee(client, {'name': 'Rated', 'rating': 4})
        make_coffee(client, {'name': 'Unrated', 'rating': None})
        resp = client.get('/api/coffees?status=unrated')
        data = resp.get_json()
        names = [c['name'] for c in data]
        assert 'Unrated' in names
        assert 'Rated' not in names

    def test_search_by_name(self, client):
        make_coffee(client, {'name': 'UniqueXyzCoffee'})
        make_coffee(client, {'name': 'Other Coffee'})
        resp = client.get('/api/coffees?q=UniqueXyz')
        data = resp.get_json()
        assert any('UniqueXyz' in c['name'] for c in data)
        assert not any(c['name'] == 'Other Coffee' for c in data)

    def test_limit_and_offset(self, client):
        for i in range(3):
            make_coffee(client, {'name': f'Coffee {i}'})
        resp_all = client.get('/api/coffees')
        assert len(resp_all.get_json()) == 3

        resp1 = client.get('/api/coffees?limit=1&offset=0')
        assert len(resp1.get_json()) == 1

        resp2 = client.get('/api/coffees?limit=1&offset=1')
        assert len(resp2.get_json()) == 1
        assert resp1.get_json()[0]['id'] != resp2.get_json()[0]['id']

    def test_limit_invalid_returns_400(self, client):
        resp = client.get('/api/coffees?limit=abc')
        assert resp.status_code == 400

    def test_filter_by_roaster_id(self, client):
        coffee = make_coffee(client, {'name': 'Filter Test', 'roaster': 'Special Roaster'})
        roaster_id = coffee.get('roaster_id')
        make_coffee(client, {'name': 'Other', 'roaster': 'Other Roaster'})
        resp = client.get(f'/api/coffees?roaster_id={roaster_id}')
        data = resp.get_json()
        assert all(c['roaster_id'] == roaster_id for c in data)


class TestAddCoffee:
    def test_minimal_returns_201(self, client):
        resp = client.post('/api/coffees', json={'name': 'Minimal'})
        assert resp.status_code == 201

    def test_response_includes_id(self, client):
        resp = client.post('/api/coffees', json={'name': 'X'})
        assert 'id' in resp.get_json()

    def test_missing_name_returns_400(self, client):
        resp = client.post('/api/coffees', json={})
        assert resp.status_code == 400

    def test_invalid_rating_returns_400(self, client):
        resp = client.post('/api/coffees', json={'name': 'X', 'rating': 6})
        assert resp.status_code == 400

    def test_full_coffee_with_m2m(self, client):
        data = {
            'name': 'Full Coffee',
            'quantity_g': 250,
            'price_kg': 30.0,
            'roaster': 'Great Roaster',
            'origin': 'Colombia',
            'region': 'Huila',
            'varieties': ['Caturra', 'Bourbon'],
            'processes': ['Washed'],
            'milk_types': ['Avena'],
            'rating': 5,
        }
        resp = client.post('/api/coffees', json=data)
        assert resp.status_code == 201
        body = resp.get_json()
        assert body['name'] == 'Full Coffee'
        assert 'Caturra' in body['varieties']
        assert 'Bourbon' in body['varieties']
        assert 'Washed' in body['processes']
        assert 'Avena' in body['milk_types']
        assert body['roaster'] == 'Great Roaster'

    def test_remaining_g_defaults_to_quantity_g(self, client):
        resp = client.post('/api/coffees', json={'name': 'X', 'quantity_g': 300})
        body = resp.get_json()
        assert body['remaining_g'] == 300

    def test_creates_lookup_entries(self, client):
        make_coffee(client, {'name': 'X', 'roaster': 'New Roaster'})
        resp = client.get('/api/lookup/roasters')
        names = [r['name'] for r in resp.get_json()]
        assert 'New Roaster' in names

    def test_source_id_copies_brews(self, client):
        source = make_coffee(client, {'name': 'Source Coffee'})
        make_brew(client, source['id'])
        copy = client.post('/api/coffees', json={'name': 'Copy', 'source_id': source['id']}).get_json()
        brews_resp = client.get(f'/api/coffees/{copy["id"]}/brews')
        assert len(brews_resp.get_json()) == 1


class TestUpdateCoffee:
    def test_update_name(self, client):
        coffee = make_coffee(client)
        resp = client.put(f'/api/coffees/{coffee["id"]}', json={'name': 'Updated Name'})
        assert resp.status_code == 200
        assert resp.get_json()['name'] == 'Updated Name'

    def test_update_m2m_replaces(self, client):
        coffee = make_coffee(client, {'name': 'X', 'varieties': ['Bourbon']})
        resp = client.put(f'/api/coffees/{coffee["id"]}', json={'name': 'X', 'varieties': ['Gesha']})
        body = resp.get_json()
        assert body['varieties'] == ['Gesha']

    def test_update_invalid_data_returns_400(self, client):
        coffee = make_coffee(client)
        resp = client.put(f'/api/coffees/{coffee["id"]}', json={'name': 'X', 'rating': 99})
        assert resp.status_code == 400


class TestDeleteCoffee:
    def test_delete_returns_ok(self, client):
        coffee = make_coffee(client)
        resp = client.delete(f'/api/coffees/{coffee["id"]}')
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

    def test_delete_not_found(self, client):
        resp = client.delete('/api/coffees/999')
        assert resp.status_code == 404

    def test_deleted_coffee_not_in_list(self, client):
        coffee = make_coffee(client)
        client.delete(f'/api/coffees/{coffee["id"]}')
        resp = client.get('/api/coffees')
        ids = [c['id'] for c in resp.get_json()]
        assert coffee['id'] not in ids

    def test_delete_purges_orphan_brews(self, client, db):
        coffee = make_coffee(client)
        make_brew(client, coffee['id'])
        brew_count_before = db.execute('SELECT COUNT(*) FROM brews').fetchone()[0]
        assert brew_count_before == 1

        client.delete(f'/api/coffees/{coffee["id"]}')
        brew_count_after = db.execute('SELECT COUNT(*) FROM brews').fetchone()[0]
        assert brew_count_after == 0


class TestOpenCoffee:
    def test_open_sets_today(self, client):
        coffee = make_coffee(client)
        resp = client.post(f'/api/coffees/{coffee["id"]}/open')
        assert resp.status_code == 200
        assert resp.get_json()['opened_date'] is not None

    def test_open_with_custom_date(self, client):
        coffee = make_coffee(client)
        resp = client.post(f'/api/coffees/{coffee["id"]}/open', json={'date': '2026-03-01'})
        assert resp.get_json()['opened_date'] == '2026-03-01'

    def test_open_invalid_date_returns_400(self, client):
        coffee = make_coffee(client)
        resp = client.post(f'/api/coffees/{coffee["id"]}/open', json={'date': 'not-a-date'})
        assert resp.status_code == 400

    def test_open_not_found(self, client):
        resp = client.post('/api/coffees/999/open')
        assert resp.status_code == 404


class TestFinishCoffee:
    def test_finish_sets_finished_date(self, client):
        coffee = make_coffee(client)
        resp = client.post(f'/api/coffees/{coffee["id"]}/finish')
        assert resp.status_code == 200
        assert resp.get_json()['finished_date'] is not None

    def test_finish_not_found(self, client):
        assert client.post('/api/coffees/999/finish').status_code == 404


class TestUnrateCoffee:
    def test_unrate_clears_rating(self, client):
        coffee = make_coffee(client, {'rating': 4})
        resp = client.post(f'/api/coffees/{coffee["id"]}/unrate')
        assert resp.status_code == 200
        assert resp.get_json()['rating'] is None

    def test_unrate_not_found(self, client):
        assert client.post('/api/coffees/999/unrate').status_code == 404


class TestSetRemaining:
    def test_set_valid_value(self, client):
        coffee = make_coffee(client, {'quantity_g': 250})
        resp = client.put(f'/api/coffees/{coffee["id"]}/remaining', json={'remaining_g': 100})
        assert resp.status_code == 200
        assert resp.get_json()['remaining_g'] == 100

    def test_set_zero_allowed(self, client):
        coffee = make_coffee(client)
        resp = client.put(f'/api/coffees/{coffee["id"]}/remaining', json={'remaining_g': 0})
        assert resp.status_code == 200

    def test_set_negative_returns_400(self, client):
        coffee = make_coffee(client)
        resp = client.put(f'/api/coffees/{coffee["id"]}/remaining', json={'remaining_g': -1})
        assert resp.status_code == 400

    def test_set_float_returns_400(self, client):
        coffee = make_coffee(client)
        resp = client.put(f'/api/coffees/{coffee["id"]}/remaining', json={'remaining_g': 100.5})
        assert resp.status_code == 400

    def test_set_not_found(self, client):
        resp = client.put('/api/coffees/999/remaining', json={'remaining_g': 100})
        assert resp.status_code == 404


class TestConsumeCoffee:
    def test_consume_decrements_by_grams_per_shot(self, client):
        coffee = make_coffee(client, {'quantity_g': 250})
        # remaining_g should be 250; default grams_per_shot is 17
        resp = client.post(f'/api/coffees/{coffee["id"]}/consume')
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['consumed_g'] == 17
        assert body['remaining_g'] == 233

    def test_consume_floors_at_zero(self, client):
        coffee = make_coffee(client, {'quantity_g': 10})
        resp = client.post(f'/api/coffees/{coffee["id"]}/consume')
        assert resp.get_json()['remaining_g'] == 0

    def test_consume_respects_custom_grams_per_shot(self, client):
        client.put('/api/settings', json={'grams_per_shot': 20})
        coffee = make_coffee(client, {'quantity_g': 250})
        resp = client.post(f'/api/coffees/{coffee["id"]}/consume')
        assert resp.get_json()['consumed_g'] == 20
        assert resp.get_json()['remaining_g'] == 230

    def test_consume_not_found(self, client):
        assert client.post('/api/coffees/999/consume').status_code == 404

    def test_consume_without_quantity_rejected(self, client):
        coffee = make_coffee(client, {'quantity_g': None})
        resp = client.post(f'/api/coffees/{coffee["id"]}/consume')
        assert resp.status_code == 409
        assert resp.get_json()['error_key'] == 'error.coffee.consume_no_stock'
        assert client.get(f'/api/coffees/{coffee["id"]}').get_json()['remaining_g'] is None
        assert client.get('/api/brews').get_json()['total'] == 0

    def test_consume_finished_rejected(self, client):
        coffee = make_coffee(client, {'quantity_g': 250})
        client.post(f'/api/coffees/{coffee["id"]}/finish')
        resp = client.post(f'/api/coffees/{coffee["id"]}/consume')
        assert resp.status_code == 409
        assert resp.get_json()['error_key'] == 'error.coffee.consume_finished'
        assert client.get(f'/api/coffees/{coffee["id"]}').get_json()['remaining_g'] == 250

    def test_consume_uses_client_date(self, client):
        coffee = make_coffee(client, {'quantity_g': 250})
        client.post(f'/api/coffees/{coffee["id"]}/consume', json={'date': '2026-03-04'})
        assert client.get('/api/brews').get_json()['brews'][0]['brew_date'] == '2026-03-04'

    def test_consume_invalid_date(self, client):
        coffee = make_coffee(client, {'quantity_g': 250})
        resp = client.post(f'/api/coffees/{coffee["id"]}/consume', json={'date': 'hoy'})
        assert resp.status_code == 400


class TestFinishDate:
    def test_finish_uses_client_date(self, client):
        coffee = make_coffee(client)
        body = client.post(f'/api/coffees/{coffee["id"]}/finish', json={'date': '2026-02-03'}).get_json()
        assert body['finished_date'] == '2026-02-03'

    def test_finish_invalid_date(self, client):
        coffee = make_coffee(client)
        assert client.post(f'/api/coffees/{coffee["id"]}/finish', json={'date': 'x'}).status_code == 400


class TestUpdateCoffeePartial:
    def test_partial_update_keeps_other_fields(self, client):
        coffee = make_coffee(client, {'varieties': ['Gesha'], 'notes': 'floral'})
        body = client.put(f'/api/coffees/{coffee["id"]}', json={'rating': 5}).get_json()
        assert body['rating'] == 5
        assert body['name'] == 'Test Coffee'
        assert body['roaster'] == 'Roaster A'
        assert body['varieties'] == ['Gesha']
        assert body['notes'] == 'floral'
        assert body['price_kg'] == 30.0

    def test_explicit_null_clears_field(self, client):
        coffee = make_coffee(client)
        body = client.put(f'/api/coffees/{coffee["id"]}', json={'roaster': None, 'varieties': []}).get_json()
        assert body['roaster'] is None
        assert body['varieties'] == []
        assert body['origin'] == 'Ethiopia'

    def test_empty_name_rejected(self, client):
        coffee = make_coffee(client)
        assert client.put(f'/api/coffees/{coffee["id"]}', json={'name': ''}).status_code == 400

    def test_update_not_found(self, client):
        assert client.put('/api/coffees/999', json={'name': 'X'}).status_code == 404
