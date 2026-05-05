"""Tests for recipes and brews endpoints."""
import pytest
from tests.helpers import make_coffee, make_brew


class TestListBrews:
    def test_requires_auth(self, client):
        assert client.get('/api/brews').status_code == 401

    def test_empty_list(self, auth_client):
        data = auth_client.get('/api/brews').get_json()
        assert data['brews'] == []
        assert data['total'] == 0
        assert data['has_more'] is False

    def test_list_includes_coffee_names(self, auth_client):
        coffee = make_coffee(auth_client, {'name': 'Named Coffee'})
        make_brew(auth_client, coffee['id'])
        resp = auth_client.get('/api/brews')
        data = resp.get_json()['brews']
        assert len(data) == 1
        assert 'Named Coffee' in data[0]['coffees']

    def test_list_brew_structure(self, auth_client):
        coffee = make_coffee(auth_client)
        make_brew(auth_client, coffee['id'])
        brew = auth_client.get('/api/brews').get_json()['brews'][0]
        assert 'id' in brew
        assert 'brew_date' in brew
        assert 'coffees' in brew


class TestAddBrew:
    def test_requires_auth(self, client):
        assert client.post('/api/coffees/1/brews', json={}).status_code == 401

    def test_add_brew_returns_201(self, auth_client):
        coffee = make_coffee(auth_client)
        resp = auth_client.post(f'/api/coffees/{coffee["id"]}/brews', json={
            'dose_g': 18.0, 'yield_g': 36.0, 'grind': 15
        })
        assert resp.status_code == 201

    def test_add_brew_coffee_not_found(self, auth_client):
        resp = auth_client.post('/api/coffees/999/brews', json={})
        assert resp.status_code == 404

    def test_add_brew_with_valid_rating(self, auth_client):
        coffee = make_coffee(auth_client)
        resp = auth_client.post(f'/api/coffees/{coffee["id"]}/brews', json={'rating': 4})
        assert resp.status_code == 201
        assert resp.get_json()['rating'] == 4

    def test_add_brew_invalid_rating_stored_as_none(self, auth_client):
        """Rating out of range should be silently set to None."""
        coffee = make_coffee(auth_client)
        resp = auth_client.post(f'/api/coffees/{coffee["id"]}/brews', json={'rating': 6})
        assert resp.status_code == 201
        assert resp.get_json()['rating'] is None

    def test_add_brew_response_includes_fields(self, auth_client):
        coffee = make_coffee(auth_client)
        resp = auth_client.post(f'/api/coffees/{coffee["id"]}/brews',
                                json={'dose_g': 18.0, 'yield_g': 36.0, 'grind': 20, 'temp_c': 93})
        body = resp.get_json()
        assert body['dose_g'] == 18.0
        assert body['yield_g'] == 36.0
        assert body['grind'] == 20
        assert body['temp_c'] == 93

    def test_add_brew_with_time_s(self, auth_client):
        coffee = make_coffee(auth_client)
        resp = auth_client.post(f'/api/coffees/{coffee["id"]}/brews',
                                json={'dose_g': 18.0, 'yield_g': 36.0, 'time_s': 28})
        assert resp.status_code == 201
        assert resp.get_json()['time_s'] == 28


