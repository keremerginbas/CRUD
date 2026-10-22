/* Navigation and cross-view UI state (current view, open listing, preset table filters). */
import {useSyncExternalStore} from 'react';

export type View = 'dashboard' | 'listings' | 'collect' | 'searches' | 'market' | 'messages' | 'monitor' | 'settings';
export const VIEWS: View[] = ['dashboard', 'listings', 'collect', 'searches', 'market', 'messages', 'monitor', 'settings'];

export interface ListingFilters {
  category: string; query: string; list: string; excludeList: string; source: string; city: string; currency: string;
  minPrice: string; maxPrice: string; quality: string; availability: string; insight: string; crm: string;
}
export const EMPTY_FILTERS: ListingFilters = {
  category: 'all', query: '', list: 'all', excludeList: 'none', source: 'all', city: 'all', currency: 'all',
  minPrice: '', maxPrice: '', quality: 'all', availability: 'all', insight: 'all', crm: 'all',
};

interface UiState {view: View; detailId: string | null; filters: ListingFilters}
const fromHash = (): View => {
  const hash = location.hash.replace(/^#\/?/, '') as View;
  const query = new URLSearchParams(location.search);
  if (VIEWS.includes(hash)) return hash;
  if (query.get('collect') === '1') return 'collect';
  return 'dashboard';
};
let ui: UiState = {view: fromHash(), detailId: null, filters: {...EMPTY_FILTERS}};
const listeners = new Set<() => void>();
const set = (patch: Partial<UiState>) => { ui = {...ui, ...patch}; listeners.forEach(l => l()); };
export const getUi = () => ui;
export function useUi<T>(selector: (s: UiState) => T): T {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => selector(ui));
}
window.addEventListener('hashchange', () => set({view: fromHash()}));

export function navigate(view: View) {
  if (location.hash !== '#/' + view) history.pushState(null, '', '#/' + view);
  set({view});
  document.getElementById('main')?.scrollTo({top: 0});
  window.scrollTo({top: 0});
}
export const openDetail = (id: string) => set({detailId: id});
export const closeDetail = () => set({detailId: null});
export const setFilters = (patch: Partial<ListingFilters>) => set({filters: {...ui.filters, ...patch}});
export const resetFilters = (keep: Partial<ListingFilters> = {}) => set({filters: {...EMPTY_FILTERS, category: ui.filters.category, list: ui.filters.list, ...keep}});
/** Jump to the listings table with a preset filter (from dashboard cards, site cards, etc.). */
export function showListings(patch: Partial<ListingFilters>) { set({filters: {...EMPTY_FILTERS, ...patch}}); navigate('listings'); }

/* "Where should this crawl go?" — answered by the ListChoiceDialog host. */
export type ListChoice = {listId: string} | null;
type ChoiceRequest = {preferred: string; defaultName: string; resolve: (choice: ListChoice) => void};
let openChoice: ((request: ChoiceRequest) => void) | null = null;
export const registerListChoice = (fn: typeof openChoice) => { openChoice = fn; };
export function chooseList(preferred = '', defaultName = ''): Promise<ListChoice> {
  return new Promise(resolve => {
    if (openChoice) openChoice({preferred, defaultName, resolve});
    else resolve({listId: ''});
  });
}
export type {ChoiceRequest};
