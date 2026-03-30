from flask import Blueprint, jsonify, request
from functools import wraps

bp = Blueprint('settings', __name__, url_prefix='/api')


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        from flask import session, jsonify
        if not session.get('authenticated'):
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


@bp.route('/settings')
@login_required
def get_settings():
    from extensions import db_conn
    with db_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='grams_per_shot'").fetchone()
    return jsonify({'grams_per_shot': int(row['value']) if row else 17})


@bp.route('/settings', methods=['PUT'])
@login_required
def update_settings():
    from extensions import db_conn
    data = request.get_json(silent=True) or {}
    gps = data.get('grams_per_shot')
    if gps is None:
        return jsonify({'error': 'Parámetro requerido: grams_per_shot'}), 400
    if not isinstance(gps, int) or isinstance(gps, bool) or gps <= 0 or gps > 100:
        return jsonify({'error': 'grams_per_shot debe ser un entero entre 1 y 100'}), 400
    with db_conn() as conn:
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('grams_per_shot', ?)", (str(gps),))
    return jsonify({'ok': True})
