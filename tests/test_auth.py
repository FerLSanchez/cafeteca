"""Tests for authentication endpoints: /api/auth/status, login, change-pin."""
import pytest
from tests.helpers import make_coffee


# ---------------------------------------------------------------------------
# /api/auth/status
# ---------------------------------------------------------------------------
class TestAuthStatus:
    def test_unauthenticated_returns_false(self, client):
        resp = client.get('/api/auth/status')
        assert resp.status_code == 200
        assert resp.get_json()['authenticated'] is False

    def test_authenticated_returns_true(self, auth_client):
        resp = auth_client.get('/api/auth/status')
        assert resp.status_code == 200
        assert resp.get_json()['authenticated'] is True


# ---------------------------------------------------------------------------
# /api/auth/login
# ---------------------------------------------------------------------------
class TestLogin:
    def test_correct_pin_returns_ok(self, client, monkeypatch):
        monkeypatch.setattr('blueprints.auth.time.sleep', lambda s: None)
        resp = client.post('/api/auth/login', json={'pin': '1111'})
        assert resp.status_code == 200
        assert resp.get_json().get('ok') is True

    def test_correct_pin_sets_session(self, client, monkeypatch):
        monkeypatch.setattr('blueprints.auth.time.sleep', lambda s: None)
        client.post('/api/auth/login', json={'pin': '1111'})
        resp = client.get('/api/auth/status')
        assert resp.get_json()['authenticated'] is True

    def test_wrong_pin_returns_401(self, client, monkeypatch):
        monkeypatch.setattr('blueprints.auth.time.sleep', lambda s: None)
        resp = client.post('/api/auth/login', json={'pin': '9999'})
        assert resp.status_code == 401

    def test_wrong_pin_does_not_set_session(self, client, monkeypatch):
        monkeypatch.setattr('blueprints.auth.time.sleep', lambda s: None)
        client.post('/api/auth/login', json={'pin': '9999'})
        resp = client.get('/api/auth/status')
        assert resp.get_json()['authenticated'] is False

    def test_empty_body_returns_401(self, client, monkeypatch):
        monkeypatch.setattr('blueprints.auth.time.sleep', lambda s: None)
        resp = client.post('/api/auth/login', json={})
        assert resp.status_code == 401

    def test_missing_json_returns_401(self, client, monkeypatch):
        monkeypatch.setattr('blueprints.auth.time.sleep', lambda s: None)
        resp = client.post('/api/auth/login', data='')
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# /api/auth/change-pin
# ---------------------------------------------------------------------------
class TestChangePin:
    def test_requires_auth(self, client):
        resp = client.post('/api/auth/change-pin',
                           json={'current_pin': '1111', 'new_pin': '2222'})
        assert resp.status_code == 401

    def test_wrong_current_pin(self, auth_client):
        resp = auth_client.post('/api/auth/change-pin',
                                json={'current_pin': '0000', 'new_pin': '2222'})
        assert resp.status_code == 401

    def test_new_pin_not_4_digits(self, auth_client):
        resp = auth_client.post('/api/auth/change-pin',
                                json={'current_pin': '1111', 'new_pin': '123'})
        assert resp.status_code == 400

    def test_new_pin_non_digits(self, auth_client):
        resp = auth_client.post('/api/auth/change-pin',
                                json={'current_pin': '1111', 'new_pin': 'abcd'})
        assert resp.status_code == 400

    def test_new_pin_5_digits(self, auth_client):
        resp = auth_client.post('/api/auth/change-pin',
                                json={'current_pin': '1111', 'new_pin': '12345'})
        assert resp.status_code == 400

    def test_change_pin_success(self, client, auth_client, monkeypatch):
        monkeypatch.setattr('blueprints.auth.time.sleep', lambda s: None)
        # Change PIN from 1111 to 2222
        resp = auth_client.post('/api/auth/change-pin',
                                json={'current_pin': '1111', 'new_pin': '2222'})
        assert resp.status_code == 200

        # Old PIN no longer works
        resp = client.post('/api/auth/login', json={'pin': '1111'})
        assert resp.status_code == 401

        # New PIN works
        resp = client.post('/api/auth/login', json={'pin': '2222'})
        assert resp.status_code == 200

    def test_missing_fields_returns_400(self, auth_client):
        resp = auth_client.post('/api/auth/change-pin', json={})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Protected endpoints reject unauthenticated requests
# ---------------------------------------------------------------------------
@pytest.mark.auth
class TestProtectedEndpoints:
    def test_coffees_requires_auth(self, client):
        assert client.get('/api/coffees').status_code == 401

    def test_stats_requires_auth(self, client):
        assert client.get('/api/stats').status_code == 401

    def test_settings_requires_auth(self, client):
        assert client.get('/api/settings').status_code == 401

    def test_options_requires_auth(self, client):
        assert client.get('/api/options').status_code == 401

    def test_lookup_requires_auth(self, client):
        assert client.get('/api/lookup/roasters').status_code == 401
