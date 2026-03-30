let _allOptions = {};
let _displayedCoffees = [];
let _currentDetail = null;
let _activeFilters = {};
let _activeStatus = '';
let _searchQuery = '';
let _searchTimer = null;
let _currentSort = 'smart';
let _gramsPerShot = 17;
let _LOOKUP_TABLES = [];
const PAGE_SIZE = 15;
let _visibleCount = PAGE_SIZE;

let _selectedVarieties = [];
let _selectedProcesses = [];
let _selectedMilkTypes = [];

export function getState() {
  return {
    allOptions: () => _allOptions,
    displayedCoffees: () => _displayedCoffees,
    currentDetail: () => _currentDetail,
    gramsPerShot: () => _gramsPerShot,
    lookupTables: () => _LOOKUP_TABLES,
    activeFilters: () => _activeFilters,
    activeStatus: () => _activeStatus,
    searchQuery: () => _searchQuery,
    currentSort: () => _currentSort,
    visibleCount: () => _visibleCount,
    selectedVarieties: () => _selectedVarieties,
    selectedProcesses: () => _selectedProcesses,
    selectedMilkTypes: () => _selectedMilkTypes,
    pageSize: () => PAGE_SIZE,
  };
}

export function setState(update) {
  const s = getState();
  for (const [key, value] of Object.entries(update)) {
    if (key === 'allOptions') _allOptions = value;
    else if (key === 'displayedCoffees') _displayedCoffees = value;
    else if (key === 'currentDetail') _currentDetail = value;
    else if (key === 'gramsPerShot') _gramsPerShot = value;
    else if (key === 'lookupTables') _LOOKUP_TABLES = value;
    else if (key === 'activeFilters') _activeFilters = value;
    else if (key === 'activeStatus') _activeStatus = value;
    else if (key === 'searchQuery') _searchQuery = value;
    else if (key === 'currentSort') _currentSort = value;
    else if (key === 'visibleCount') _visibleCount = value;
    else if (key === 'selectedVarieties') _selectedVarieties = value;
    else if (key === 'selectedProcesses') _selectedProcesses = value;
    else if (key === 'selectedMilkTypes') _selectedMilkTypes = value;
  }
}

export function initState() {
  _selectedVarieties = [];
  _selectedProcesses = [];
  _selectedMilkTypes = [];
  _visibleCount = PAGE_SIZE;
  _activeFilters = {};
  _activeStatus = '';
  _searchQuery = '';
}
