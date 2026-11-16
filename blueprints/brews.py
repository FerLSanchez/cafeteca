import json
from datetime import datetime
from flask import Blueprint, request, jsonify
from db import db_conn
from models import validate_brew, family_ids, family_recipe, family_recipes, recipe_for, RECIPE_COLS

BREW_FIELDS = ['brew_date', 'dose_g', 'yield_g', 'time_s', 'grind', 'temp_c', 'rating', 'notes', 'shot_metrics',
               'shot_curve', 'taste_balance', 'taste_body', 'recipe_id']
BREW_COLS = ('id, brew_date, dose_g, yield_g, time_s, grind, temp_c, rating, taste_balance, taste_body, notes, '
             'shot_metrics, shot_curve, recipe_id, created_at')
JSON_COLS = ('shot_metrics', 'shot_curve')
RECIPE_FIELDS = ['name', 'dose_g', 'yield_g', 'time_s', 'grind', 'temp_c', 'target_flow']


def _brew_out(row):
    d = dict(row)
    for col in JSON_COLS:
        if col in d:
            d[col] = json.loads(d[col]) if d[col] else None
    return d


def _json_in(value):
    return json.dumps(value, separators=(',', ':')) if value else None


def _validation_error(err):
    body = {'error': err['msg'], 'error_key': err['key']}
    if err.get('params'):
        body['error_key_params'] = err['params']
    return jsonify(body), 400

bp = Blueprint('brews', __name__)


def _purge_orphans(conn):
    conn.execute('DELETE FROM recipes WHERE id NOT IN (SELECT recipe_id FROM coffee_recipes)')
    conn.execute('UPDATE brews SET recipe_id=NULL WHERE recipe_id IS NOT NULL '
                 'AND recipe_id NOT IN (SELECT id FROM recipes)')
    conn.execute('DELETE FROM brews   WHERE id NOT IN (SELECT brew_id   FROM coffee_brews)')


# ---------------------------------------------------------------------------
# Brews — global list
# ---------------------------------------------------------------------------

@bp.route('/api/brews')
def list_brews():
    try:
        limit  = min(max(int(request.args.get('limit', 20)), 1), 100)
        offset = max(int(request.args.get('offset', 0)), 0)
    except (ValueError, TypeError):
        limit, offset = 20, 0
    with db_conn() as conn:
        total = conn.execute('SELECT COUNT(*) FROM brews').fetchone()[0]
        rows = conn.execute('''
            SELECT b.id, b.brew_date, b.dose_g, b.yield_g, b.time_s, b.grind, b.temp_c,
                   b.rating, b.taste_balance, b.taste_body, b.notes, b.shot_metrics, b.shot_curve, b.recipe_id,
                   b.created_at, GROUP_CONCAT(c.name, '|||') AS coffee_names
            FROM brews b
            LEFT JOIN coffee_brews cb ON cb.brew_id = b.id
            LEFT JOIN coffees c ON c.id = cb.coffee_id
            GROUP BY b.id
            ORDER BY b.brew_date DESC, b.created_at DESC, b.id DESC
            LIMIT ? OFFSET ?
        ''', (limit, offset)).fetchall()
    result = []
    for r in rows:
        d = _brew_out(r)
        names = d.pop('coffee_names') or ''
        d['coffees'] = [n for n in names.split('|||') if n] if names else []
        result.append(d)
    return jsonify({'brews': result, 'total': total, 'has_more': offset + len(result) < total})


@bp.route('/api/brews/pending')
def pending_brews():
    """Shots de báscula por valorar desde `since` (la fecha la pone el cliente: el servidor va en UTC)."""
    since = request.args.get('since', '')
    try:
        datetime.strptime(since, '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': 'Formato de fecha inválido (esperado YYYY-MM-DD)',
                        'error_key': 'error.coffee.invalid_date'}), 400
    with db_conn() as conn:
        count = conn.execute('''
            SELECT COUNT(*) FROM brews
            WHERE shot_metrics IS NOT NULL AND brew_date >= ?
              AND (rating IS NULL OR taste_balance IS NULL)
        ''', (since,)).fetchone()[0]
    return jsonify({'count': count})


@bp.route('/api/brews/purge', methods=['DELETE'])
def purge_old_brews():
    data = request.get_json(silent=True) or {}
    try:
        months = int(data.get('months', 3))
        if months < 1:
            months = 1
    except (ValueError, TypeError):
        months = 3
    with db_conn() as conn:
        cur = conn.execute(
            "DELETE FROM brews WHERE brew_date < date('now', ?)", (f'-{months} months',)
        )
        deleted = cur.rowcount
        _purge_orphans(conn)
    return jsonify({'ok': True, 'deleted': deleted})


