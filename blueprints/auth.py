from flask import Blueprint, jsonify, request, session
import hashlib

bp = Blueprint('auth', __name__, url_prefix='/api/auth')


def _pin_hash(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


@bp.route('/status')
def auth_status():
    from extensions import db_conn
    return jsonify({'authenticated': bool(session.get('authenticated'))})


@bp.route('/login', methods=['POST'])
def auth_login():
    from extensions import db_conn
    data = request.get_json(silent=True) or {}
    pin = str(data.get('pin', ''))
    with db_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='pin_hash'").fetchone()
    if row and _pin_hash(pin) == row['value']:
        session['authenticated'] = True
        return jsonify({'ok': True})
    return jsonify({'error': 'PIN incorrecto'}), 401


@bp.route('/change-pin', methods=['POST'])
def auth_change_pin():
    from extensions import db_conn
    from functools import wraps
    def login_required(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if not session.get('authenticated'):
                return jsonify({'error': 'Unauthorized'}), 401
            return f(*args, **kwargs)
        return decorated

    if not session.get('authenticated'):
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json(silent=True) or {}
    current = str(data.get('current_pin', ''))
    new_pin = str(data.get('new_pin', ''))
    if not new_pin.isdigit() or len(new_pin) != 4:
        return jsonify({'error': 'El nuevo PIN debe ser 4 dígitos'}), 400
    with db_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='pin_hash'").fetchone()
        if not row or _pin_hash(current) != row['value']:
            return jsonify({'error': 'PIN actual incorrecto'}), 401
        conn.execute("UPDATE settings SET value=? WHERE key='pin_hash'", (_pin_hash(new_pin),))
    return jsonify({'ok': True})
