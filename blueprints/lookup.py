from flask import Blueprint, request, jsonify
from db import db_conn
from lookup_config import LOOKUP_TABLES, JUNCTION_TABLES, LOOKUP_FK
from schema import login_required

bp = Blueprint('lookup', __name__)


@bp.route('/api/lookup/<table>')
@login_required
def lookup_list(table):
    if table not in LOOKUP_TABLES:
        return jsonify({'error': 'Unknown table'}), 404
    with db_conn() as conn:
        if table in JUNCTION_TABLES:
            jt, fk = JUNCTION_TABLES[table]
            rows = conn.execute(f'''
                SELECT t.id, t.name, COUNT(jt.coffee_id) AS coffee_count
                FROM {table} t LEFT JOIN {jt} jt ON jt.{fk}=t.id
                GROUP BY t.id ORDER BY t.name COLLATE NOCASE
            ''').fetchall()
        elif table == 'regions':
            rows = conn.execute('''
                SELECT r.id, r.name, r.origin_id, o.name AS origin_name,
                       COUNT(c.id) AS coffee_count
                FROM regions r
                LEFT JOIN origins o ON r.origin_id=o.id
                LEFT JOIN coffees c ON c.region_id=r.id
                GROUP BY r.id ORDER BY r.name COLLATE NOCASE
            ''').fetchall()
        else:
            fk = LOOKUP_FK[table]
            rows = conn.execute(f'''
                SELECT t.id, t.name, COUNT(c.id) AS coffee_count
                FROM {table} t LEFT JOIN coffees c ON c.{fk}=t.id
                GROUP BY t.id ORDER BY t.name COLLATE NOCASE
            ''').fetchall()
    return jsonify([dict(r) for r in rows])


@bp.route('/api/lookup/<table>/<int:lid>', methods=['PUT'])
@login_required
def lookup_rename(table, lid):
    if table not in LOOKUP_TABLES:
        return jsonify({'error': 'Unknown table'}), 404
    name = (request.json or {}).get('name', '').strip()
    if not name:
        return jsonify({'error': 'Name required'}), 400
    with db_conn() as conn:
        existing = conn.execute(f'SELECT id FROM {table} WHERE name=? COLLATE NOCASE AND id!=?', (name, lid)).fetchone()
        if existing:
            return jsonify({'error': 'Ya existe una entrada con ese nombre'}), 409
        conn.execute(f'UPDATE {table} SET name=? WHERE id=?', (name, lid))
    return jsonify({'ok': True})


@bp.route('/api/lookup/<table>/<int:lid>', methods=['DELETE'])
@login_required
def lookup_delete(table, lid):
    if table not in LOOKUP_TABLES:
        return jsonify({'error': 'Unknown table'}), 404
    with db_conn() as conn:
        if table in JUNCTION_TABLES:
            jt, fk = JUNCTION_TABLES[table]
            count = conn.execute(f'SELECT COUNT(*) FROM {jt} WHERE {fk}=?', (lid,)).fetchone()[0]
        else:
            fk = LOOKUP_FK[table]
            count = conn.execute(f'SELECT COUNT(*) FROM coffees WHERE {fk}=?', (lid,)).fetchone()[0]
        if count > 0:
            return jsonify({'error': f'En uso por {count} café(s)'}), 409
        conn.execute(f'DELETE FROM {table} WHERE id=?', (lid,))
    return jsonify({'ok': True})


@bp.route('/api/lookup/<table>/purge', methods=['POST'])
@login_required
def lookup_purge(table):
    """Delete all orphan entries (coffee_count = 0) from a table."""
    if table not in LOOKUP_TABLES:
        return jsonify({'error': 'Unknown table'}), 404
    with db_conn() as conn:
        if table in JUNCTION_TABLES:
            jt, fk = JUNCTION_TABLES[table]
            cur = conn.execute(f'DELETE FROM {table} WHERE id NOT IN (SELECT DISTINCT {fk} FROM {jt})')
        else:
            fk = LOOKUP_FK[table]
            cur = conn.execute(f'DELETE FROM {table} WHERE id NOT IN (SELECT DISTINCT {fk} FROM coffees WHERE {fk} IS NOT NULL)')
        deleted = cur.rowcount
    return jsonify({'deleted': deleted})
