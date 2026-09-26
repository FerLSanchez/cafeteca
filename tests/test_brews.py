"""Tests for recipes and brews endpoints."""
import pytest
from tests.helpers import make_coffee, make_brew


class TestListBrews:
    def test_empty_list(self, client):
        data = client.get('/api/brews').get_json()
        assert data['brews'] == []
        assert data['total'] == 0
        assert data['has_more'] is False

    def test_list_includes_coffee_names(self, client):
        coffee = make_coffee(client, {'name': 'Named Coffee'})
        make_brew(client, coffee['id'])
        resp = client.get('/api/brews')
        data = resp.get_json()['brews']
        assert len(data) == 1
        assert 'Named Coffee' in data[0]['coffees']

    def test_list_brew_structure(self, client):
        coffee = make_coffee(client)
        make_brew(client, coffee['id'])
        brew = client.get('/api/brews').get_json()['brews'][0]
        assert 'id' in brew
        assert 'brew_date' in brew
        assert 'coffees' in brew


class TestAddBrew:
    def test_add_brew_returns_201(self, client):
        coffee = make_coffee(client)
        resp = client.post(f'/api/coffees/{coffee["id"]}/brews', json={
            'dose_g': 18.0, 'yield_g': 36.0, 'grind': 15
        })
        assert resp.status_code == 201

    def test_add_brew_coffee_not_found(self, client):
        resp = client.post('/api/coffees/999/brews', json={})
        assert resp.status_code == 404

    def test_add_brew_with_valid_rating(self, client):
        coffee = make_coffee(client)
        resp = client.post(f'/api/coffees/{coffee["id"]}/brews', json={'rating': 4})
        assert resp.status_code == 201
        assert resp.get_json()['rating'] == 4

    def test_add_brew_invalid_rating_rejected(self, client):
        coffee = make_coffee(client)
        resp = client.post(f'/api/coffees/{coffee["id"]}/brews', json={'rating': 6})
        assert resp.status_code == 400
        assert resp.get_json()['error_key'] == 'error.model.rating_invalid'

    def test_add_brew_response_includes_fields(self, client):
        coffee = make_coffee(client)
        resp = client.post(f'/api/coffees/{coffee["id"]}/brews',
                                json={'dose_g': 18.0, 'yield_g': 36.0, 'grind': 20, 'temp_c': 93})
        body = resp.get_json()
        assert body['dose_g'] == 18.0
        assert body['yield_g'] == 36.0
        assert body['grind'] == 20
        assert body['temp_c'] == 93

    def test_add_brew_with_time_s(self, client):
        coffee = make_coffee(client)
        resp = client.post(f'/api/coffees/{coffee["id"]}/brews',
                                json={'dose_g': 18.0, 'yield_g': 36.0, 'time_s': 28})
        assert resp.status_code == 201
        assert resp.get_json()['time_s'] == 28


class TestAddBrewDeductsRemaining:
    def test_brew_deducts_dose_from_open_coffee(self, client):
        coffee = make_coffee(client, {'quantity_g': 250, 'opened_date': '2026-01-20'})
        client.post(f'/api/coffees/{coffee["id"]}/brews', json={'dose_g': 18.0})
        updated = client.get(f'/api/coffees/{coffee["id"]}').get_json()
        assert updated['remaining_g'] == 232  # 250 - 18

    def test_brew_response_includes_remaining_g_when_deducted(self, client):
        coffee = make_coffee(client, {'quantity_g': 250, 'opened_date': '2026-01-20'})
        resp = client.post(f'/api/coffees/{coffee["id"]}/brews', json={'dose_g': 20.0})
        assert resp.get_json()['remaining_g'] == 230

    def test_brew_without_dose_does_not_change_remaining(self, client):
        coffee = make_coffee(client, {'quantity_g': 250, 'opened_date': '2026-01-20'})
        client.post(f'/api/coffees/{coffee["id"]}/brews', json={})
        updated = client.get(f'/api/coffees/{coffee["id"]}').get_json()
        assert updated['remaining_g'] == 250

    def test_brew_on_pending_coffee_does_not_deduct(self, client):
        coffee = make_coffee(client, {'quantity_g': 250})  # no opened_date
        client.post(f'/api/coffees/{coffee["id"]}/brews', json={'dose_g': 18.0})
        updated = client.get(f'/api/coffees/{coffee["id"]}').get_json()
        assert updated['remaining_g'] == 250

    def test_brew_on_finished_coffee_does_not_deduct(self, client):
        coffee = make_coffee(client, {
            'quantity_g': 250, 'opened_date': '2026-01-20', 'finished_date': '2026-02-01'
        })
        before = client.get(f'/api/coffees/{coffee["id"]}').get_json()['remaining_g']
        client.post(f'/api/coffees/{coffee["id"]}/brews', json={'dose_g': 18.0})
        updated = client.get(f'/api/coffees/{coffee["id"]}').get_json()
        assert updated['remaining_g'] == before

    def test_brew_deduction_floors_at_zero(self, client):
        coffee = make_coffee(client, {
            'quantity_g': 250, 'remaining_g': 10, 'opened_date': '2026-01-20'
        })
        client.post(f'/api/coffees/{coffee["id"]}/brews', json={'dose_g': 50.0})
        updated = client.get(f'/api/coffees/{coffee["id"]}').get_json()
        assert updated['remaining_g'] == 0

    def test_brew_response_has_no_remaining_g_when_not_deducted(self, client):
        coffee = make_coffee(client)  # pending, no opened_date
        resp = client.post(f'/api/coffees/{coffee["id"]}/brews', json={'dose_g': 18.0})
        assert 'remaining_g' not in resp.get_json()


