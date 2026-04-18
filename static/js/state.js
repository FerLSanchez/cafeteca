// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
let allOptions = {};        // lookup data from /api/options
let displayedCoffees = [];  // current rendered list
let currentDetail = null;
let activeFilters = {};     // {roaster_id: 1, origin_id: 2, ...}
let activeStatus = 'in_use';
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

// List view mode
let compactList = localStorage.getItem('compactList') === '1';

// Pagination
const PAGE_SIZE = 15;
let visibleCount = PAGE_SIZE;

// Calendar
function getMonthNames() {
  return ['month.jan','month.feb','month.mar','month.apr','month.may','month.jun',
          'month.jul','month.aug','month.sep','month.oct','month.nov','month.dec'].map(k => t(k));
}
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-based
let calCoffees = [];

// Autocomplete timers
let acTimers = {};

// Catalog
let LOOKUP_TABLES = [];  // populated from /api/options on init
function getCatalogLabels() {
  return {
    roasters:   t('catalog.roasters'),
    producers:  t('catalog.producers'),
    shops:      t('catalog.shops'),
    origins:    t('catalog.origins'),
    regions:    t('catalog.regions'),
    varieties:  t('catalog.varieties'),
    processes:  t('catalog.processes'),
    milk_types: t('catalog.milk_types'),
  };
}

// Duplicate flow: source coffee ID to copy recipe/brews from
let pendingRecipeCopyFrom = null;

// PIN
let pinValue = '';