# ---------------------------------------------------------------------------
# Recipes — several per coffee, shared by the family (bags of the same coffee)
# ---------------------------------------------------------------------------

def _coffee_404():
    return jsonify({'error': 'Café no encontrado', 'error_key': 'error.coffee.not_found'}), 404


def _recipe_404():
    return jsonify({'error': 'Sin receta', 'error_key': 'error.brew.no_recipe'}), 404


def _coffee_exists(conn, cid):
    return conn.execute('SELECT 1 FROM coffees WHERE id=?', (cid,)).fetchone() is not None


def _recipe_values(data):
    vals = {f: data.get(f) for f in RECIPE_FIELDS if f in data}
    if 'name' in vals:
        vals['name'] = (vals['name'] or '').strip() or None
    return vals


def _write_recipe(conn, rid, vals):
    vals = dict(vals, updated_at=datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    conn.execute(f"UPDATE recipes SET {', '.join(f + '=?' for f in vals)} WHERE id=?", list(vals.values()) + [rid])
    return dict(conn.execute(f'SELECT {RECIPE_COLS} FROM recipes WHERE id=?', (rid,)).fetchone())


def _create_recipe(conn, cid, vals):
    rid = conn.execute('INSERT INTO recipes DEFAULT VALUES').lastrowid
    conn.execute('INSERT INTO coffee_recipes (coffee_id, recipe_id) VALUES (?,?)', (cid, rid))
    return _write_recipe(conn, rid, vals)


@bp.route('/api/coffees/<int:cid>/recipes')
def list_recipes(cid):
    """All the recipes of the coffee's family; `current` is the one its latest brew used."""
    with db_conn() as conn:
        if not _coffee_exists(conn, cid):
            return _coffee_404()
        recipes = family_recipes(conn, cid)
        current = family_recipe(conn, cid)
    return jsonify({'recipes': recipes, 'current_id': current['id'] if current else None})


@bp.route('/api/coffees/<int:cid>/recipes', methods=['POST'])
def create_recipe(cid):
    data = request.get_json(silent=True) or {}
    err = validate_brew(data, recipe=True)
    if err:
        return _validation_error(err)
    with db_conn() as conn:
        if not _coffee_exists(conn, cid):
            return _coffee_404()
        row = _create_recipe(conn, cid, _recipe_values(data))
    return jsonify(row), 201


@bp.route('/api/recipes/<int:rid>', methods=['PUT'])
def update_recipe(rid):
    """Partial update: only the fields present in the body are modified."""
    data = request.get_json(silent=True) or {}
    err = validate_brew(data, recipe=True)
    if err:
        return _validation_error(err)
    with db_conn() as conn:
        if not conn.execute('SELECT 1 FROM recipes WHERE id=?', (rid,)).fetchone():
            return _recipe_404()
        row = _write_recipe(conn, rid, _recipe_values(data))
    return jsonify(row)


@bp.route('/api/recipes/<int:rid>', methods=['DELETE'])
def delete_recipe_by_id(rid):
    with db_conn() as conn:
        if conn.execute('DELETE FROM recipes WHERE id=?', (rid,)).rowcount == 0:
            return _recipe_404()
        conn.execute('DELETE FROM coffee_recipes WHERE recipe_id=?', (rid,))
        _purge_orphans(conn)
    return jsonify({'ok': True})


# The family's current recipe (the one its latest brew used): kept for "Consumir" and older clients
@bp.route('/api/coffees/<int:cid>/recipe')
def get_recipe(cid):
    with db_conn() as conn:
        if not _coffee_exists(conn, cid):
            return _coffee_404()
        row = family_recipe(conn, cid)
    return jsonify(row) if row else _recipe_404()


@bp.route('/api/coffees/<int:cid>/recipe', methods=['PUT'])
def upsert_recipe(cid):
    data = request.get_json(silent=True) or {}
    err = validate_brew(data, recipe=True)
    if err:
        return _validation_error(err)
    vals = {f: data.get(f) for f in RECIPE_FIELDS if f != 'name'}
    if 'name' in data:
        vals.update(_recipe_values({'name': data['name']}))
    with db_conn() as conn:
        if not _coffee_exists(conn, cid):
            return _coffee_404()
        current = family_recipe(conn, cid)
        if current:
            conn.execute('INSERT OR IGNORE INTO coffee_recipes (coffee_id, recipe_id) VALUES (?,?)',
                         (cid, current['id']))
            row = _write_recipe(conn, current['id'], vals)
        else:
            row = _create_recipe(conn, cid, vals)
    return jsonify(row)


@bp.route('/api/coffees/<int:cid>/recipe', methods=['DELETE'])
def delete_recipe(cid):
    """Deletes all the family's recipes."""
    with db_conn() as conn:
        if not _coffee_exists(conn, cid):
            return _coffee_404()
        ids = family_ids(conn, cid)
        conn.execute(f"DELETE FROM coffee_recipes WHERE coffee_id IN ({','.join('?' * len(ids))})", ids)
        _purge_orphans(conn)
    return jsonify({'ok': True})


def _check_recipe(conn, cid, data):
    """400 if `recipe_id` is not one of the coffee family's recipes."""
    rid = data.get('recipe_id')
    if rid is not None and all(r['id'] != rid for r in family_recipes(conn, cid)):
        return _validation_error({'key': 'error.brew.recipe_invalid', 'msg': 'Receta no válida para este café'})
    return None


# ---------------------------------------------------------------------------
# Brews — per coffee
# ---------------------------------------------------------------------------

@bp.route('/api/coffees/<int:cid>/brews')
def list_coffee_brews(cid):
    with db_conn() as conn:
        if not conn.execute('SELECT 1 FROM coffees WHERE id=?', (cid,)).fetchone():
            return jsonify({'error': 'Café no encontrado', 'error_key': 'error.coffee.not_found'}), 404
        # ?family=1: los brews de todas las bolsas del mismo café (con coffee_id y coffee_name)
        ids = family_ids(conn, cid) if request.args.get('family') == '1' else [cid]
        rows = conn.execute(f'''
            SELECT b.id, b.brew_date, b.dose_g, b.yield_g, b.time_s, b.grind, b.temp_c,
                   b.rating, b.taste_balance, b.taste_body, b.notes, b.shot_metrics, b.shot_curve, b.recipe_id,
                   b.created_at, cb.coffee_id, c.name AS coffee_name
            FROM brews b
            JOIN coffee_brews cb ON cb.brew_id = b.id
            JOIN coffees c ON c.id = cb.coffee_id
            WHERE cb.coffee_id IN ({','.join('?' * len(ids))})
            ORDER BY b.brew_date DESC, b.created_at DESC, b.id DESC
        ''', ids).fetchall()
        recipes = family_recipes(conn, cid)
    out = []
    for r in rows:
        d = _brew_out(r)
        d['recipe_group'] = recipe_for(d, recipes)   # la receta para la que cuenta (elegida o ratio más cercano)
        out.append(d)
    return jsonify(out)


@bp.route('/api/coffees/<int:cid>/brews', methods=['POST'])
def add_brew(cid):
    data = request.get_json(silent=True) or {}
    err = validate_brew(data)
    if err:
        return _validation_error(err)
    brew_date = data.get('brew_date') or datetime.now().strftime('%Y-%m-%d')
    dose_g  = data.get('dose_g')
    yield_g = data.get('yield_g')
    time_s  = data.get('time_s')
    grind   = data.get('grind')
    temp_c  = data.get('temp_c')
    notes   = data.get('notes') or None
    rating  = data.get('rating')
    taste_balance = data.get('taste_balance')
    taste_body    = data.get('taste_body')
    shot_metrics = _json_in(data.get('shot_metrics'))
    shot_curve = _json_in(data.get('shot_curve'))
    recipe_id = data.get('recipe_id')
    with db_conn() as conn:
        coffee_row = conn.execute(
            'SELECT remaining_g, opened_date, finished_date FROM coffees WHERE id=?', (cid,)
        ).fetchone()
        if not coffee_row:
            return _coffee_404()
        err = _check_recipe(conn, cid, data)
        if err:
            return err
        cur = conn.execute(
            'INSERT INTO brews (brew_date, dose_g, yield_g, time_s, grind, temp_c, rating, taste_balance, taste_body, '
            'notes, shot_metrics, shot_curve, recipe_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (brew_date, dose_g, yield_g, time_s, grind, temp_c, rating, taste_balance, taste_body, notes,
             shot_metrics, shot_curve, recipe_id)
        )
        bid = cur.lastrowid
        conn.execute('INSERT INTO coffee_brews (coffee_id, brew_id) VALUES (?,?)', (cid, bid))
        new_remaining = None
        if (dose_g is not None and coffee_row['opened_date'] and not coffee_row['finished_date']
                and coffee_row['remaining_g'] is not None):
            new_remaining = max(0, int(coffee_row['remaining_g'] - dose_g))
            conn.execute('UPDATE coffees SET remaining_g=? WHERE id=?', (new_remaining, cid))
        row = conn.execute(f'SELECT {BREW_COLS} FROM brews WHERE id=?', (bid,)).fetchone()
    result = _brew_out(row)
    if new_remaining is not None:
        result['remaining_g'] = new_remaining
    return jsonify(result), 201