class TestListCoffeeBrews:
    def test_coffee_not_found(self, client):
        assert client.get('/api/coffees/999/brews').status_code == 404

    def test_empty_list(self, client):
        coffee = make_coffee(client)
        resp = client.get(f'/api/coffees/{coffee["id"]}/brews')
        assert resp.status_code == 200
        assert resp.get_json() == []

    def test_lists_brews_for_coffee(self, client):
        coffee = make_coffee(client)
        make_brew(client, coffee['id'])
        make_brew(client, coffee['id'])
        resp = client.get(f'/api/coffees/{coffee["id"]}/brews')
        assert len(resp.get_json()) == 2

    def test_brews_isolated_between_coffees(self, client):
        coffee1 = make_coffee(client, {'name': 'Coffee 1'})
        coffee2 = make_coffee(client, {'name': 'Coffee 2'})
        make_brew(client, coffee1['id'])
        resp = client.get(f'/api/coffees/{coffee2["id"]}/brews')
        assert resp.get_json() == []


class TestDeleteBrew:
    def test_delete_not_found(self, client):
        assert client.delete('/api/brews/999').status_code == 404

    def test_delete_brew(self, client):
        coffee = make_coffee(client)
        brew = make_brew(client, coffee['id'])
        resp = client.delete(f'/api/brews/{brew["id"]}')
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

    def test_deleted_brew_not_in_list(self, client):
        coffee = make_coffee(client)
        brew = make_brew(client, coffee['id'])
        client.delete(f'/api/brews/{brew["id"]}')
        assert client.get(f'/api/coffees/{coffee["id"]}/brews').get_json() == []

    def test_delete_brew_purges_brews_table(self, client, db):
        """Deleting a brew should also remove the row from the brews table."""
        coffee = make_coffee(client)
        brew = make_brew(client, coffee['id'])
        count_before = db.execute('SELECT COUNT(*) FROM brews').fetchone()[0]
        assert count_before == 1
        client.delete(f'/api/brews/{brew["id"]}')
        count_after = db.execute('SELECT COUNT(*) FROM brews').fetchone()[0]
        assert count_after == 0


