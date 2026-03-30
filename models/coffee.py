from config import SCALAR_FIELDS

COFFEE_SELECT = '''
    SELECT c.id, c.name, c.quantity_g, c.remaining_g, c.price_kg, c.altitude,
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
            WHERE cp.coffee_id=c.id) AS process_ids_str,
           (SELECT GROUP_CONCAT(mt.name, '|||')
            FROM coffee_milk_types cmt JOIN milk_types mt ON cmt.milk_type_id=mt.id
            WHERE cmt.coffee_id=c.id) AS milk_types_str,
           (SELECT GROUP_CONCAT(mt.id)
            FROM coffee_milk_types cmt JOIN milk_types mt ON cmt.milk_type_id=mt.id
            WHERE cmt.coffee_id=c.id) AS milk_type_ids_str
    FROM coffees c
    LEFT JOIN roasters  ro ON c.roaster_id  = ro.id
    LEFT JOIN producers p  ON c.producer_id = p.id
    LEFT JOIN origins   o  ON c.origin_id   = o.id
    LEFT JOIN regions   rg ON c.region_id   = rg.id
    LEFT JOIN shops     s  ON c.shop_id     = s.id
'''

COFFEE_COLUMNS = [
    'id', 'name', 'quantity_g', 'remaining_g', 'price_kg', 'altitude',
    'purchase_date', 'roast_date', 'opened_date', 'finished_date',
    'rating', 'notes', 'created_at', 'roaster_id', 'roaster',
    'producer_id', 'producer', 'origin_id', 'origin', 'region_id', 'region',
    'shop_id', 'shop', 'varieties_str', 'variety_ids_str',
    'processes_str', 'process_ids_str', 'milk_types_str', 'milk_type_ids_str'
]


def row_to_coffee(row):
    d = dict(row)
    vs  = d.pop('varieties_str')    or ''
    vis = d.pop('variety_ids_str')  or ''
    ps  = d.pop('processes_str')    or ''
    pis = d.pop('process_ids_str')  or ''
    mts = d.pop('milk_types_str')   or ''
    mtis= d.pop('milk_type_ids_str')or ''
    d['varieties']     = [v for v in vs.split('|||')  if v]
    d['variety_ids']   = [int(i) for i in vis.split(',') if i]
    d['processes']     = [p for p in ps.split('|||')  if p]
    d['process_ids']   = [int(i) for i in pis.split(',') if i]
    d['milk_types']    = [m for m in mts.split('|||') if m]
    d['milk_type_ids'] = [int(i) for i in mtis.split(',') if i]
    return d
