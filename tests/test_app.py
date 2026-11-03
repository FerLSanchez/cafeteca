"""Tests for app-level delivery: security headers."""


def test_csp_serves_fonts_from_self_only(client):
    csp = client.get('/').headers['Content-Security-Policy']
    assert "font-src 'self'" in csp
    assert 'googleapis' not in csp and 'gstatic' not in csp
