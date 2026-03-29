from flask import Flask, request, jsonify, send_from_directory, session
import sqlite3, os, re, hashlib, secrets, functools
from datetime import datetime
from contextlib import contextmanager

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['MAX_CONTENT_LENGTH'] = 1 * 1024 * 1024  # 1 MB request size limit
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Strict'
DB = '/data/coffee.db'


def _get_secret_key():
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
        except Exception:
            pass
        return key


app.secret_key = _get_secret_key()

DATE_RE = re.compile(r'^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$')


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

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn

@contextmanager
def db_conn():
    """Context manager that commits on success, rolls back on error, and always closes."""
    conn = get_db()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def col_exists(conn, table, col):
    cols = [r[1] for r in conn.execute(f'PRAGMA table_info({table})').fetchall()]
    return col in cols

# ---------------------------------------------------------------------------
# Lookup tables
# ---------------------------------------------------------------------------

LOOKUP_TABLES = ['roasters', 'producers', 'shops', 'origins', 'regions', 'varieties', 'processes']

# Tables where the coffee relationship is many-to-many (junction table)
JUNCTION_TABLES = {
    'varieties': ('coffee_varieties', 'variety_id'),
    'processes': ('coffee_processes', 'process_id'),
}

# Tables with a direct FK on coffees
LOOKUP_FK = {
    'roasters':  'roaster_id',
    'producers': 'producer_id',
    'origins':   'origin_id',
    'regions':   'region_id',
    'shops':     'shop_id',
}

def create_lookup_tables(conn):
    for t in LOOKUP_TABLES:
        conn.execute(f'''CREATE TABLE IF NOT EXISTS {t} (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE
        )''')
    # Junction tables for many-to-many relationships
    conn.execute('''CREATE TABLE IF NOT EXISTS coffee_varieties (
        coffee_id  INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
        variety_id INTEGER NOT NULL REFERENCES varieties(id),
        PRIMARY KEY (coffee_id, variety_id)
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS coffee_processes (
        coffee_id  INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
        process_id INTEGER NOT NULL REFERENCES processes(id),
        PRIMARY KEY (coffee_id, process_id)
    )''')

def get_or_create(conn, table, name):
    if not name or not str(name).strip():
        return None
    name = str(name).strip()
    row = conn.execute(f'SELECT id FROM {table} WHERE name=? COLLATE NOCASE', (name,)).fetchone()
    if row:
        return row[0]
    cur = conn.execute(f'INSERT INTO {table} (name) VALUES (?)', (name,))
    return cur.lastrowid

# ---------------------------------------------------------------------------
# Schema + migration
# ---------------------------------------------------------------------------

