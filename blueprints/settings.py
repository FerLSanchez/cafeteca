from flask import Blueprint, request, jsonify
from db import db_conn
from lookup_config import LOOKUP_TABLES
from schema import SETTING_GRAMS_PER_SHOT, SETTING_LOW_STOCK_THRESHOLD, SETTING_FLOW_TOLERANCE, SETTING_GRIND_STEP

bp = Blueprint('settings', __name__)


@bp.route('/api/lookup-tables')
def get_lookup_tables():
    """Exposes the canonical list of lookup tables so the frontend stays in sync."""
    return jsonify(LOOKUP_TABLES)


@bp.route('/api/options')
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
def get_settings():
    with db_conn() as conn:
        gps_row = conn.execute('SELECT value FROM settings WHERE key=?', (SETTING_GRAMS_PER_SHOT,)).fetchone()
        lst_row = conn.execute('SELECT value FROM settings WHERE key=?', (SETTING_LOW_STOCK_THRESHOLD,)).fetchone()
        tol_row = conn.execute('SELECT value FROM settings WHERE key=?', (SETTING_FLOW_TOLERANCE,)).fetchone()
        gs_row = conn.execute('SELECT value FROM settings WHERE key=?', (SETTING_GRIND_STEP,)).fetchone()
    return jsonify({
        'grams_per_shot': int(gps_row['value']) if gps_row else 17,
        'low_stock_threshold': int(lst_row['value']) if lst_row else 5,
        'flow_tolerance': float(tol_row['value']) if tol_row else 0.2,
        'grind_step': float(gs_row['value']) if gs_row else 1,
    })


@bp.route('/api/settings', methods=['PUT'])
def update_settings():
    data = request.get_json(silent=True) or {}
    gps = data.get('grams_per_shot')
    lst = data.get('low_stock_threshold')
    tol = data.get('flow_tolerance')
    gs = data.get('grind_step')
    if gps is None and lst is None and tol is None and gs is None:
        return jsonify({'error': 'Parámetro requerido: grams_per_shot', 'error_key': 'error.settings.grams_required'}), 400
    if gps is not None:
        if not isinstance(gps, int) or isinstance(gps, bool) or gps <= 0 or gps > 100:
            return jsonify({'error': 'grams_per_shot debe ser un entero entre 1 y 100', 'error_key': 'error.settings.grams_invalid'}), 400
    if lst is not None:
        if not isinstance(lst, int) or isinstance(lst, bool) or lst < 1 or lst > 50:
            return jsonify({'error': 'low_stock_threshold debe ser un entero entre 1 y 50', 'error_key': 'error.settings.threshold_invalid'}), 400
    if tol is not None:
        if not isinstance(tol, (int, float)) or isinstance(tol, bool) or tol < 0.05 or tol > 1:
            return jsonify({'error': 'flow_tolerance debe estar entre 0.05 y 1', 'error_key': 'error.settings.flow_tolerance_invalid'}), 400
    if gs is not None:
        if not isinstance(gs, (int, float)) or isinstance(gs, bool) or gs < 0.1 or gs > 5:
            return jsonify({'error': 'grind_step debe estar entre 0.1 y 5', 'error_key': 'error.settings.grind_step_invalid'}), 400
    with db_conn() as conn:
        if gs is not None:
            conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (SETTING_GRIND_STEP, str(gs)))
        if tol is not None:
            conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (SETTING_FLOW_TOLERANCE, str(tol)))
        if gps is not None:
            conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (SETTING_GRAMS_PER_SHOT, str(gps)))
        if lst is not None:
            conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (SETTING_LOW_STOCK_THRESHOLD, str(lst)))
    return jsonify({'ok': True})
