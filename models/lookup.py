from config import LOOKUP_TABLES, JUNCTION_TABLES, LOOKUP_FK


def get_or_create(conn, table, name):
    if not name or not str(name).strip():
        return None
    name = str(name).strip()
    row = conn.execute(f'SELECT id FROM {table} WHERE name=? COLLATE NOCASE', (name,)).fetchone()
    if row:
        return row[0]
    cur = conn.execute(f'INSERT INTO {table} (name) VALUES (?)', (name,))
    return cur.lastrowid


def set_m2m(conn, coffee_id, values, lookup_table, junction_table, fk_col):
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
