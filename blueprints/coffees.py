from flask import Blueprint, jsonify, request
import re
from functools import wraps

bp = Blueprint('coffees', __name__, url_prefix='/api')
DATE_RE = re.compile(r'^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$')


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        from flask import session, jsonify
        if not session.get('authenticated'):
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


def validate_coffee(data):
    if not data or not isinstance(data, dict):
        return 'Datos inválidos'
    name = str(data.get('name', '')).strip()
    if not name:
        return 'El campo "nombre" es requerido'
    if len(name) > 200:
        return 'El nombre no puede superar los 200 caracteres'
    r = data.get('rating')
    if r is not None and (not isinstance(r, int) or isinstance(r, bool) or not 1 <= r <= 5):
        return 'La valoración debe estar entre 1 y 5'
    q = data.get('quantity_g')
    if q is not None and (not isinstance(q, int) or isinstance(q, bool) or q <= 0):
        return 'La cantidad debe ser un número entero positivo'
    p = data.get('price_kg')
    if p is not None and (not isinstance(p, (int, float)) or isinstance(p, bool) or p <= 0):
        return 'El precio debe ser un valor positivo'
    a = data.get('altitude')
    if a is not None and (not isinstance(a, int) or isinstance(a, bool) or a < 0):
        return 'La altitud debe ser un número entero no negativo'
    for field in ['purchase_date', 'roast_date', 'opened_date', 'finished_date']:
        val = data.get(field)
        if val is not None and (not isinstance(val, str) or not DATE_RE.match(val)):
            return f'Formato de fecha inválido para "{field}" (esperado YYYY-MM-DD)'
    for field in ['roaster', 'producer', 'origin', 'region', 'shop']:
        val = data.get(field)
        if val and len(str(val)) > 200:
            return f'El campo "{field}" no puede superar los 200 caracteres'
    for field in ['varieties', 'processes', 'milk_types']:
        val = data.get(field)
        if val is not None:
            if not isinstance(val, list):
                return f'El campo "{field}" debe ser una lista'
            for item in val:
                if item and len(str(item)) > 200:
                    return f'Un valor en "{field}" supera los 200 caracteres'
    notes = data.get('notes')
    if notes and len(str(notes)) > 5000:
        return 'Las notas no pueden superar los 5000 caracteres'
    return None


@bp.route('/lookup-tables')
@login_required
def get_lookup_tables():
    from config import LOOKUP_TABLES
    return jsonify(LOOKUP_TABLES)


@bp.route('/options')
@login_required
def options():
    from extensions import db_conn
    from config import LOOKUP_TABLES
    with db_conn() as conn:
        result = {}
        for t in LOOKUP_TABLES:
            if t == 'regions':
                rows = conn.execute(
                    'SELECT id, name, origin_id FROM regions ORDER BY name COLLATE NOCASE'
                ).fetchall()
                result[t] = [{'id': r['id'], 'name': r['name'], 'origin_id': r['origin_id']} for r in rows]
            else:
                rows = conn.execute(f'SELECT id, name FROM {t} ORDER BY name COLLATE NOCASE').fetchall()
                result[t] = [{'id': r['id'], 'name': r['name']} for r in rows]
    return jsonify(result)


