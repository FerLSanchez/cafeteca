// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
let allOptions = {};        // lookup data from /api/options
let displayedCoffees = [];  // current rendered list
let currentDetail = null;
let activeFilters = {};     // {roaster_id: 1, origin_id: 2, ...}
let activeStatus = '';
let searchQuery = '';
let searchTimer = null;
let currentSort = 'smart';
let gramsPerShot = 17;      // loaded from /api/settings

// Multi-select chip state for m2m fields
let selectedVarieties = [];
let selectedProcesses = [];
let selectedMilkTypes = [];
const CHIP_FIELDS = {
  varieties:  { state: () => selectedVarieties,  set: v => { selectedVarieties = v; },  inputId: 'f-variety-input', chipsId: 'varieties-chips' },
  processes:  { state: () => selectedProcesses,  set: v => { selectedProcesses = v; },  inputId: 'f-process-input', chipsId: 'processes-chips' },
  milk_types: { state: () => selectedMilkTypes,  set: v => { selectedMilkTypes = v; },  inputId: 'f-milk-input',    chipsId: 'milk-chips' },
};

// Pagination
const PAGE_SIZE = 15;
let visibleCount = PAGE_SIZE;

// Calendar
const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-based
let calCoffees = [];

// Autocomplete timers
let acTimers = {};

// Catalog
let LOOKUP_TABLES = [];  // populated from /api/options on init
const CATALOG_LABELS = {
  roasters:'Tostadores', producers:'Productores', shops:'Tiendas',
  origins:'Países de origen', regions:'Regiones', varieties:'Variedades', processes:'Procesos',
  milk_types:'Leches vegetales'
};

// Duplicate flow: source coffee ID to copy recipe/brews from
let pendingRecipeCopyFrom = null;

// PIN
let pinValue = '';