class TestAddBrewDeductsRemaining:
    def test_brew_deducts_dose_from_open_coffee(self, auth_client):
        coffee = make_coffee(auth_client, {'quantity_g': 250, 'opened_date': '2026-01-20'})
        auth_client.post(f'/api/coffees/{coffee["id"]}/brews', json={'dose_g': 18.0})
        updated = auth_client.get(f'/api/coffees/{coffee["id"]}').get_json()
        assert updated['remaining_g'] == 232  # 250 - 18

    def test_brew_response_includes_remaining_g_when_deducted(self, auth_client):
        coffee = make_coffee(auth_client, {'quantity_g': 250, 'opened_date': '2026-01-20'})
        resp = auth_client.post(f'/api/coffees/{coffee["id"]}/brews', json={'dose_g': 20.0})
        assert resp.get_json()['remaining_g'] == 230

    def test_brew_without_dose_does_not_change_remaining(self, auth_client):
        coffee = make_coffee(auth_client, {'quantity_g': 250, 'opened_date': '2026-01-20'})
        auth_client.post(f'/api/coffees/{coffee["id"]}/brews', json={})
        updated = auth_client.get(f'/api/coffees/{coffee["id"]}').get_json()
        assert updated['remaining_g'] == 250

    def test_brew_on_pending_coffee_does_not_deduct(self, auth_client):
        coffee = make_coffee(auth_client, {'quantity_g': 250})  # no opened_date
        auth_client.post(f'/api/coffees/{coffee["id"]}/brews', json={'dose_g': 18.0})
        updated = auth_client.get(f'/api/coffees/{coffee["id"]}').get_json()
        assert updated['remaining_g'] == 250

    def test_brew_on_finished_coffee_does_not_deduct(self, auth_client):
        coffee = make_coffee(auth_client, {
            'quantity_g': 250, 'opened_date': '2026-01-20', 'finished_date': '2026-02-01'
        })
        before = auth_client.get(f'/api/coffees/{coffee["id"]}').get_json()['remaining_g']
        auth_client.post(f'/api/coffees/{coffee["id"]}/brews', json={'dose_g': 18.0})
        updated = auth_client.get(f'/api/coffees/{coffee["id"]}').get_json()
        assert updated['remaining_g'] == before

    def test_brew_deduction_floors_at_zero(self, auth_client):
        coffee = make_coffee(auth_client, {
            'quantity_g': 250, 'remaining_g': 10, 'opened_date': '2026-01-20'
        })
        auth_client.post(f'/api/coffees/{coffee["id"]}/brews', json={'dose_g': 50.0})
        updated = auth_client.get(f'/api/coffees/{coffee["id"]}').get_json()
        assert updated['remaining_g'] == 0

    def test_brew_response_has_no_remaining_g_when_not_deducted(self, auth_client):
        coffee = make_coffee(auth_client)  # pending, no opened_date
        resp = auth_client.post(f'/api/coffees/{coffee["id"]}/brews', json={'dose_g': 18.0})
        assert 'remaining_g' not in resp.get_json()


class TestListCoffeeBrews:
    def test_requires_auth(self, client):
        assert client.get('/api/coffees/1/brews').status_code == 401

    def test_coffee_not_found(self, auth_client):
        assert auth_client.get('/api/coffees/999/brews').status_code == 404

    def test_empty_list(self, auth_client):
        coffee = make_coffee(auth_client)
        resp = auth_client.get(f'/api/coffees/{coffee["id"]}/brews')
        assert resp.status_code == 200
        assert resp.get_json() == []

    def test_lists_brews_for_coffee(self, auth_client):
        coffee = make_coffee(auth_client)
        make_brew(auth_client, coffee['id'])
        make_brew(auth_client, coffee['id'])
        resp = auth_client.get(f'/api/coffees/{coffee["id"]}/brews')
        assert len(resp.get_json()) == 2

    def test_brews_isolated_between_coffees(self, auth_client):
        coffee1 = make_coffee(auth_client, {'name': 'Coffee 1'})
        coffee2 = make_coffee(auth_client, {'name': 'Coffee 2'})
        make_brew(auth_client, coffee1['id'])
        resp = auth_client.get(f'/api/coffees/{coffee2["id"]}/brews')
        assert resp.get_json() == []


class TestDeleteBrew:
    def test_requires_auth(self, client):
        assert client.delete('/api/brews/1').status_code == 401

    def test_delete_not_found(self, auth_client):
        assert auth_client.delete('/api/brews/999').status_code == 404

    def test_delete_brew(self, auth_client):
        coffee = make_coffee(auth_client)
        brew = make_brew(auth_client, coffee['id'])
        resp = auth_client.delete(f'/api/brews/{brew["id"]}')
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

    def test_deleted_brew_not_in_list(self, auth_client):
        coffee = make_coffee(auth_client)
        brew = make_brew(auth_client, coffee['id'])
        auth_client.delete(f'/api/brews/{brew["id"]}')
        assert auth_client.get(f'/api/coffees/{coffee["id"]}/brews').get_json() == []

    def test_delete_brew_purges_brews_table(self, auth_client, db):
        """Deleting a brew should also remove the row from the brews table."""
        coffee = make_coffee(auth_client)
        brew = make_brew(auth_client, coffee['id'])
        count_before = db.execute('SELECT COUNT(*) FROM brews').fetchone()[0]
        assert count_before == 1
        auth_client.delete(f'/api/brews/{brew["id"]}')
        count_after = db.execute('SELECT COUNT(*) FROM brews').fetchone()[0]
        assert count_after == 0


