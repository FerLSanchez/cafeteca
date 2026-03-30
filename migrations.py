from extensions import db_conn, col_exists
from models import get_or_create


def create_lookup_tables(conn):
    from config import LOOKUP_TABLES, JUNCTION_TABLES
    for t in LOOKUP_TABLES:
        conn.execute(f'''CREATE TABLE IF NOT EXISTS {t} (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE
        )''')
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
    conn.execute('''CREATE TABLE IF NOT EXISTS coffee_milk_types (
        coffee_id    INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
        milk_type_id INTEGER NOT NULL REFERENCES milk_types(id),
        PRIMARY KEY (coffee_id, milk_type_id)
    )''')


def create_coffees_table(conn):
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


def init_settings(conn):
    import hashlib
    conn.execute('''CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )''')
    default_pin_hash = hashlib.sha256('1111'.encode()).hexdigest()
    conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('pin_hash', ?)",
        (default_pin_hash,)
    )
    conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('grams_per_shot', '17')")


def migrate_v1(conn):
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
    needs_work = (
        col_exists(conn, 'coffees', 'variety_id') or
        col_exists(conn, 'coffees', 'process_id') or
        not col_exists(conn, 'regions', 'origin_id')
    )
    if not needs_work:
        return
    print('[migration v2] Migrating to M2M varieties/processes and region→origin link...')

    if col_exists(conn, 'coffees', 'variety_id'):
        rows = conn.execute('SELECT id, variety_id FROM coffees WHERE variety_id IS NOT NULL').fetchall()
        for row in rows:
            conn.execute(
                'INSERT OR IGNORE INTO coffee_varieties (coffee_id, variety_id) VALUES (?,?)',
                (row['id'], row['variety_id'])
            )
        print(f'[migration v2]   Migrated {len(rows)} variety relations.')

    if col_exists(conn, 'coffees', 'process_id'):
        rows = conn.execute('SELECT id, process_id FROM coffees WHERE process_id IS NOT NULL').fetchall()
        for row in rows:
            conn.execute(
                'INSERT OR IGNORE INTO coffee_processes (coffee_id, process_id) VALUES (?,?)',
                (row['id'], row['process_id'])
            )
        print(f'[migration v2]   Migrated {len(rows)} process relations.')

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

    ver = tuple(int(x) for x in conn.execute('SELECT sqlite_version()').fetchone()[0].split('.'))
    if ver >= (3, 35, 0):
        if col_exists(conn, 'coffees', 'variety_id'):
            conn.execute('ALTER TABLE coffees DROP COLUMN variety_id')
        if col_exists(conn, 'coffees', 'process_id'):
            conn.execute('ALTER TABLE coffees DROP COLUMN process_id')
    elif col_exists(conn, 'coffees', 'variety_id') or col_exists(conn, 'coffees', 'process_id'):
        _rebuild_table_v2(conn)

    print('[migration v2] Done.')


def migrate_v3(conn):
    for name in ['Avena', 'Arroz', 'Almendras', 'Soja', 'Coco', 'Avellanas']:
        conn.execute("INSERT OR IGNORE INTO milk_types (name) VALUES (?)", (name,))


def migrate_v4(conn):
    if not col_exists(conn, 'coffees', 'remaining_g'):
        conn.execute('ALTER TABLE coffees ADD COLUMN remaining_g INTEGER')
        conn.execute('UPDATE coffees SET remaining_g=quantity_g WHERE remaining_g IS NULL AND quantity_g IS NOT NULL')
        print('[migration v4] Added remaining_g column.')


def _rebuild_table_v1(conn):
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


def init_db():
    import os
    from config import DB
    db_dir = os.path.dirname(DB)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    with db_conn() as conn:
        init_settings(conn)
        create_lookup_tables(conn)
        create_coffees_table(conn)
        migrate_v1(conn)
        migrate_v2(conn)
        migrate_v3(conn)
        migrate_v4(conn)
        if not col_exists(conn, 'coffees', 'altitude'):
            conn.execute('ALTER TABLE coffees ADD COLUMN altitude INTEGER')