@bp.route('/coffees')
@login_required
def list_coffees():
    from models import COFFEE_SELECT, row_to_coffee
    from extensions import db_conn
    args = request.args
    where, vals = [], []
    for fk in ['roaster_id', 'producer_id', 'origin_id', 'region_id', 'shop_id']:
        if args.get(fk):
            try:
                where.append(f'c.{fk}=?')
                vals.append(int(args[fk]))
            except (ValueError, TypeError):
                return jsonify({'error': f'Valor de filtro inválido: {fk}'}), 400
    if args.get('variety_id'):
        try:
            where.append('EXISTS (SELECT 1 FROM coffee_varieties WHERE coffee_id=c.id AND variety_id=?)')
            vals.append(int(args['variety_id']))
        except (ValueError, TypeError):
            return jsonify({'error': 'Valor de filtro inválido: variety_id'}), 400
    if args.get('process_id'):
        try:
            where.append('EXISTS (SELECT 1 FROM coffee_processes WHERE coffee_id=c.id AND process_id=?)')
            vals.append(int(args['process_id']))
        except (ValueError, TypeError):
            return jsonify({'error': 'Valor de filtro inválido: process_id'}), 400
    status = args.get('status')
    if status == 'active':
        where.append("c.opened_date IS NOT NULL AND c.opened_date!='' AND (c.finished_date IS NULL OR c.finished_date='')")
    elif status == 'finished':
        where.append("c.finished_date IS NOT NULL AND c.finished_date!=''")
    elif status == 'pending':
        where.append("(c.opened_date IS NULL OR c.opened_date='')")
    elif status == 'unrated':
        where.append('c.rating IS NULL')
    if args.get('q'):
        q = f'%{args["q"].strip()}%'
        where.append('(c.name LIKE ? OR ro.name LIKE ? OR c.notes LIKE ? OR o.name LIKE ?)')
        vals.extend([q, q, q, q])
    sql = COFFEE_SELECT + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY c.created_at DESC'
    with db_conn() as conn:
        rows = conn.execute(sql, vals).fetchall()
    return jsonify([row_to_coffee(r) for r in rows])


@bp.route('/coffees', methods=['POST'])
@login_required
def add_coffee():
    from models import row_to_coffee, COFFEE_SELECT, resolve_ids, set_m2m
    from extensions import db_conn
    from config import SCALAR_FIELDS
    data = request.get_json(silent=True)
    err = validate_coffee(data)
    if err:
        return jsonify({'error': err}), 400
    with db_conn() as conn:
        ids = resolve_ids(conn, data)
        remaining_g = data.get('remaining_g') if data.get('remaining_g') is not None else data.get('quantity_g')
        fields = list(ids.keys()) + SCALAR_FIELDS + ['remaining_g']
        vals   = list(ids.values()) + [data.get(f) for f in SCALAR_FIELDS] + [remaining_g]
        cur = conn.execute(
            f"INSERT INTO coffees ({','.join(fields)}) VALUES ({','.join(['?']*len(fields))})", vals)
        cid = cur.lastrowid
        set_m2m(conn, cid, data.get('varieties'),  'varieties',  'coffee_varieties',   'variety_id')
        set_m2m(conn, cid, data.get('processes'),  'processes',  'coffee_processes',   'process_id')
        set_m2m(conn, cid, data.get('milk_types'), 'milk_types', 'coffee_milk_types',  'milk_type_id')
        row = row_to_coffee(conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone())
    return jsonify(row), 201


@bp.route('/coffees/<int:cid>', methods=['PUT'])
@login_required
def update_coffee(cid):
    from models import row_to_coffee, COFFEE_SELECT, resolve_ids, set_m2m
    from extensions import db_conn
    from config import SCALAR_FIELDS
    data = request.get_json(silent=True)
    err = validate_coffee(data)
    if err:
        return jsonify({'error': err}), 400
    with db_conn() as conn:
        ids    = resolve_ids(conn, data)
        fields = list(ids.keys()) + SCALAR_FIELDS
        vals   = list(ids.values()) + [data.get(f) for f in SCALAR_FIELDS] + [cid]
        sets   = ', '.join(f'{f}=?' for f in fields)
        conn.execute(f'UPDATE coffees SET {sets} WHERE id=?', vals)
        set_m2m(conn, cid, data.get('varieties'),  'varieties',  'coffee_varieties',   'variety_id')
        set_m2m(conn, cid, data.get('processes'),  'processes',  'coffee_processes',   'process_id')
        set_m2m(conn, cid, data.get('milk_types'), 'milk_types', 'coffee_milk_types',  'milk_type_id')
        row = row_to_coffee(conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone())
    return jsonify(row)


