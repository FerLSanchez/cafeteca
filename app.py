import os
import secrets
from flask import Flask, send_from_directory

from config import DB, SECRET_KEY_PATH
from extensions import get_db
from migrations import init_db
from blueprints import auth_bp, coffees_bp, lookup_bp, settings_bp


def _get_secret_key():
    try:
        with open(SECRET_KEY_PATH) as f:
            return f.read().strip()
    except FileNotFoundError:
        key = secrets.token_hex(32)
        try:
            data_dir = os.path.dirname(SECRET_KEY_PATH) or '.'
            os.makedirs(data_dir, exist_ok=True)
            with open(SECRET_KEY_PATH, 'w') as f:
                f.write(key)
        except Exception:
            pass
        return key


def create_app():
    app = Flask(__name__, static_folder='static', template_folder='templates')
    app.config['MAX_CONTENT_LENGTH'] = 1 * 1024 * 1024
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Strict'
    app.secret_key = _get_secret_key()

    @app.after_request
    def add_security_headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src https://fonts.gstatic.com; "
            "script-src 'self' 'unsafe-inline'; "
            "connect-src 'self'; "
            "img-src 'self' data:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        return response

    app.register_blueprint(auth_bp)
    app.register_blueprint(coffees_bp)
    app.register_blueprint(lookup_bp)
    app.register_blueprint(settings_bp)

    @app.route('/')
    def index():
        return send_from_directory('templates', 'index.html')

    @app.route('/sw.js')
    def service_worker():
        return send_from_directory('static', 'sw.js', mimetype='application/javascript')

    return app


app = create_app()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)
