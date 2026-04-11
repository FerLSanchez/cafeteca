from flask import Blueprint, request, jsonify
from db import db_conn
from lookup_config import LOOKUP_TABLES
from schema import login_required, SETTING_GRAMS_PER_SHOT

bp = Blueprint('settings', __name__)


@bp.route('/api/lookup-tables')
@login_required
def get_lookup_tables():
    """Exposes the canonical list of lookup tables so the frontend stays in sync."""
    return jsonify(LOOKUP_TABLES)


@bp.route('/api/options')
@login_required
def options():
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


@bp.route('/api/settings')
@login_required
def get_settings():
    with db_conn() as conn:
        row = conn.execute('SELECT value FROM settings WHERE key=?', (SETTING_GRAMS_PER_SHOT,)).fetchone()
    return jsonify({'grams_per_shot': int(row['value']) if row else 17})


@bp.route('/api/settings', methods=['PUT'])
@login_required
def update_settings():
    data = request.get_json(silent=True) or {}
    gps = data.get('grams_per_shot')
    if gps is None:
        return jsonify({'error': 'Parámetro requerido: grams_per_shot', 'error_key': 'error.settings.grams_required'}), 400
    if not isinstance(gps, int) or isinstance(gps, bool) or gps <= 0 or gps > 100:
        return jsonify({'error': 'grams_per_shot debe ser un entero entre 1 y 100', 'error_key': 'error.settings.grams_invalid'}), 400
    with db_conn() as conn:
        conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (SETTING_GRAMS_PER_SHOT, str(gps)))
    return jsonify({'ok': True})