@bp.route('/coffees/<int:cid>/open', methods=['POST'])
@login_required
def open_coffee(cid):
    from models import row_to_coffee, COFFEE_SELECT
    from extensions import db_conn
    from datetime import datetime
    data = request.get_json(silent=True) or {}
    date = data.get('date') or datetime.now().strftime('%Y-%m-%d')
    if not isinstance(date, str) or not DATE_RE.match(date):
        return jsonify({'error': 'Formato de fecha inválido (esperado YYYY-MM-DD)'}), 400
    with db_conn() as conn:
        conn.execute('UPDATE coffees SET opened_date=? WHERE id=?', (date, cid))
        row = row_to_coffee(conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone())
    return jsonify(row)


@bp.route('/coffees/<int:cid>/finish', methods=['POST'])
@login_required
def finish_coffee(cid):
    from models import row_to_coffee, COFFEE_SELECT
    from extensions import db_conn
    from datetime import datetime
    today = datetime.now().strftime('%Y-%m-%d')
    with db_conn() as conn:
        conn.execute('UPDATE coffees SET finished_date=? WHERE id=?', (today, cid))
        row = row_to_coffee(conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone())
    return jsonify(row)


@bp.route('/coffees/<int:cid>/unrate', methods=['POST'])
@login_required
def unrate_coffee(cid):
    from models import row_to_coffee, COFFEE_SELECT
    from extensions import db_conn
    with db_conn() as conn:
        conn.execute('UPDATE coffees SET rating=NULL WHERE id=?', (cid,))
        row = row_to_coffee(conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone())
    return jsonify(row)


@bp.route('/coffees/<int:cid>/remaining', methods=['PUT'])
@login_required
def set_remaining(cid):
    from models import row_to_coffee, COFFEE_SELECT
    from extensions import db_conn
    data = request.get_json(silent=True) or {}
    val = data.get('remaining_g')
    if val is None or not isinstance(val, int) or isinstance(val, bool) or val < 0:
        return jsonify({'error': 'remaining_g debe ser un entero no negativo'}), 400
    with db_conn() as conn:
        conn.execute('UPDATE coffees SET remaining_g=? WHERE id=?', (val, cid))
        row = row_to_coffee(conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone())
    return jsonify(row)


@bp.route('/coffees/<int:cid>/consume', methods=['POST'])
@login_required
def consume_coffee(cid):
    from models import row_to_coffee, COFFEE_SELECT
    from extensions import db_conn
    with db_conn() as conn:
        coffee_row = conn.execute('SELECT remaining_g FROM coffees WHERE id=?', (cid,)).fetchone()
        if not coffee_row:
            return jsonify({'error': 'Not found'}), 404
        gps_row = conn.execute("SELECT value FROM settings WHERE key='grams_per_shot'").fetchone()
        grams = int(gps_row['value']) if gps_row else 17
        current = coffee_row['remaining_g'] if coffee_row['remaining_g'] is not None else 0
        new_val = max(0, current - grams)
        conn.execute('UPDATE coffees SET remaining_g=? WHERE id=?', (new_val, cid))
        row = row_to_coffee(conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone())
    return jsonify({'coffee': row, 'consumed_g': grams, 'remaining_g': new_val})


@bp.route('/coffees/<int:cid>', methods=['DELETE'])
@login_required
def delete_coffee(cid):
    from extensions import db_conn
    with db_conn() as conn:
        conn.execute('DELETE FROM coffees WHERE id=?', (cid,))
    return jsonify({'ok': True})


