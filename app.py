import os, secrets, logging
from flask import Flask, send_from_directory
from schema import init_db
from blueprints.auth import bp as auth_bp
from blueprints.coffees import bp as coffees_bp
from blueprints.stats import bp as stats_bp
from blueprints.settings import bp as settings_bp
from blueprints.lookup import bp as lookup_bp

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['MAX_CONTENT_LENGTH'] = 1 * 1024 * 1024  # 1 MB request size limit
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Strict'


def _get_secret_key():
    from db import DB
    data_dir = os.path.dirname(DB) or '.'
    key_path = os.path.join(data_dir, 'secret_key')
    try:
        with open(key_path) as f:
            return f.read().strip()
    except FileNotFoundError:
        key = secrets.token_hex(32)
        try:
            os.makedirs(data_dir, exist_ok=True)
            with open(key_path, 'w') as f:
                f.write(key)
        except Exception as e:
            logging.warning(
                '[secret_key] No se pudo persistir la clave secreta en disco: %s. '
                'La clave cambiará en cada reinicio e invalidará las sesiones activas.', e
            )
        return key


app.secret_key = _get_secret_key()

app.register_blueprint(auth_bp)
app.register_blueprint(coffees_bp)
app.register_blueprint(stats_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(lookup_bp)


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
        "manifest-src 'self'; "
        "worker-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    )
    return response


@app.route('/')
def index():
    return send_from_directory('templates', 'index.html')


@app.route('/sw.js')
def service_worker():
    response = send_from_directory('static', 'sw.js', mimetype='application/javascript')
    response.headers['Cache-Control'] = 'no-cache'
    return response


@app.route('/manifest.json')
def manifest():
    response = send_from_directory('static', 'manifest.json', mimetype='application/manifest+json')
    response.headers['Cache-Control'] = 'no-cache'
    return response


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)
