from flask import Flask, request, jsonify, send_from_directory
import sqlite3, os
from datetime import datetime

app = Flask(__name__, static_folder='static', template_folder='templates')
DB = '/data/coffee.db'

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn

def col_exists(conn, table, col):
    cols = [r[1] for r in conn.execute(f'PRAGMA table_info({table})').fetchall()]
    return col in cols

# ---------------------------------------------------------------------------
# Lookup tables
# ---------------------------------------------------------------------------

LOOKUP_TABLES = ['roasters', 'producers', 'shops', 'origins', 'regions', 'varieties', 'processes']

def create_lookup_tables(conn):
    for t in LOOKUP_TABLES:
        conn.execute(f'''CREATE TABLE IF NOT EXISTS {t} (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE
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

def init_db():
    os.makedirs('/data', exist_ok=True)
    with get_db() as conn:
        create_lookup_tables(conn)
        conn.execute('''CREATE TABLE IF NOT EXISTS coffees (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            roaster_id    INTEGER REFERENCES roasters(id),
            producer_id   INTEGER REFERENCES producers(id),
            variety_id    INTEGER REFERENCES varieties(id),
            origin_id     INTEGER REFERENCES origins(id),
            region_id     INTEGER REFERENCES regions(id),
            process_id    INTEGER REFERENCES processes(id),
            shop_id       INTEGER REFERENCES shops(id),
            quantity_g    INTEGER,
            price_kg      REAL,
            purchase_date TEXT,
            roast_date    TEXT,
            opened_date   TEXT,
            finished_date TEXT,
            rating        INTEGER,
            notes         TEXT,
            created_at    TEXT DEFAULT CURRENT_TIMESTAMP
        )''')
        migrate(conn)
        conn.commit()

def migrate(conn):
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
    print('[migration] Migrating text columns to lookup tables...')
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
        _rebuild_table(conn)
    print('[migration] Done.')

def _rebuild_table(conn):
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
        rating INTEGER, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.execute('''INSERT INTO coffees
        (id,name,roaster_id,producer_id,variety_id,origin_id,region_id,process_id,shop_id,
         quantity_g,price_kg,purchase_date,roast_date,opened_date,finished_date,rating,notes,created_at)
        SELECT id,name,roaster_id,producer_id,variety_id,origin_id,region_id,process_id,shop_id,
               quantity_g,price_kg,purchase_date,roast_date,opened_date,finished_date,rating,notes,created_at
        FROM coffees_old''')
    conn.execute('DROP TABLE coffees_old')

# ---------------------------------------------------------------------------
# Query helper
# ---------------------------------------------------------------------------

COFFEE_SELECT = '''
    SELECT c.id, c.name, c.quantity_g, c.price_kg,
           c.purchase_date, c.roast_date, c.opened_date, c.finished_date,
           c.rating, c.notes, c.created_at,
           c.roaster_id,  ro.name AS roaster,
           c.producer_id, p.name  AS producer,
           c.variety_id,  v.name  AS variety,
           c.origin_id,   o.name  AS origin,
           c.region_id,   rg.name AS region,
           c.process_id,  pr.name AS process,
           c.shop_id,     s.name  AS shop
    FROM coffees c
    LEFT JOIN roasters  ro ON c.roaster_id  = ro.id
    LEFT JOIN producers p  ON c.producer_id = p.id
    LEFT JOIN varieties v  ON c.variety_id  = v.id
    LEFT JOIN origins   o  ON c.origin_id   = o.id
    LEFT JOIN regions   rg ON c.region_id   = rg.id
    LEFT JOIN processes pr ON c.process_id  = pr.id
    LEFT JOIN shops     s  ON c.shop_id     = s.id
'''

def resolve_ids(conn, data):
    return {
        'roaster_id':  get_or_create(conn, 'roasters',  data.get('roaster')),
        'producer_id': get_or_create(conn, 'producers', data.get('producer')),
        'variety_id':  get_or_create(conn, 'varieties', data.get('variety')),
        'origin_id':   get_or_create(conn, 'origins',   data.get('origin')),
        'region_id':   get_or_create(conn, 'regions',   data.get('region')),
        'process_id':  get_or_create(conn, 'processes', data.get('process')),
        'shop_id':     get_or_create(conn, 'shops',     data.get('shop')),
    }

SCALAR_FIELDS = ['name','quantity_g','price_kg','purchase_date','roast_date',
                 'opened_date','finished_date','rating','notes']

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return send_from_directory('templates', 'index.html')


@app.route('/api/options')
def options():
    with get_db() as conn:
        result = {}
        for t in LOOKUP_TABLES:
            rows = conn.execute(f'SELECT id, name FROM {t} ORDER BY name COLLATE NOCASE').fetchall()
            result[t] = [{'id': r['id'], 'name': r['name']} for r in rows]
    return jsonify(result)


@app.route('/api/coffees')
def list_coffees():
    args = request.args
    where, vals = [], []
    for fk in ['roaster_id','producer_id','variety_id','origin_id','region_id','process_id','shop_id']:
        if args.get(fk):
            where.append(f'c.{fk}=?')
            vals.append(int(args[fk]))
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
        where.append('c.name LIKE ?')
        vals.append(f'%{args["q"].strip()}%')
    sql = COFFEE_SELECT + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY c.created_at DESC'
    with get_db() as conn:
        rows = conn.execute(sql, vals).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/coffees', methods=['POST'])
def add_coffee():
    data = request.json
    with get_db() as conn:
        ids = resolve_ids(conn, data)
        fields = list(ids.keys()) + SCALAR_FIELDS
        vals   = list(ids.values()) + [data.get(f) for f in SCALAR_FIELDS]
        cur = conn.execute(
            f"INSERT INTO coffees ({','.join(fields)}) VALUES ({','.join(['?']*len(fields))})", vals)
        conn.commit()
        row = conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.route('/api/coffees/<int:cid>', methods=['PUT'])
def update_coffee(cid):
    data = request.json
    with get_db() as conn:
        ids   = resolve_ids(conn, data)
        fields = list(ids.keys()) + SCALAR_FIELDS
        vals   = list(ids.values()) + [data.get(f) for f in SCALAR_FIELDS] + [cid]
        sets   = ', '.join(f'{f}=?' for f in fields)
        conn.execute(f'UPDATE coffees SET {sets} WHERE id=?', vals)
        conn.commit()
        row = conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone()
    return jsonify(dict(row))


@app.route('/api/coffees/<int:cid>/open', methods=['POST'])
def open_coffee(cid):
    today = datetime.now().strftime('%Y-%m-%d')
    with get_db() as conn:
        conn.execute('UPDATE coffees SET opened_date=? WHERE id=?', (today, cid))
        conn.commit()
        row = conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone()
    return jsonify(dict(row))


@app.route('/api/coffees/<int:cid>/finish', methods=['POST'])
def finish_coffee(cid):
    today = datetime.now().strftime('%Y-%m-%d')
    with get_db() as conn:
        conn.execute('UPDATE coffees SET finished_date=? WHERE id=?', (today, cid))
        conn.commit()
        row = conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone()
    return jsonify(dict(row))


@app.route('/api/coffees/<int:cid>/unrate', methods=['POST'])
def unrate_coffee(cid):
    with get_db() as conn:
        conn.execute('UPDATE coffees SET rating=NULL WHERE id=?', (cid,))
        conn.commit()
        row = conn.execute(COFFEE_SELECT + ' WHERE c.id=?', (cid,)).fetchone()
    return jsonify(dict(row))


@app.route('/api/coffees/<int:cid>', methods=['DELETE'])
def delete_coffee(cid):
    with get_db() as conn:
        conn.execute('DELETE FROM coffees WHERE id=?', (cid,))
        conn.commit()
    return jsonify({'ok': True})


@app.route('/api/stats')
def stats():
    with get_db() as conn:
        total    = conn.execute('SELECT COUNT(*) FROM coffees').fetchone()[0]
        finished = conn.execute("SELECT COUNT(*) FROM coffees WHERE finished_date IS NOT NULL AND finished_date!=''").fetchone()[0]
        active   = conn.execute("SELECT COUNT(*) FROM coffees WHERE opened_date IS NOT NULL AND opened_date!='' AND (finished_date IS NULL OR finished_date='')").fetchone()[0]
        avg_r    = conn.execute('SELECT AVG(rating) FROM coffees WHERE rating IS NOT NULL').fetchone()[0]
        spent    = conn.execute('SELECT SUM(quantity_g/1000.0*price_kg) FROM coffees WHERE price_kg IS NOT NULL AND quantity_g IS NOT NULL').fetchone()[0]
        top_roasters = conn.execute('''SELECT ro.name, COUNT(*) cnt FROM coffees c
            JOIN roasters ro ON c.roaster_id=ro.id GROUP BY ro.id ORDER BY cnt DESC LIMIT 5''').fetchall()
        origins_bd = conn.execute('''SELECT o.name, COUNT(*) cnt FROM coffees c
            JOIN origins o ON c.origin_id=o.id GROUP BY o.id ORDER BY cnt DESC LIMIT 8''').fetchall()
        processes_bd = conn.execute('''SELECT pr.name, COUNT(*) cnt FROM coffees c
            JOIN processes pr ON c.process_id=pr.id GROUP BY pr.id ORDER BY cnt DESC LIMIT 6''').fetchall()
    return jsonify({
        'total': total, 'finished': finished, 'active': active,
        'avg_rating': round(avg_r, 1) if avg_r else None,
        'total_spent': round(spent, 2) if spent else 0,
        'top_roasters': [dict(r) for r in top_roasters],
        'origins_breakdown': [dict(r) for r in origins_bd],
        'processes_breakdown': [dict(r) for r in processes_bd],
    })


# Lookup management
LOOKUP_FK = {
    'roasters': 'roaster_id', 'producers': 'producer_id', 'varieties': 'variety_id',
    'origins': 'origin_id', 'regions': 'region_id', 'processes': 'process_id', 'shops': 'shop_id',
}

@app.route('/api/lookup/<table>')
def lookup_list(table):
    if table not in LOOKUP_TABLES:
        return jsonify({'error': 'Unknown table'}), 404
    fk = LOOKUP_FK[table]
    with get_db() as conn:
        rows = conn.execute(f'''
            SELECT t.id, t.name, COUNT(c.id) AS coffee_count
            FROM {table} t LEFT JOIN coffees c ON c.{fk}=t.id
            GROUP BY t.id ORDER BY t.name COLLATE NOCASE
        ''').fetchall()
    return jsonify([dict(r) for r in rows])

@app.route('/api/lookup/<table>/<int:lid>', methods=['PUT'])
def lookup_rename(table, lid):
    if table not in LOOKUP_TABLES:
        return jsonify({'error': 'Unknown table'}), 404
    name = (request.json or {}).get('name', '').strip()
    if not name:
        return jsonify({'error': 'Name required'}), 400
    with get_db() as conn:
        # Check for name collision
        existing = conn.execute(f'SELECT id FROM {table} WHERE name=? COLLATE NOCASE AND id!=?', (name, lid)).fetchone()
        if existing:
            return jsonify({'error': 'Ya existe una entrada con ese nombre'}), 409
        conn.execute(f'UPDATE {table} SET name=? WHERE id=?', (name, lid))
        conn.commit()
    return jsonify({'ok': True})

@app.route('/api/lookup/<table>/<int:lid>', methods=['DELETE'])
def lookup_delete(table, lid):
    if table not in LOOKUP_TABLES:
        return jsonify({'error': 'Unknown table'}), 404
    fk = LOOKUP_FK[table]
    with get_db() as conn:
        count = conn.execute(f'SELECT COUNT(*) FROM coffees WHERE {fk}=?', (lid,)).fetchone()[0]
        if count > 0:
            return jsonify({'error': f'En uso por {count} café(s)'}), 409
        conn.execute(f'DELETE FROM {table} WHERE id=?', (lid,))
        conn.commit()
    return jsonify({'ok': True})

@app.route('/api/lookup/<table>/purge', methods=['POST'])
def lookup_purge(table):
    """Delete all orphan entries (coffee_count = 0) from a table."""
    if table not in LOOKUP_TABLES:
        return jsonify({'error': 'Unknown table'}), 404
    fk = LOOKUP_FK[table]
    with get_db() as conn:
        cur = conn.execute(f'DELETE FROM {table} WHERE id NOT IN (SELECT DISTINCT {fk} FROM coffees WHERE {fk} IS NOT NULL)')
        conn.commit()
    return jsonify({'deleted': cur.rowcount})


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)