@bp.route('/api/brews/<int:bid>', methods=['PUT'])
def update_brew(bid):
    """Partial update: only the fields present in the body are modified."""
    data = request.get_json(silent=True) or {}
    err = validate_brew(data)
    if err:
        return _validation_error(err)
    if 'brew_date' in data and not data['brew_date']:
        return _validation_error({'key': 'error.model.date_invalid',
                                  'msg': 'brew_date no puede estar vacío', 'params': {'field': 'brew_date'}})
    updates = {f: data[f] for f in BREW_FIELDS if f in data}
    if 'notes' in updates:
        updates['notes'] = updates['notes'] or None
    for col in JSON_COLS:
        if col in updates:
            updates[col] = _json_in(updates[col])
    with db_conn() as conn:
        owner = conn.execute('SELECT coffee_id FROM coffee_brews WHERE brew_id=?', (bid,)).fetchone()
        if not owner:
            return jsonify({'error': 'Preparación no encontrada', 'error_key': 'error.brew.not_found'}), 404
        err = _check_recipe(conn, owner['coffee_id'], data)
        if err:
            return err
        if updates:
            sets = ', '.join(f'{f}=?' for f in updates)
            conn.execute(f'UPDATE brews SET {sets} WHERE id=?', list(updates.values()) + [bid])
        row = conn.execute(f'SELECT {BREW_COLS} FROM brews WHERE id=?', (bid,)).fetchone()
    return jsonify(_brew_out(row))


