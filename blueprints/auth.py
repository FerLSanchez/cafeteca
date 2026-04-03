import secrets, time
from flask import Blueprint, request, jsonify, session
from db import db_conn
from schema import _pin_hash, login_required, SETTING_PIN_HASH

bp = Blueprint('auth', __name__)


@bp.route('/api/auth/status')
def auth_status():
    return jsonify({'authenticated': bool(session.get('authenticated'))})


@bp.route('/api/auth/login', methods=['POST'])
def auth_login():
    data = request.get_json(silent=True) or {}
    pin = str(data.get('pin', ''))
    with db_conn() as conn:
        row = conn.execute('SELECT value FROM settings WHERE key=?', (SETTING_PIN_HASH,)).fetchone()
    if row and secrets.compare_digest(_pin_hash(pin), row['value']):
        session['authenticated'] = True
        return jsonify({'ok': True})
    time.sleep(0.5)
    return jsonify({'error': 'PIN incorrecto'}), 401


@bp.route('/api/auth/change-pin', methods=['POST'])
@login_required
def auth_change_pin():
    data = request.get_json(silent=True) or {}
    current = str(data.get('current_pin', ''))
    new_pin = str(data.get('new_pin', ''))
    if not new_pin.isdigit() or len(new_pin) != 4:
        return jsonify({'error': 'El nuevo PIN debe ser 4 dígitos'}), 400
    with db_conn() as conn:
        row = conn.execute('SELECT value FROM settings WHERE key=?', (SETTING_PIN_HASH,)).fetchone()
        if not row or not secrets.compare_digest(_pin_hash(current), row['value']):
            return jsonify({'error': 'PIN actual incorrecto'}), 401
        conn.execute('UPDATE settings SET value=? WHERE key=?', (_pin_hash(new_pin), SETTING_PIN_HASH))
    return jsonify({'ok': True})