def _pin_hash(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


def init_settings(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )''')
    conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('pin_hash', ?)",
        (_pin_hash('1111'),)
    )


def login_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('authenticated'):
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


def init_db():
    db_dir = os.path.dirname(DB)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    with db_conn() as conn:
        init_settings(conn)
        create_lookup_tables(conn)
        conn.execute('''CREATE TABLE IF NOT EXISTS coffees (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            roaster_id    INTEGER REFERENCES roasters(id),
            producer_id   INTEGER REFERENCES producers(id),
            origin_id     INTEGER REFERENCES origins(id),
            region_id     INTEGER REFERENCES regions(id),
            shop_id       INTEGER REFERENCES shops(id),
            quantity_g    INTEGER,
            price_kg      REAL,
            purchase_date TEXT,
            roast_date    TEXT,
            opened_date   TEXT,
            finished_date TEXT,
            rating        INTEGER,
            notes         TEXT,
            altitude      INTEGER,
            created_at    TEXT DEFAULT CURRENT_TIMESTAMP
        )''')
        migrate_v1(conn)
        migrate_v2(conn)
        if not col_exists(conn, 'coffees', 'altitude'):
            conn.execute('ALTER TABLE coffees ADD COLUMN altitude INTEGER')

def migrate_v1(conn):
    """Phase 1: migrate old text columns → FK lookup columns."""
    old_map = {
        'roaster':  ('roasters',  'roaster_id'),
        'producer': ('producers', 'producer_id'),
        'variety':  ('varieties', 'variety_id'),
        'origin':   ('origins',   'origin_id'),
        'region':   ('regions',   'region_id'),
        'process':  ('processes', 'process_id'),
        'shop':     ('shops',     'shop_id'),
    }
    if not any(col_exists(conn, 'coffees', old) for old in old_map):
        return
    print('[migration v1] Migrating text columns to lookup tables...')
    for old, (table, fk_col) in old_map.items():
        if col_exists(conn, 'coffees', old) and not col_exists(conn, 'coffees', fk_col):
            conn.execute(f'ALTER TABLE coffees ADD COLUMN {fk_col} INTEGER REFERENCES {table}(id)')
    rows = conn.execute('SELECT id, ' + ', '.join(old_map.keys()) + ' FROM coffees').fetchall()
    for row in rows:
        updates = {}
        for old, (table, fk_col) in old_map.items():
            val = row[old] if old in row.keys() else None
            if val:
                updates[fk_col] = get_or_create(conn, table, val)
        if updates:
            sets = ', '.join(f'{k}=?' for k in updates)
            conn.execute(f'UPDATE coffees SET {sets} WHERE id=?', list(updates.values()) + [row['id']])
    ver = tuple(int(x) for x in conn.execute('SELECT sqlite_version()').fetchone()[0].split('.'))
    if ver >= (3, 35, 0):
        for old in old_map:
            if col_exists(conn, 'coffees', old):
                conn.execute(f'ALTER TABLE coffees DROP COLUMN {old}')
    else:
        _rebuild_table_v1(conn)
    print('[migration v1] Done.')

def migrate_v2(conn):
    """Phase 2: variety_id/process_id → junction tables; link regions to origins."""
    needs_work = (
        col_exists(conn, 'coffees', 'variety_id') or
        col_exists(conn, 'coffees', 'process_id') or
        not col_exists(conn, 'regions', 'origin_id')
    )
    if not needs_work:
        return
    print('[migration v2] Migrating to M2M varieties/processes and region→origin link...')

    # Migrate variety_id → coffee_varieties
    if col_exists(conn, 'coffees', 'variety_id'):
        rows = conn.execute('SELECT id, variety_id FROM coffees WHERE variety_id IS NOT NULL').fetchall()
        for row in rows:
            conn.execute(
                'INSERT OR IGNORE INTO coffee_varieties (coffee_id, variety_id) VALUES (?,?)',
                (row['id'], row['variety_id'])
            )
        print(f'[migration v2]   Migrated {len(rows)} variety relations.')

    # Migrate process_id → coffee_processes
    if col_exists(conn, 'coffees', 'process_id'):
        rows = conn.execute('SELECT id, process_id FROM coffees WHERE process_id IS NOT NULL').fetchall()
        for row in rows:
            conn.execute(
                'INSERT OR IGNORE INTO coffee_processes (coffee_id, process_id) VALUES (?,?)',
                (row['id'], row['process_id'])
            )
        print(f'[migration v2]   Migrated {len(rows)} process relations.')

    # Add origin_id to regions and auto-populate from coffee data
    if not col_exists(conn, 'regions', 'origin_id'):
        conn.execute('ALTER TABLE regions ADD COLUMN origin_id INTEGER REFERENCES origins(id)')
        regions = conn.execute('SELECT id FROM regions').fetchall()
        linked = 0
        for r in regions:
            best = conn.execute('''
                SELECT origin_id, COUNT(*) cnt FROM coffees
                WHERE region_id=? AND origin_id IS NOT NULL
                GROUP BY origin_id ORDER BY cnt DESC LIMIT 1
            ''', (r['id'],)).fetchone()
            if best:
                conn.execute('UPDATE regions SET origin_id=? WHERE id=?', (best['origin_id'], r['id']))
                linked += 1
        print(f'[migration v2]   Linked {linked}/{len(regions)} regions to origins.')

    # Drop variety_id and process_id from coffees
    ver = tuple(int(x) for x in conn.execute('SELECT sqlite_version()').fetchone()[0].split('.'))
    if ver >= (3, 35, 0):
        if col_exists(conn, 'coffees', 'variety_id'):
            conn.execute('ALTER TABLE coffees DROP COLUMN variety_id')
        if col_exists(conn, 'coffees', 'process_id'):
            conn.execute('ALTER TABLE coffees DROP COLUMN process_id')
    elif col_exists(conn, 'coffees', 'variety_id') or col_exists(conn, 'coffees', 'process_id'):
        _rebuild_table_v2(conn)

    print('[migration v2] Done.')

def _rebuild_table_v1(conn):
    """Rebuild coffees without old text columns (SQLite < 3.35)."""
    conn.execute('ALTER TABLE coffees RENAME TO coffees_old')
    conn.execute('''CREATE TABLE coffees (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        roaster_id INTEGER REFERENCES roasters(id),
        producer_id INTEGER REFERENCES producers(id),
        variety_id INTEGER REFERENCES varieties(id),
        origin_id INTEGER REFERENCES origins(id),
        region_id INTEGER REFERENCES regions(id),
        process_id INTEGER REFERENCES processes(id),
        shop_id INTEGER REFERENCES shops(id),
        quantity_g INTEGER, price_kg REAL,
        purchase_date TEXT, roast_date TEXT, opened_date TEXT, finished_date TEXT,
        rating INTEGER, notes TEXT, altitude INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.execute('''INSERT INTO coffees
        (id,name,roaster_id,producer_id,variety_id,origin_id,region_id,process_id,shop_id,
         quantity_g,price_kg,purchase_date,roast_date,opened_date,finished_date,rating,notes,created_at)
        SELECT id,name,roaster_id,producer_id,variety_id,origin_id,region_id,process_id,shop_id,
               quantity_g,price_kg,purchase_date,roast_date,opened_date,finished_date,rating,notes,created_at
        FROM coffees_old''')
    conn.execute('DROP TABLE coffees_old')

def _rebuild_table_v2(conn):
    """Rebuild coffees without variety_id/process_id columns (SQLite < 3.35)."""
    conn.execute('ALTER TABLE coffees RENAME TO coffees_old')
    conn.execute('''CREATE TABLE coffees (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        roaster_id INTEGER REFERENCES roasters(id),
        producer_id INTEGER REFERENCES producers(id),
        origin_id INTEGER REFERENCES origins(id),
        region_id INTEGER REFERENCES regions(id),
        shop_id INTEGER REFERENCES shops(id),
        quantity_g INTEGER, price_kg REAL,
        purchase_date TEXT, roast_date TEXT, opened_date TEXT, finished_date TEXT,
        rating INTEGER, notes TEXT, altitude INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.execute('''INSERT INTO coffees
        (id,name,roaster_id,producer_id,origin_id,region_id,shop_id,
         quantity_g,price_kg,purchase_date,roast_date,opened_date,finished_date,rating,notes,altitude,created_at)
        SELECT id,name,roaster_id,producer_id,origin_id,region_id,shop_id,
               quantity_g,price_kg,purchase_date,roast_date,opened_date,finished_date,rating,notes,altitude,created_at
        FROM coffees_old''')
    conn.execute('DROP TABLE coffees_old')

# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

COFFEE_SELECT = '''
    SELECT c.id, c.name, c.quantity_g, c.price_kg, c.altitude,
           c.purchase_date, c.roast_date, c.opened_date, c.finished_date,
           c.rating, c.notes, c.created_at,
           c.roaster_id,  ro.name AS roaster,
           c.producer_id, p.name  AS producer,
           c.origin_id,   o.name  AS origin,
           c.region_id,   rg.name AS region,
           c.shop_id,     s.name  AS shop,
           (SELECT GROUP_CONCAT(v.name, '|||')
            FROM coffee_varieties cv JOIN varieties v ON cv.variety_id=v.id
            WHERE cv.coffee_id=c.id) AS varieties_str,
           (SELECT GROUP_CONCAT(v.id)
            FROM coffee_varieties cv JOIN varieties v ON cv.variety_id=v.id
            WHERE cv.coffee_id=c.id) AS variety_ids_str,
           (SELECT GROUP_CONCAT(pr.name, '|||')
            FROM coffee_processes cp JOIN processes pr ON cp.process_id=pr.id
            WHERE cp.coffee_id=c.id) AS processes_str,
           (SELECT GROUP_CONCAT(pr.id)
            FROM coffee_processes cp JOIN processes pr ON cp.process_id=pr.id
            WHERE cp.coffee_id=c.id) AS process_ids_str
    FROM coffees c
    LEFT JOIN roasters  ro ON c.roaster_id  = ro.id
    LEFT JOIN producers p  ON c.producer_id = p.id
    LEFT JOIN origins   o  ON c.origin_id   = o.id
    LEFT JOIN regions   rg ON c.region_id   = rg.id
    LEFT JOIN shops     s  ON c.shop_id     = s.id
'''

def row_to_coffee(row):
    d = dict(row)
    vs  = d.pop('varieties_str')   or ''
    vis = d.pop('variety_ids_str') or ''
    ps  = d.pop('processes_str')   or ''
    pis = d.pop('process_ids_str') or ''
    d['varieties']   = [v for v in vs.split('|||')  if v]
    d['variety_ids'] = [int(i) for i in vis.split(',') if i]
    d['processes']   = [p for p in ps.split('|||')  if p]
    d['process_ids'] = [int(i) for i in pis.split(',') if i]
    return d

def set_m2m(conn, coffee_id, values, lookup_table, junction_table, fk_col):
    """Replace all m2m relations for a coffee with the given list of names."""
    conn.execute(f'DELETE FROM {junction_table} WHERE coffee_id=?', (coffee_id,))
    if not values:
        return
    if isinstance(values, str):
        values = [v.strip() for v in values.split(',') if v.strip()]
    for name in values:
        ref_id = get_or_create(conn, lookup_table, name)
        if ref_id:
            conn.execute(
                f'INSERT OR IGNORE INTO {junction_table} (coffee_id, {fk_col}) VALUES (?,?)',
                (coffee_id, ref_id)
            )

def resolve_ids(conn, data):
    origin_id = get_or_create(conn, 'origins', data.get('origin'))
    region_id = get_or_create(conn, 'regions', data.get('region'))
    # Auto-link region to origin if both provided and region not yet linked
    if region_id and origin_id:
        conn.execute(
            'UPDATE regions SET origin_id=? WHERE id=? AND origin_id IS NULL',
            (origin_id, region_id)
        )
    return {
        'roaster_id':  get_or_create(conn, 'roasters',  data.get('roaster')),
        'producer_id': get_or_create(conn, 'producers', data.get('producer')),
        'origin_id':   origin_id,
        'region_id':   region_id,
        'shop_id':     get_or_create(conn, 'shops',     data.get('shop')),
    }

SCALAR_FIELDS = ['name', 'quantity_g', 'price_kg', 'purchase_date', 'roast_date',
                 'opened_date', 'finished_date', 'rating', 'notes', 'altitude']

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

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
    for field in ['varieties', 'processes']:
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

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return send_from_directory('templates', 'index.html')


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@app.route('/api/auth/status')
def auth_status():
    return jsonify({'authenticated': bool(session.get('authenticated'))})


@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    data = request.get_json(silent=True) or {}
    pin = str(data.get('pin', ''))
    with db_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='pin_hash'").fetchone()
    if row and _pin_hash(pin) == row['value']:
        session['authenticated'] = True
        return jsonify({'ok': True})
    return jsonify({'error': 'PIN incorrecto'}), 401


@app.route('/api/auth/change-pin', methods=['POST'])
@login_required
def auth_change_pin():
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


@app.route('/api/lookup-tables')
@login_required
def get_lookup_tables():
    """Exposes the canonical list of lookup tables so the frontend stays in sync."""
    return jsonify(LOOKUP_TABLES)


@app.route('/api/options')
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


@app.route('/api/coffees')
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
        q = f'%{args["q"].strip()}%'
        where.append('(c.name LIKE ? OR ro.name LIKE ? OR c.notes LIKE ? OR o.name LIKE ?)')
        vals.extend([q, q, q, q])
    sql = COFFEE_SELECT + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY c.created_at DESC'
    with db_conn() as conn:
        rows = conn.execute(sql, vals).fetchall()
    return jsonify([row_to_coffee(r) for r in rows])


@app.route('/api/coffees', methods=['POST'])
@login_required
def add_coffee():
    data = request.get_json(silent=True)
    err = validate_coffee(data)
    if err:
        return jsonify({'error': err}), 400
    with db_conn() as conn:
        ids = resolve_ids(conn, data)
        fields = list(ids.keys()) + SCALAR_FIELDS
        vals   = list(ids.values()) + [data.get(f) for f in SCALAR_FIELDS]
        cur = conn.execute(
            f"INSERT INTO coffees ({','.join(fields)}) VALUES ({','.join(['?']*len(fields))})", vals)
        cid = cur.lastrowid
        set_m2m(conn, cid, data.get('varieties'), 'varieties', 'coffee_varieties', 'variety_id')
        set_m2m(conn, cid, data.get('processes'), 'processes', 'coffee_processes', 'process_id')
        row = row_to_coffee(conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone())
    return jsonify(row), 201


@app.route('/api/coffees/<int:cid>', methods=['PUT'])
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
        set_m2m(conn, cid, data.get('varieties'), 'varieties', 'coffee_varieties', 'variety_id')
        set_m2m(conn, cid, data.get('processes'), 'processes', 'coffee_processes', 'process_id')
        row = row_to_coffee(conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone())
    return jsonify(row)


@app.route('/api/coffees/<int:cid>/open', methods=['POST'])
@login_required
def open_coffee(cid):
    data = request.get_json(silent=True) or {}
    date = data.get('date') or datetime.now().strftime('%Y-%m-%d')
    if not isinstance(date, str) or not DATE_RE.match(date):
        return jsonify({'error': 'Formato de fecha inválido (esperado YYYY-MM-DD)'}), 400
    with db_conn() as conn:
        conn.execute('UPDATE coffees SET opened_date=? WHERE id=?', (date, cid))
        row = row_to_coffee(conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone())
    return jsonify(row)


@app.route('/api/coffees/<int:cid>/finish', methods=['POST'])
@login_required
def finish_coffee(cid):
    today = datetime.now().strftime('%Y-%m-%d')
    with db_conn() as conn:
        conn.execute('UPDATE coffees SET finished_date=? WHERE id=?', (today, cid))
        row = row_to_coffee(conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone())
    return jsonify(row)


@app.route('/api/coffees/<int:cid>/unrate', methods=['POST'])
@login_required
def unrate_coffee(cid):
    with db_conn() as conn:
        conn.execute('UPDATE coffees SET rating=NULL WHERE id=?', (cid,))
        row = row_to_coffee(conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone())
    return jsonify(row)


@app.route('/api/coffees/<int:cid>', methods=['DELETE'])
@login_required
def delete_coffee(cid):
    with db_conn() as conn:
        conn.execute('DELETE FROM coffees WHERE id=?', (cid,))
    return jsonify({'ok': True})


@app.route('/api/stats')
@login_required
def stats():
    with db_conn() as conn:
        total    = conn.execute('SELECT COUNT(*) FROM coffees').fetchone()[0]
        finished = conn.execute("SELECT COUNT(*) FROM coffees WHERE finished_date IS NOT NULL AND finished_date!=''").fetchone()[0]
        active   = conn.execute("SELECT COUNT(*) FROM coffees WHERE opened_date IS NOT NULL AND opened_date!='' AND (finished_date IS NULL OR finished_date='')").fetchone()[0]
        avg_r    = conn.execute('SELECT AVG(rating) FROM coffees WHERE rating IS NOT NULL').fetchone()[0]
        spent    = conn.execute('SELECT SUM(quantity_g/1000.0*price_kg) FROM coffees WHERE price_kg IS NOT NULL AND quantity_g IS NOT NULL').fetchone()[0]
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
        'avg_rating': round(avg_r, 1) if avg_r else None,
        'total_spent': round(spent, 2) if spent else 0,
        'days_per_kg': round(days_per_kg, 1) if days_per_kg else None,
        'top_roasters': [{'name': r['name'], 'cnt': r['cnt'], 'avg_rating': round(r['avg_rating'], 1) if r['avg_rating'] else None} for r in top_roasters],
        'origins_breakdown': [{'name': r['name'], 'cnt': r['cnt'], 'avg_rating': round(r['avg_rating'], 1) if r['avg_rating'] else None} for r in origins_bd],
        'processes_breakdown': [{'name': r['name'], 'cnt': r['cnt'], 'avg_rating': round(r['avg_rating'], 1) if r['avg_rating'] else None} for r in processes_bd],
        'varieties_breakdown': [{'name': r['name'], 'cnt': r['cnt'], 'avg_rating': round(r['avg_rating'], 1) if r['avg_rating'] else None} for r in varieties_bd],
    })


# Lookup management
@app.route('/api/lookup/<table>')
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

@app.route('/api/lookup/<table>/<int:lid>', methods=['PUT'])
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

@app.route('/api/lookup/<table>/<int:lid>', methods=['DELETE'])
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

@app.route('/api/lookup/<table>/purge', methods=['POST'])
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


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)
