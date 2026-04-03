LOOKUP_TABLES = ['roasters', 'producers', 'shops', 'origins', 'regions', 'varieties', 'processes', 'milk_types']

# Tables where the coffee relationship is many-to-many (junction table)
JUNCTION_TABLES = {
    'varieties':  ('coffee_varieties',   'variety_id'),
    'processes':  ('coffee_processes',   'process_id'),
    'milk_types': ('coffee_milk_types',  'milk_type_id'),
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
    conn.execute('''CREATE TABLE IF NOT EXISTS coffee_milk_types (
        coffee_id    INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
        milk_type_id INTEGER NOT NULL REFERENCES milk_types(id),
        PRIMARY KEY (coffee_id, milk_type_id)
    )''')


def get_or_create(conn, table, name):
    if not name or not str(name).strip():
        return None
    name = str(name).strip()
    conn.execute(f'INSERT OR IGNORE INTO {table} (name) VALUES (?)', (name,))
    row = conn.execute(f'SELECT id FROM {table} WHERE name=? COLLATE NOCASE', (name,)).fetchone()
    return row[0]
