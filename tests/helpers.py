"""Test data factories."""

DEFAULT_COFFEE = {
    'name': 'Test Coffee',
    'quantity_g': 250,
    'price_kg': 30.0,
    'roaster': 'Roaster A',
    'origin': 'Ethiopia',
    'rating': 4,
    'purchase_date': '2026-01-15',
}


def make_coffee(client, overrides=None):
    """POST a coffee and return the response JSON. Asserts 201."""
    data = {**DEFAULT_COFFEE, **(overrides or {})}
    resp = client.post('/api/coffees', json=data)
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


def make_brew(client, cid, overrides=None):
    """POST a brew for a coffee and return the response JSON. Asserts 201."""
    data = {'dose_g': 18.0, 'yield_g': 36.0, 'grind': 15, **(overrides or {})}
    resp = client.post(f'/api/coffees/{cid}/brews', json=data)
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()