@bp.route('/stats')
@login_required
def stats():
    from models import COFFEE_SELECT
    from extensions import db_conn
    with db_conn() as conn:
        total    = conn.execute('SELECT COUNT(*) FROM coffees').fetchone()[0]
        finished = conn.execute("SELECT COUNT(*) FROM coffees WHERE finished_date IS NOT NULL AND finished_date!=''").fetchone()[0]
        active   = conn.execute("SELECT COUNT(*) FROM coffees WHERE opened_date IS NOT NULL AND opened_date!='' AND (finished_date IS NULL OR finished_date='')").fetchone()[0]
        pending_weight_g = conn.execute(
            "SELECT COALESCE(SUM(quantity_g),0) FROM coffees WHERE (opened_date IS NULL OR opened_date='') AND (finished_date IS NULL OR finished_date='')"
        ).fetchone()[0]
        active_weight_g = conn.execute(
            "SELECT COALESCE(SUM(remaining_g),0) FROM coffees WHERE opened_date IS NOT NULL AND opened_date!='' AND (finished_date IS NULL OR finished_date='')"
        ).fetchone()[0]
        avg_r    = conn.execute('SELECT AVG(rating) FROM coffees WHERE rating IS NOT NULL').fetchone()[0]
        spent    = conn.execute('SELECT SUM(quantity_g/1000.0*price_kg) FROM coffees WHERE price_kg IS NOT NULL AND quantity_g IS NOT NULL').fetchone()[0]
        avg_cost_kg = conn.execute('''
            SELECT SUM(quantity_g/1000.0*price_kg) / NULLIF(SUM(quantity_g/1000.0), 0)
            FROM coffees WHERE price_kg IS NOT NULL AND quantity_g IS NOT NULL AND quantity_g > 0
        ''').fetchone()[0]
        days_per_kg = conn.execute('''
            SELECT AVG((julianday(finished_date) - julianday(opened_date)) / (quantity_g / 1000.0))
            FROM coffees
            WHERE finished_date IS NOT NULL AND finished_date != ''
              AND opened_date   IS NOT NULL AND opened_date   != ''
              AND quantity_g    IS NOT NULL AND quantity_g    > 0
        ''').fetchone()[0]
        top_roasters = conn.execute('''
            SELECT ro.name, COUNT(*) cnt, AVG(c.rating) avg_rating
            FROM coffees c JOIN roasters ro ON c.roaster_id=ro.id
            GROUP BY ro.id ORDER BY cnt DESC LIMIT 5''').fetchall()
        origins_bd = conn.execute('''
            SELECT o.name, COUNT(*) cnt, AVG(c.rating) avg_rating
            FROM coffees c JOIN origins o ON c.origin_id=o.id
            GROUP BY o.id ORDER BY cnt DESC LIMIT 8''').fetchall()
        processes_bd = conn.execute('''
            SELECT pr.name, COUNT(DISTINCT cp.coffee_id) cnt, AVG(c.rating) avg_rating
            FROM coffee_processes cp
            JOIN processes pr ON cp.process_id=pr.id
            JOIN coffees c ON cp.coffee_id=c.id
            GROUP BY pr.id ORDER BY cnt DESC LIMIT 6''').fetchall()
        varieties_bd = conn.execute('''
            SELECT v.name, COUNT(DISTINCT cv.coffee_id) cnt, AVG(c.rating) avg_rating
            FROM coffee_varieties cv
            JOIN varieties v ON cv.variety_id=v.id
            JOIN coffees c ON cv.coffee_id=c.id
            GROUP BY v.id ORDER BY cnt DESC LIMIT 6''').fetchall()
    return jsonify({
        'total': total, 'finished': finished, 'active': active,
        'pending_weight_g': pending_weight_g,
        'active_weight_g': active_weight_g,
        'avg_rating': round(avg_r, 1) if avg_r else None,
        'total_spent': round(spent, 2) if spent else 0,
        'avg_cost_kg': round(avg_cost_kg, 2) if avg_cost_kg else None,
        'days_per_kg': round(days_per_kg, 1) if days_per_kg else None,
        'top_roasters': [{'name': r['name'], 'cnt': r['cnt'], 'avg_rating': round(r['avg_rating'], 1) if r['avg_rating'] else None} for r in top_roasters],
        'origins_breakdown': [{'name': r['name'], 'cnt': r['cnt'], 'avg_rating': round(r['avg_rating'], 1) if r['avg_rating'] else None} for r in origins_bd],
        'processes_breakdown': [{'name': r['name'], 'cnt': r['cnt'], 'avg_rating': round(r['avg_rating'], 1) if r['avg_rating'] else None} for r in processes_bd],
        'varieties_breakdown': [{'name': r['name'], 'cnt': r['cnt'], 'avg_rating': round(r['avg_rating'], 1) if r['avg_rating'] else None} for r in varieties_bd],
    })
