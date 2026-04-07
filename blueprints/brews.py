from datetime import datetime
from flask import Blueprint, request, jsonify
from db import db_conn
from schema import login_required

bp = Blueprint('brews', __name__)


def _purge_orphans(conn):
    conn.execute('DELETE FROM recipes WHERE id NOT IN (SELECT recipe_id FROM coffee_recipes)')
    conn.execute('DELETE FROM brews   WHERE id NOT IN (SELECT brew_id   FROM coffee_brews)')


# ---------------------------------------------------------------------------
# Brews — global list
# ---------------------------------------------------------------------------

@bp.route('/api/brews')
@login_required
def list_brews():
    with db_conn() as conn:
        rows = conn.execute('''
            SELECT b.id, b.brew_date, b.dose_g, b.yield_g, b.grind, b.temp_c,
                   b.rating, b.notes, b.created_at,
                   GROUP_CONCAT(c.name, '|||') AS coffee_names
            FROM brews b
            LEFT JOIN coffee_brews cb ON cb.brew_id = b.id
            LEFT JOIN coffees c ON c.id = cb.coffee_id
            GROUP BY b.id
            ORDER BY b.brew_date DESC, b.created_at DESC
        ''').fetchall()
    result = []
    for r in rows:
        d = dict(r)
        names = d.pop('coffee_names') or ''
        d['coffees'] = [n for n in names.split('|||') if n] if names else []
        result.append(d)
    return jsonify(result)


# ---------------------------------------------------------------------------
# Recipe
# ---------------------------------------------------------------------------

@bp.route('/api/coffees/<int:cid>/recipe')
@login_required
def get_recipe(cid):
    with db_conn() as conn:
        if not conn.execute('SELECT 1 FROM coffees WHERE id=?', (cid,)).fetchone():
            return jsonify({'error': 'Café no encontrado'}), 404
        row = conn.execute('''
            SELECT r.id, r.dose_g, r.yield_g, r.grind, r.temp_c, r.updated_at
            FROM recipes r
            JOIN coffee_recipes cr ON cr.recipe_id = r.id
            WHERE cr.coffee_id = ?
            LIMIT 1
        ''', (cid,)).fetchone()
    if not row:
        return jsonify({'error': 'Sin receta'}), 404
    return jsonify(dict(row))


@bp.route('/api/coffees/<int:cid>/recipe', methods=['PUT'])
@login_required
def upsert_recipe(cid):
    data = request.get_json(silent=True) or {}
    dose_g  = data.get('dose_g')
    yield_g = data.get('yield_g')
    grind   = data.get('grind')
    temp_c  = data.get('temp_c')
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    with db_conn() as conn:
        if not conn.execute('SELECT 1 FROM coffees WHERE id=?', (cid,)).fetchone():
            return jsonify({'error': 'Café no encontrado'}), 404
        existing = conn.execute('''
            SELECT r.id FROM recipes r
            JOIN coffee_recipes cr ON cr.recipe_id = r.id
            WHERE cr.coffee_id = ?
            LIMIT 1
        ''', (cid,)).fetchone()
        if existing:
            conn.execute(
                'UPDATE recipes SET dose_g=?, yield_g=?, grind=?, temp_c=?, updated_at=? WHERE id=?',
                (dose_g, yield_g, grind, temp_c, now, existing['id'])
            )
            rid = existing['id']
        else:
            cur = conn.execute(
                'INSERT INTO recipes (dose_g, yield_g, grind, temp_c, updated_at) VALUES (?,?,?,?,?)',
                (dose_g, yield_g, grind, temp_c, now)
            )
            rid = cur.lastrowid
            conn.execute('INSERT INTO coffee_recipes (coffee_id, recipe_id) VALUES (?,?)', (cid, rid))
        row = conn.execute(
            'SELECT id, dose_g, yield_g, grind, temp_c, updated_at FROM recipes WHERE id=?', (rid,)
        ).fetchone()
    return jsonify(dict(row))


@bp.route('/api/coffees/<int:cid>/recipe', methods=['DELETE'])
@login_required
def delete_recipe(cid):
    with db_conn() as conn:
        conn.execute('DELETE FROM coffee_recipes WHERE coffee_id=?', (cid,))
        _purge_orphans(conn)
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# Brews — per coffee
# ---------------------------------------------------------------------------

@bp.route('/api/coffees/<int:cid>/brews')
@login_required
def list_coffee_brews(cid):
    with db_conn() as conn:
        if not conn.execute('SELECT 1 FROM coffees WHERE id=?', (cid,)).fetchone():
            return jsonify({'error': 'Café no encontrado'}), 404
        rows = conn.execute('''
            SELECT b.id, b.brew_date, b.dose_g, b.yield_g, b.grind, b.temp_c,
                   b.rating, b.notes, b.created_at
            FROM brews b
            JOIN coffee_brews cb ON cb.brew_id = b.id
            WHERE cb.coffee_id = ?
            ORDER BY b.brew_date DESC, b.created_at DESC
        ''', (cid,)).fetchall()
    return jsonify([dict(r) for r in rows])


@bp.route('/api/coffees/<int:cid>/brews', methods=['POST'])
@login_required
def add_brew(cid):
    data = request.get_json(silent=True) or {}
    brew_date = data.get('brew_date') or datetime.now().strftime('%Y-%m-%d')
    dose_g  = data.get('dose_g')
    yield_g = data.get('yield_g')
    grind   = data.get('grind')
    temp_c  = data.get('temp_c')
    notes   = data.get('notes') or None
    rating  = data.get('rating')
    if rating is not None:
        try:
            rating = int(rating)
            if not (1 <= rating <= 5):
                rating = None
        except (ValueError, TypeError):
            rating = None
    with db_conn() as conn:
        if not conn.execute('SELECT 1 FROM coffees WHERE id=?', (cid,)).fetchone():
            return jsonify({'error': 'Café no encontrado'}), 404
        cur = conn.execute(
            'INSERT INTO brews (brew_date, dose_g, yield_g, grind, temp_c, rating, notes) '
            'VALUES (?,?,?,?,?,?,?)',
            (brew_date, dose_g, yield_g, grind, temp_c, rating, notes)
        )
        bid = cur.lastrowid
        conn.execute('INSERT INTO coffee_brews (coffee_id, brew_id) VALUES (?,?)', (cid, bid))
        row = conn.execute(
            'SELECT id, brew_date, dose_g, yield_g, grind, temp_c, rating, notes, created_at '
            'FROM brews WHERE id=?', (bid,)
        ).fetchone()
    return jsonify(dict(row)), 201


@bp.route('/api/brews/<int:bid>', methods=['DELETE'])
@login_required
def delete_brew(bid):
    with db_conn() as conn:
        cur = conn.execute('DELETE FROM brews WHERE id=?', (bid,))
        if cur.rowcount == 0:
            return jsonify({'error': 'Preparación no encontrada'}), 404
        _purge_orphans(conn)
    return jsonify({'ok': True})
