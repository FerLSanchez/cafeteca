import os, hashlib, functools, logging
from flask import session, jsonify
from db import DB, db_conn, col_exists
from lookup_config import create_lookup_tables, get_or_create

SETTING_PIN_HASH           = 'pin_hash'
SETTING_GRAMS_PER_SHOT     = 'grams_per_shot'
SETTING_LOW_STOCK_THRESHOLD = 'low_stock_threshold'

FTS_ENABLED = False


def _pin_hash(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


def init_settings(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )''')
    conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
        (SETTING_PIN_HASH, _pin_hash('1111'))
    )
    conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, '17')", (SETTING_GRAMS_PER_SHOT,))
    conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, '5')", (SETTING_LOW_STOCK_THRESHOLD,))


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
            remaining_g   INTEGER,
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
        migrate_v3(conn)
        migrate_v4(conn)
        migrate_v5(conn)
        migrate_v6(conn)
        migrate_v7(conn)
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
    logging.info('[migration v1] Migrating text columns to lookup tables...')
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
    logging.info('[migration v1] Done.')


def migrate_v2(conn):
    """Phase 2: variety_id/process_id → junction tables; link regions to origins."""
    needs_work = (
        col_exists(conn, 'coffees', 'variety_id') or
        col_exists(conn, 'coffees', 'process_id') or
        not col_exists(conn, 'regions', 'origin_id')
    )
    if not needs_work:
        return
    logging.info('[migration v2] Migrating to M2M varieties/processes and region→origin link...')

    if col_exists(conn, 'coffees', 'variety_id'):
        rows = conn.execute('SELECT id, variety_id FROM coffees WHERE variety_id IS NOT NULL').fetchall()
        for row in rows:
            conn.execute(
                'INSERT OR IGNORE INTO coffee_varieties (coffee_id, variety_id) VALUES (?,?)',
                (row['id'], row['variety_id'])
            )
        logging.info('[migration v2]   Migrated %d variety relations.', len(rows))

    if col_exists(conn, 'coffees', 'process_id'):
        rows = conn.execute('SELECT id, process_id FROM coffees WHERE process_id IS NOT NULL').fetchall()
        for row in rows:
            conn.execute(
                'INSERT OR IGNORE INTO coffee_processes (coffee_id, process_id) VALUES (?,?)',
                (row['id'], row['process_id'])
            )
        logging.info('[migration v2]   Migrated %d process relations.', len(rows))

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
        logging.info('[migration v2]   Linked %d/%d regions to origins.', linked, len(regions))

    ver = tuple(int(x) for x in conn.execute('SELECT sqlite_version()').fetchone()[0].split('.'))
    if ver >= (3, 35, 0):
        if col_exists(conn, 'coffees', 'variety_id'):
            conn.execute('ALTER TABLE coffees DROP COLUMN variety_id')
        if col_exists(conn, 'coffees', 'process_id'):
            conn.execute('ALTER TABLE coffees DROP COLUMN process_id')
    elif col_exists(conn, 'coffees', 'variety_id') or col_exists(conn, 'coffees', 'process_id'):
        _rebuild_table_v2(conn)

    logging.info('[migration v2] Done.')


def migrate_v3(conn):
    """Phase 3: add milk_types M2M and pre-populate default values."""
    for name in ['Avena', 'Arroz', 'Almendras', 'Soja', 'Coco', 'Avellanas']:
        conn.execute("INSERT OR IGNORE INTO milk_types (name) VALUES (?)", (name,))


def migrate_v4(conn):
    """Phase 4: add remaining_g column, default to quantity_g for existing rows."""
    if not col_exists(conn, 'coffees', 'remaining_g'):
        conn.execute('ALTER TABLE coffees ADD COLUMN remaining_g INTEGER')
        conn.execute('UPDATE coffees SET remaining_g=quantity_g WHERE remaining_g IS NULL AND quantity_g IS NOT NULL')
        logging.info('[migration v4] Added remaining_g column.')


def migrate_v5(conn):
    """Phase 5: FTS5 full-text search index on name and notes."""
    global FTS_ENABLED
    fts_exists = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='coffees_fts'"
    ).fetchone()
    if fts_exists:
        FTS_ENABLED = True
        return
    try:
        conn.execute('''
            CREATE VIRTUAL TABLE coffees_fts USING fts5(
                name, notes,
                content='coffees',
                content_rowid='id',
                tokenize='unicode61'
            )
        ''')
        conn.execute(
            "INSERT INTO coffees_fts(rowid, name, notes) "
            "SELECT id, name, COALESCE(notes, '') FROM coffees"
        )
        conn.execute('''
            CREATE TRIGGER coffees_fts_ai AFTER INSERT ON coffees BEGIN
                INSERT INTO coffees_fts(rowid, name, notes)
                VALUES (new.id, new.name, COALESCE(new.notes, ''));
            END
        ''')
        conn.execute('''
            CREATE TRIGGER coffees_fts_au AFTER UPDATE ON coffees BEGIN
                INSERT INTO coffees_fts(coffees_fts, rowid, name, notes)
                VALUES('delete', old.id, old.name, COALESCE(old.notes, ''));
                INSERT INTO coffees_fts(rowid, name, notes)
                VALUES (new.id, new.name, COALESCE(new.notes, ''));
            END
        ''')
        conn.execute('''
            CREATE TRIGGER coffees_fts_ad AFTER DELETE ON coffees BEGIN
                INSERT INTO coffees_fts(coffees_fts, rowid, name, notes)
                VALUES('delete', old.id, old.name, COALESCE(old.notes, ''));
            END
        ''')
        FTS_ENABLED = True
        logging.info('[migration v5] FTS5 full-text search index created.')
    except Exception as e:
        logging.warning('[migration v5] FTS5 no disponible (%s). La búsqueda usará LIKE.', e)


def migrate_v6(conn):
    """Phase 6: shared recipes and brews with M2N junction tables."""
    conn.execute('''CREATE TABLE IF NOT EXISTS recipes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        dose_g     REAL,
        yield_g    REAL,
        grind      INTEGER,
        temp_c     INTEGER,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS coffee_recipes (
        coffee_id  INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
        recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        PRIMARY KEY (coffee_id, recipe_id)
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS brews (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        brew_date  TEXT DEFAULT (date('now')),
        dose_g     REAL,
        yield_g    REAL,
        grind      INTEGER,
        temp_c     INTEGER,
        rating     INTEGER CHECK(rating BETWEEN 1 AND 5),
        notes      TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS coffee_brews (
        coffee_id  INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
        brew_id    INTEGER NOT NULL REFERENCES brews(id) ON DELETE CASCADE,
        PRIMARY KEY (coffee_id, brew_id)
    )''')
    logging.info('[migration v6] recipes and brews tables ready.')


def migrate_v7(conn):
    """Phase 7: add time_s (extraction time in seconds) to recipes and brews."""
    for table in ('recipes', 'brews'):
        cols = [r[1] for r in conn.execute(f'PRAGMA table_info({table})').fetchall()]
        if 'time_s' not in cols:
            conn.execute(f'ALTER TABLE {table} ADD COLUMN time_s INTEGER')
            logging.info('[migration v7] Added time_s to %s.', table)


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
