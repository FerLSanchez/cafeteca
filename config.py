import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get('DATA_DIR', '/data')

DB = os.path.join(DATA_DIR, 'coffee.db')
SECRET_KEY_PATH = os.path.join(DATA_DIR, 'secret_key')

LOOKUP_TABLES = [
    'roasters', 'producers', 'shops',
    'origins', 'regions', 'varieties', 'processes', 'milk_types'
]

JUNCTION_TABLES = {
    'varieties':  ('coffee_varieties',   'variety_id'),
    'processes':  ('coffee_processes',   'process_id'),
    'milk_types': ('coffee_milk_types',  'milk_type_id'),
}

LOOKUP_FK = {
    'roasters':  'roaster_id',
    'producers': 'producer_id',
    'origins':   'origin_id',
    'regions':   'region_id',
    'shops':     'shop_id',
}

SCALAR_FIELDS = [
    'name', 'quantity_g', 'price_kg', 'purchase_date', 'roast_date',
    'opened_date', 'finished_date', 'rating', 'notes', 'altitude'
]

DATE_RE_PATTERN = r'^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$'

DEFAULT_GRAMS_PER_SHOT = 17
DEFAULT_PIN = '1111'
