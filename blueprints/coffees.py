from datetime import datetime
from flask import Blueprint, request, jsonify
from db import db_conn
from models import (COFFEE_SELECT, row_to_coffee, set_m2m, resolve_ids,
                    validate_coffee, SCALAR_FIELDS, get_coffee_by_id, DATE_RE)
from schema import login_required
import schema

bp = Blueprint('coffees', __name__)


@bp.route('/api/coffees')
@login_required
def list_coffees():
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
        q = args["q"].strip()
        if schema.FTS_ENABLED:
            fts_q = ' '.join(f'"{w.replace(chr(34), "")}"*' for w in q.split() if w)
            where.append(
                '(c.id IN (SELECT rowid FROM coffees_fts WHERE coffees_fts MATCH ?) '
                'OR ro.name LIKE ? OR o.name LIKE ?)'
            )
            vals.extend([fts_q, f'%{q}%', f'%{q}%'])
        else:
            q_like = f'%{q}%'
            where.append('(c.name LIKE ? OR ro.name LIKE ? OR c.notes LIKE ? OR o.name LIKE ?)')
            vals.extend([q_like, q_like, q_like, q_like])
    try:
        limit  = min(int(args['limit']), 500) if args.get('limit') else None
        offset = int(args['offset']) if args.get('offset') else 0
        if limit is not None and limit <= 0:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({'error': 'Parámetros limit/offset inválidos'}), 400
    sql = COFFEE_SELECT + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY c.created_at DESC'
    if limit is not None:
        sql += f' LIMIT {limit} OFFSET {offset}'
    with db_conn() as conn:
        rows = conn.execute(sql, vals).fetchall()
    return jsonify([row_to_coffee(r) for r in rows])


@bp.route('/api/coffees', methods=['POST'])
@login_required
def add_coffee():
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
        row = get_coffee_by_id(conn, cid)
    return jsonify(row), 201


@bp.route('/api/coffees/<int:cid>', methods=['PUT'])
@login_required
def update_coffee(cid):
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
        row = get_coffee_by_id(conn, cid)
    return jsonify(row)


@bp.route('/api/coffees/<int:cid>/open', methods=['POST'])
@login_required
def open_coffee(cid):
    data = request.get_json(silent=True) or {}
    date = data.get('date') or datetime.now().strftime('%Y-%m-%d')
    if not isinstance(date, str) or not DATE_RE.match(date):
        return jsonify({'error': 'Formato de fecha inválido (esperado YYYY-MM-DD)'}), 400
    with db_conn() as conn:
        if not conn.execute('SELECT 1 FROM coffees WHERE id=?', (cid,)).fetchone():
            return jsonify({'error': 'Café no encontrado'}), 404
        conn.execute('UPDATE coffees SET opened_date=? WHERE id=?', (date, cid))
        row = get_coffee_by_id(conn, cid)
    return jsonify(row)


@bp.route('/api/coffees/<int:cid>/finish', methods=['POST'])
@login_required
def finish_coffee(cid):
    today = datetime.now().strftime('%Y-%m-%d')
    with db_conn() as conn:
        if not conn.execute('SELECT 1 FROM coffees WHERE id=?', (cid,)).fetchone():
            return jsonify({'error': 'Café no encontrado'}), 404
        conn.execute('UPDATE coffees SET finished_date=? WHERE id=?', (today, cid))
        row = get_coffee_by_id(conn, cid)
    return jsonify(row)


@bp.route('/api/coffees/<int:cid>/unrate', methods=['POST'])
@login_required
def unrate_coffee(cid):
    with db_conn() as conn:
        if not conn.execute('SELECT 1 FROM coffees WHERE id=?', (cid,)).fetchone():
            return jsonify({'error': 'Café no encontrado'}), 404
        conn.execute('UPDATE coffees SET rating=NULL WHERE id=?', (cid,))
        row = get_coffee_by_id(conn, cid)
    return jsonify(row)


@bp.route('/api/coffees/<int:cid>/remaining', methods=['PUT'])
@login_required
def set_remaining(cid):
    data = request.get_json(silent=True) or {}
    val = data.get('remaining_g')
    if val is None or not isinstance(val, int) or isinstance(val, bool) or val < 0:
        return jsonify({'error': 'remaining_g debe ser un entero no negativo'}), 400
    with db_conn() as conn:
        if not conn.execute('SELECT 1 FROM coffees WHERE id=?', (cid,)).fetchone():
            return jsonify({'error': 'Café no encontrado'}), 404
        conn.execute('UPDATE coffees SET remaining_g=? WHERE id=?', (val, cid))
        row = get_coffee_by_id(conn, cid)
    return jsonify(row)


@bp.route('/api/coffees/<int:cid>/consume', methods=['POST'])
@login_required
def consume_coffee(cid):
    with db_conn() as conn:
        coffee_row = conn.execute('SELECT remaining_g FROM coffees WHERE id=?', (cid,)).fetchone()
        if not coffee_row:
            return jsonify({'error': 'Café no encontrado'}), 404
        gps_row = conn.execute('SELECT value FROM settings WHERE key=?', (schema.SETTING_GRAMS_PER_SHOT,)).fetchone()
        grams = int(gps_row['value']) if gps_row else 17
        current = coffee_row['remaining_g'] if coffee_row['remaining_g'] is not None else 0
        new_val = max(0, current - grams)
        conn.execute('UPDATE coffees SET remaining_g=? WHERE id=?', (new_val, cid))
        row = get_coffee_by_id(conn, cid)
    return jsonify({'coffee': row, 'consumed_g': grams, 'remaining_g': new_val})


@bp.route('/api/coffees/<int:cid>', methods=['DELETE'])
@login_required
def delete_coffee(cid):
    with db_conn() as conn:
        cur = conn.execute('DELETE FROM coffees WHERE id=?', (cid,))
        if cur.rowcount == 0:
            return jsonify({'error': 'Café no encontrado'}), 404
    return jsonify({'ok': True})