class TestRecipe:
    def test_get_recipe_coffee_not_found(self, client):
        assert client.get('/api/coffees/999/recipe').status_code == 404

    def test_get_recipe_not_set_returns_404(self, client):
        coffee = make_coffee(client)
        resp = client.get(f'/api/coffees/{coffee["id"]}/recipe')
        assert resp.status_code == 404

    def test_upsert_recipe_create(self, client):
        coffee = make_coffee(client)
        resp = client.put(f'/api/coffees/{coffee["id"]}/recipe',
                               json={'dose_g': 18.0, 'yield_g': 36.0, 'grind': 15, 'temp_c': 93})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['dose_g'] == 18.0
        assert body['yield_g'] == 36.0

    def test_upsert_recipe_coffee_not_found(self, client):
        resp = client.put('/api/coffees/999/recipe', json={'dose_g': 18.0})
        assert resp.status_code == 404

    def test_upsert_recipe_with_time_s(self, client):
        coffee = make_coffee(client)
        resp = client.put(f'/api/coffees/{coffee["id"]}/recipe',
                               json={'dose_g': 18.0, 'yield_g': 36.0, 'time_s': 28})
        assert resp.status_code == 200
        assert resp.get_json()['time_s'] == 28

    def test_upsert_recipe_updates_existing(self, client, db):
        """Two PUT calls should result in exactly one recipe row."""
        coffee = make_coffee(client)
        client.put(f'/api/coffees/{coffee["id"]}/recipe', json={'dose_g': 18.0})
        client.put(f'/api/coffees/{coffee["id"]}/recipe', json={'dose_g': 20.0})
        count = db.execute('SELECT COUNT(*) FROM recipes').fetchone()[0]
        assert count == 1
        row = db.execute('SELECT dose_g FROM recipes').fetchone()
        assert row[0] == 20.0

    def test_get_recipe_after_upsert(self, client):
        coffee = make_coffee(client)
        client.put(f'/api/coffees/{coffee["id"]}/recipe',
                        json={'dose_g': 18.0, 'yield_g': 36.0, 'grind': 15})
        resp = client.get(f'/api/coffees/{coffee["id"]}/recipe')
        assert resp.status_code == 200
        assert resp.get_json()['dose_g'] == 18.0

    def test_delete_recipe(self, client):
        coffee = make_coffee(client)
        client.put(f'/api/coffees/{coffee["id"]}/recipe', json={'dose_g': 18.0})
        resp = client.delete(f'/api/coffees/{coffee["id"]}/recipe')
        assert resp.status_code == 200
        # Should now return 404
        assert client.get(f'/api/coffees/{coffee["id"]}/recipe').status_code == 404

    def test_delete_recipe_purges_recipe_row(self, client, db):
        coffee = make_coffee(client)
        client.put(f'/api/coffees/{coffee["id"]}/recipe', json={'dose_g': 18.0})
        count_before = db.execute('SELECT COUNT(*) FROM recipes').fetchone()[0]
        assert count_before == 1
        client.delete(f'/api/coffees/{coffee["id"]}/recipe')
        count_after = db.execute('SELECT COUNT(*) FROM recipes').fetchone()[0]
        assert count_after == 0

    def test_delete_coffee_purges_recipe(self, client, db):
        coffee = make_coffee(client)
        client.put(f'/api/coffees/{coffee["id"]}/recipe', json={'dose_g': 18.0})
        client.delete(f'/api/coffees/{coffee["id"]}')
        count = db.execute('SELECT COUNT(*) FROM recipes').fetchone()[0]
        assert count == 0

class TestBrewValidation:
    @pytest.mark.parametrize('payload', [
        {'dose_g': '18'}, {'dose_g': -1}, {'yield_g': True}, {'time_s': 12.5},
        {'grind': 'fine'}, {'temp_c': 500}, {'brew_date': '25/09/2026'},
    ])
    def test_add_brew_rejects_invalid(self, client, payload):
        coffee = make_coffee(client)
        resp = client.post(f'/api/coffees/{coffee["id"]}/brews', json=payload)
        assert resp.status_code == 400
        assert resp.get_json()['error_key'].startswith('error.')

    def test_recipe_rejects_invalid(self, client):
        coffee = make_coffee(client)
        resp = client.put(f'/api/coffees/{coffee["id"]}/recipe', json={'dose_g': 'x'})
        assert resp.status_code == 400
        assert resp.get_json()['error_key'] == 'error.brew.field_invalid'

    def test_update_brew_rejects_invalid(self, client):
        coffee = make_coffee(client)
        brew = make_brew(client, coffee['id'])
        resp = client.put(f'/api/brews/{brew["id"]}', json={'dose_g': 'x'})
        assert resp.status_code == 400


class TestUpdateBrewPartial:
    def test_partial_update_keeps_other_fields(self, client):
        coffee = make_coffee(client)
        brew = make_brew(client, coffee['id'], {'brew_date': '2026-09-01', 'notes': 'ok'})
        resp = client.put(f'/api/brews/{brew["id"]}', json={'rating': 4})
        body = resp.get_json()
        assert resp.status_code == 200
        assert body['rating'] == 4
        assert body['brew_date'] == '2026-09-01'
        assert body['dose_g'] == 18.0
        assert body['notes'] == 'ok'

    def test_explicit_null_clears_field(self, client):
        coffee = make_coffee(client)
        brew = make_brew(client, coffee['id'])
        body = client.put(f'/api/brews/{brew["id"]}', json={'grind': None}).get_json()
        assert body['grind'] is None
        assert body['dose_g'] == 18.0

    def test_empty_brew_date_rejected(self, client):
        coffee = make_coffee(client)
        brew = make_brew(client, coffee['id'])
        assert client.put(f'/api/brews/{brew["id"]}', json={'brew_date': None}).status_code == 400

    def test_update_not_found(self, client):
        assert client.put('/api/brews/999', json={'rating': 3}).status_code == 404


class TestDeleteRecipeNotFound:
    def test_delete_recipe_unknown_coffee(self, client):
        assert client.delete('/api/coffees/999/recipe').status_code == 404