@bp.route('/api/brews/<int:bid>', methods=['DELETE'])
def delete_brew(bid):
    with db_conn() as conn:
        cur = conn.execute('DELETE FROM brews WHERE id=?', (bid,))
        if cur.rowcount == 0:
            return jsonify({'error': 'Preparación no encontrada', 'error_key': 'error.brew.not_found'}), 404
        _purge_orphans(conn)
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Molienda vs edad de la bolsa — datos para el modelo de grind-model.js
# ---------------------------------------------------------------------------

@bp.route('/api/grind-data')
def grind_data():
    """Un punto por brew con molienda y flujo: flujo principal de la báscula o, si no, salida/tiempo.
    Días desde tueste y desde apertura en la fecha del brew (null si falta la fecha del café)."""
    with db_conn() as conn:
        rows = conn.execute('''
            SELECT b.id, b.brew_date, b.grind, b.dose_g, b.yield_g, b.time_s, b.rating, b.taste_balance, b.shot_metrics,
                   b.recipe_id, cb.coffee_id, COALESCE(c.family_id, c.id) AS family_id,
                   CAST(julianday(b.brew_date) - julianday(c.roast_date)  AS INTEGER) AS days_roast,
                   CAST(julianday(b.brew_date) - julianday(c.opened_date) AS INTEGER) AS days_open
            FROM brews b
            JOIN coffee_brews cb ON cb.brew_id = b.id
            JOIN coffees c ON c.id = cb.coffee_id
            WHERE b.grind IS NOT NULL
            ORDER BY b.brew_date, b.created_at, b.id
        ''').fetchall()
        recipes = {}   # por familia
        for r in rows:
            if r['family_id'] not in recipes:
                recipes[r['family_id']] = family_recipes(conn, r['coffee_id'])
    out = []
    for r in rows:
        metrics = json.loads(r['shot_metrics']) if r['shot_metrics'] else {}
        flow = metrics.get('main_flow')
        if flow is None and r['yield_g'] and r['time_s']:
            flow = round(r['yield_g'] / r['time_s'], 2)
        if flow is None:
            continue
        out.append({
            'brew_id': r['id'], 'coffee_id': r['coffee_id'], 'family_id': r['family_id'], 'brew_date': r['brew_date'],
            'grind': r['grind'], 'dose_g': r['dose_g'], 'rating': r['rating'],
            'recipe_group': recipe_for(dict(r), recipes[r['family_id']]),
            'taste_balance': r['taste_balance'], 'flow': flow,
            'days_roast': r['days_roast'] if r['days_roast'] is not None and r['days_roast'] >= 0 else None,
            'days_open': r['days_open'] if r['days_open'] is not None and r['days_open'] >= 0 else None,
        })
    return jsonify(out)
