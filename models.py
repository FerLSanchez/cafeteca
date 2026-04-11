import re
from lookup_config import get_or_create

DATE_RE = re.compile(r'^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$')

SCALAR_FIELDS = ['name', 'quantity_g', 'price_kg', 'purchase_date', 'roast_date',
                 'opened_date', 'finished_date', 'rating', 'notes', 'altitude']

COFFEE_SELECT = '''
    SELECT c.id, c.name, c.quantity_g, c.remaining_g, c.price_kg, c.altitude,
           c.purchase_date, c.roast_date, c.opened_date, c.finished_date,
           c.rating, c.notes, c.created_at,
           c.roaster_id,  ro.name AS roaster,
           c.producer_id, p.name  AS producer,
           c.origin_id,   o.name  AS origin,
           c.region_id,   rg.name AS region,
           c.shop_id,     s.name  AS shop,
           (SELECT GROUP_CONCAT(v.name, '|||')
            FROM coffee_varieties cv JOIN varieties v ON cv.variety_id=v.id
            WHERE cv.coffee_id=c.id) AS varieties_str,
           (SELECT GROUP_CONCAT(v.id)
            FROM coffee_varieties cv JOIN varieties v ON cv.variety_id=v.id
            WHERE cv.coffee_id=c.id) AS variety_ids_str,
           (SELECT GROUP_CONCAT(pr.name, '|||')
            FROM coffee_processes cp JOIN processes pr ON cp.process_id=pr.id
            WHERE cp.coffee_id=c.id) AS processes_str,
           (SELECT GROUP_CONCAT(pr.id)
            FROM coffee_processes cp JOIN processes pr ON cp.process_id=pr.id
            WHERE cp.coffee_id=c.id) AS process_ids_str,
           (SELECT GROUP_CONCAT(mt.name, '|||')
            FROM coffee_milk_types cmt JOIN milk_types mt ON cmt.milk_type_id=mt.id
            WHERE cmt.coffee_id=c.id) AS milk_types_str,
           (SELECT GROUP_CONCAT(mt.id)
            FROM coffee_milk_types cmt JOIN milk_types mt ON cmt.milk_type_id=mt.id
            WHERE cmt.coffee_id=c.id) AS milk_type_ids_str
    FROM coffees c
    LEFT JOIN roasters  ro ON c.roaster_id  = ro.id
    LEFT JOIN producers p  ON c.producer_id = p.id
    LEFT JOIN origins   o  ON c.origin_id   = o.id
    LEFT JOIN regions   rg ON c.region_id   = rg.id
    LEFT JOIN shops     s  ON c.shop_id     = s.id
'''


def row_to_coffee(row):
    d = dict(row)
    vs  = d.pop('varieties_str')    or ''
    vis = d.pop('variety_ids_str')  or ''
    ps  = d.pop('processes_str')    or ''
    pis = d.pop('process_ids_str')  or ''
    mts = d.pop('milk_types_str')   or ''
    mtis= d.pop('milk_type_ids_str')or ''
    d['varieties']    = [v for v in vs.split('|||')   if v]
    d['variety_ids']  = [int(i) for i in vis.split(',')  if i]
    d['processes']    = [p for p in ps.split('|||')   if p]
    d['process_ids']  = [int(i) for i in pis.split(',')  if i]
    d['milk_types']   = [m for m in mts.split('|||')  if m]
    d['milk_type_ids']= [int(i) for i in mtis.split(',') if i]
    return d


def set_m2m(conn, coffee_id, values, lookup_table, junction_table, fk_col):
    """Replace all m2m relations for a coffee with the given list of names."""
    conn.execute(f'DELETE FROM {junction_table} WHERE coffee_id=?', (coffee_id,))
    if not values:
        return
    if isinstance(values, str):
        values = [v.strip() for v in values.split(',') if v.strip()]
    for name in values:
        ref_id = get_or_create(conn, lookup_table, name)
        if ref_id:
            conn.execute(
                f'INSERT OR IGNORE INTO {junction_table} (coffee_id, {fk_col}) VALUES (?,?)',
                (coffee_id, ref_id)
            )


def resolve_ids(conn, data):
    origin_id = get_or_create(conn, 'origins', data.get('origin'))
    region_id = get_or_create(conn, 'regions', data.get('region'))
    # Auto-link region to origin if both provided and region not yet linked
    if region_id and origin_id:
        conn.execute(
            'UPDATE regions SET origin_id=? WHERE id=? AND origin_id IS NULL',
            (origin_id, region_id)
        )
    return {
        'roaster_id':  get_or_create(conn, 'roasters',  data.get('roaster')),
        'producer_id': get_or_create(conn, 'producers', data.get('producer')),
        'origin_id':   origin_id,
        'region_id':   region_id,
        'shop_id':     get_or_create(conn, 'shops',     data.get('shop')),
    }


def get_coffee_by_id(conn, cid):
    """Fetch a single coffee by id and return it as a dict."""
    return row_to_coffee(conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone())


def _verr(key, msg, **params):
    """Return a structured validation error dict."""
    return {'key': key, 'msg': msg, 'params': params}


def validate_coffee(data):
    if not data or not isinstance(data, dict):
        return _verr('error.model.invalid_data', 'Datos inválidos')
    name = str(data.get('name', '')).strip()
    if not name:
        return _verr('error.model.name_required', 'El campo "nombre" es requerido')
    if len(name) > 200:
        return _verr('error.model.name_too_long', 'El nombre no puede superar los 200 caracteres')
    r = data.get('rating')
    if r is not None and (not isinstance(r, int) or isinstance(r, bool) or not 1 <= r <= 5):
        return _verr('error.model.rating_invalid', 'La valoración debe estar entre 1 y 5')
    q = data.get('quantity_g')
    if q is not None and (not isinstance(q, int) or isinstance(q, bool) or q <= 0):
        return _verr('error.model.quantity_invalid', 'La cantidad debe ser un número entero positivo')
    p = data.get('price_kg')
    if p is not None and (not isinstance(p, (int, float)) or isinstance(p, bool) or p <= 0):
        return _verr('error.model.price_invalid', 'El precio debe ser un valor positivo')
    a = data.get('altitude')
    if a is not None and (not isinstance(a, int) or isinstance(a, bool) or a < 0):
        return _verr('error.model.altitude_invalid', 'La altitud debe ser un número entero no negativo')
    for field in ['purchase_date', 'roast_date', 'opened_date', 'finished_date']:
        val = data.get(field)
        if val is not None and (not isinstance(val, str) or not DATE_RE.match(val)):
            return _verr('error.model.date_invalid',
                         f'Formato de fecha inválido para "{field}" (esperado YYYY-MM-DD)', field=field)
    for field in ['roaster', 'producer', 'origin', 'region', 'shop']:
        val = data.get(field)
        if val and len(str(val)) > 200:
            return _verr('error.model.field_too_long',
                         f'El campo "{field}" no puede superar los 200 caracteres', field=field)
    for field in ['varieties', 'processes', 'milk_types']:
        val = data.get(field)
        if val is not None:
            if not isinstance(val, list):
                return _verr('error.model.field_not_list',
                             f'El campo "{field}" debe ser una lista', field=field)
            for item in val:
                if item and len(str(item)) > 200:
                    return _verr('error.model.field_item_too_long',
                                 f'Un valor en "{field}" supera los 200 caracteres', field=field)
    notes = data.get('notes')
    if notes and len(str(notes)) > 5000:
        return _verr('error.model.notes_too_long', 'Las notas no pueden superar los 5000 caracteres')
    return None