class TestRecipe:
    def test_get_recipe_requires_auth(self, client):
        assert client.get('/api/coffees/1/recipe').status_code == 401

    def test_get_recipe_coffee_not_found(self, auth_client):
        assert auth_client.get('/api/coffees/999/recipe').status_code == 404

    def test_get_recipe_not_set_returns_404(self, auth_client):
        coffee = make_coffee(auth_client)
        resp = auth_client.get(f'/api/coffees/{coffee["id"]}/recipe')
        assert resp.status_code == 404

    def test_upsert_recipe_create(self, auth_client):
        coffee = make_coffee(auth_client)
        resp = auth_client.put(f'/api/coffees/{coffee["id"]}/recipe',
                               json={'dose_g': 18.0, 'yield_g': 36.0, 'grind': 15, 'temp_c': 93})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['dose_g'] == 18.0
        assert body['yield_g'] == 36.0

    def test_upsert_recipe_coffee_not_found(self, auth_client):
        resp = auth_client.put('/api/coffees/999/recipe', json={'dose_g': 18.0})
        assert resp.status_code == 404

    def test_upsert_recipe_with_time_s(self, auth_client):
        coffee = make_coffee(auth_client)
        resp = auth_client.put(f'/api/coffees/{coffee["id"]}/recipe',
                               json={'dose_g': 18.0, 'yield_g': 36.0, 'time_s': 28})
        assert resp.status_code == 200
        assert resp.get_json()['time_s'] == 28

    def test_upsert_recipe_updates_existing(self, auth_client, db):
        """Two PUT calls should result in exactly one recipe row."""
        coffee = make_coffee(auth_client)
        auth_client.put(f'/api/coffees/{coffee["id"]}/recipe', json={'dose_g': 18.0})
        auth_client.put(f'/api/coffees/{coffee["id"]}/recipe', json={'dose_g': 20.0})
        count = db.execute('SELECT COUNT(*) FROM recipes').fetchone()[0]
        assert count == 1
        row = db.execute('SELECT dose_g FROM recipes').fetchone()
        assert row[0] == 20.0

    def test_get_recipe_after_upsert(self, auth_client):
        coffee = make_coffee(auth_client)
        auth_client.put(f'/api/coffees/{coffee["id"]}/recipe',
                        json={'dose_g': 18.0, 'yield_g': 36.0, 'grind': 15})
        resp = auth_client.get(f'/api/coffees/{coffee["id"]}/recipe')
        assert resp.status_code == 200
        assert resp.get_json()['dose_g'] == 18.0

    def test_delete_recipe(self, auth_client):
        coffee = make_coffee(auth_client)
        auth_client.put(f'/api/coffees/{coffee["id"]}/recipe', json={'dose_g': 18.0})
        resp = auth_client.delete(f'/api/coffees/{coffee["id"]}/recipe')
        assert resp.status_code == 200
        # Should now return 404
        assert auth_client.get(f'/api/coffees/{coffee["id"]}/recipe').status_code == 404

    def test_delete_recipe_purges_recipe_row(self, auth_client, db):
        coffee = make_coffee(auth_client)
        auth_client.put(f'/api/coffees/{coffee["id"]}/recipe', json={'dose_g': 18.0})
        count_before = db.execute('SELECT COUNT(*) FROM recipes').fetchone()[0]
        assert count_before == 1
        auth_client.delete(f'/api/coffees/{coffee["id"]}/recipe')
        count_after = db.execute('SELECT COUNT(*) FROM recipes').fetchone()[0]
        assert count_after == 0

    def test_delete_coffee_purges_recipe(self, auth_client, db):
        coffee = make_coffee(auth_client)
        auth_client.put(f'/api/coffees/{coffee["id"]}/recipe', json={'dose_g': 18.0})
        auth_client.delete(f'/api/coffees/{coffee["id"]}')
        count = db.execute('SELECT COUNT(*) FROM recipes').fetchone()[0]
        assert count == 0

    def test_upsert_requires_auth(self, client):
        assert client.put('/api/coffees/1/recipe', json={}).status_code == 401

    def test_delete_recipe_requires_auth(self, client):
        assert client.delete('/api/coffees/1/recipe').status_code == 401