METRICS = {'main_flow': 1.73, 'avg_flow': 1.38, 'peak_flow': 2.2, 't_peak_s': 21.7,
           't_ramp_s': 6.7, 'overshoot_s': 9.7, 'in_band_pct': 33, 'flow_cv': 0.16,
           'tail_s': 4.4, 'tail_g': 0.6, 'irregular': True, 'target_flow': 1.5}


class TestShotMetrics:
    def test_brew_stores_and_returns_metrics(self, client):
        coffee = make_coffee(client)
        brew = make_brew(client, coffee['id'], {'shot_metrics': METRICS})
        assert brew['shot_metrics'] == METRICS
        listed = client.get(f'/api/coffees/{coffee["id"]}/brews').get_json()[0]
        assert listed['shot_metrics'] == METRICS
        assert client.get('/api/brews').get_json()['brews'][0]['shot_metrics'] == METRICS

    def test_brew_without_metrics_returns_null(self, client):
        coffee = make_coffee(client)
        assert make_brew(client, coffee['id'])['shot_metrics'] is None

    def test_put_null_clears_metrics(self, client):
        coffee = make_coffee(client)
        brew = make_brew(client, coffee['id'], {'shot_metrics': METRICS})
        resp = client.put(f'/api/brews/{brew["id"]}', json={'shot_metrics': None})
        assert resp.get_json()['shot_metrics'] is None

    def test_put_without_key_keeps_metrics(self, client):
        coffee = make_coffee(client)
        brew = make_brew(client, coffee['id'], {'shot_metrics': METRICS})
        resp = client.put(f'/api/brews/{brew["id"]}', json={'rating': 4})
        assert resp.get_json()['shot_metrics'] == METRICS

    @pytest.mark.parametrize('bad', [
        'x', [], {}, {'unknown': 1}, {'main_flow': 'fast'}, {'irregular': 1}, {'main_flow': True},
    ])
    def test_invalid_metrics_400(self, client, bad):
        coffee = make_coffee(client)
        resp = client.post(f'/api/coffees/{coffee["id"]}/brews', json={'shot_metrics': bad})
        assert resp.status_code == 400
        assert resp.get_json()['error_key'] == 'error.brew.shot_metrics_invalid'


class TestRecipeTargetFlow:
    def test_target_flow_roundtrip(self, client):
        coffee = make_coffee(client)
        resp = client.put(f'/api/coffees/{coffee["id"]}/recipe', json={'dose_g': 17, 'target_flow': 1.5})
        assert resp.get_json()['target_flow'] == 1.5
        assert client.get(f'/api/coffees/{coffee["id"]}/recipe').get_json()['target_flow'] == 1.5

    @pytest.mark.parametrize('bad', [0, 11, 'x', True])
    def test_target_flow_invalid(self, client, bad):
        coffee = make_coffee(client)
        resp = client.put(f'/api/coffees/{coffee["id"]}/recipe', json={'target_flow': bad})
        assert resp.status_code == 400
        assert resp.get_json()['error_key_params']['field'] == 'target_flow'


CURVE = {'v': 1, 'time_ms': 27800, 'pts': [[1.1, 1.8], [1.2, 2.0], [27.8, 38.5]]}


class TestShotCurve:
    def test_roundtrip_and_clear(self, client):
        coffee = make_coffee(client)
        brew = make_brew(client, coffee['id'], {'shot_curve': CURVE})
        assert brew['shot_curve'] == CURVE
        assert client.get(f'/api/coffees/{coffee["id"]}/brews').get_json()[0]['shot_curve'] == CURVE
        assert client.get('/api/brews').get_json()['brews'][0]['shot_curve'] == CURVE
        resp = client.put(f'/api/brews/{brew["id"]}', json={'shot_curve': None})
        assert resp.get_json()['shot_curve'] is None

    @pytest.mark.parametrize('bad', [
        [], {'v': 2, 'pts': [[0, 0]]}, {'v': 1, 'pts': []}, {'v': 1, 'pts': [[0]]},
        {'v': 1, 'pts': [['a', 1]]}, {'v': 1, 'pts': [[0, 0]], 'extra': 1},
        {'v': 1, 'time_ms': 1.5, 'pts': [[0, 0]]}, {'v': 1, 'pts': [[0, 0]] * 2001},
    ])
    def test_invalid_curve_400(self, client, bad):
        coffee = make_coffee(client)
        resp = client.post(f'/api/coffees/{coffee["id"]}/brews', json={'shot_curve': bad})
        assert resp.status_code == 400
        assert resp.get_json()['error_key'] == 'error.brew.shot_curve_invalid'
