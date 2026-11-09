/* Panel state: the archive, background status and settings. Mirrors the refresh rules of the
   classic panel: the archive is re-read only when its change stamp moves. */
import {useSyncExternalStore} from 'react';
import {
  Core, DB, Transfer, chromeApi, hasExtension, runtime, storageGet, storageGetMany, storageSet, isDeleted,
  type ListingRecord, type MarketEvent, type MarketStat, type ListMeta, type BackupSettings,
} from './ext';
import {toast} from '@/components/ui/toast';

export interface Job {
  id: string; status: string; source?: string; mode?: string; message?: string; currentUrl?: string; updatedAt?: string;
  counts?: Record<string, number>; listingQueue?: unknown[]; detailIndex?: number; logs?: ({at?: string; message?: string} | string)[];
  pageProgress?: {currentPage?: number; totalPages?: number | null; pageFound?: number; pageProcessed?: number; totalProcessed?: number; totalExpected?: number | null; stage?: string};
  waitingUntil?: string | null;
}
export interface SavedSearch {
  id: string; name: string; searchUrl: string; category: string; intervalMinutes: number; enabled: boolean; hasBaseline?: boolean;
  lastStatus?: string; lastMessage?: string; lastRunAt?: string; nextRunAt?: string; listId?: string; revealPhone?: boolean; delayMs?: number;
}
export interface MonitorState {
  enabled?: boolean; intervalMinutes?: number; confirmationMinutes?: number; status?: string; phase?: string; message?: string;
  lastRun?: string; nextDue?: string; counts?: Record<string, number>;
}
export interface TelegramState {
  configured?: boolean; chatId?: string; chatTitle?: string; botUsername?: string; verified?: boolean; lastError?: string; counts?: Record<string, number>;
}
export interface SafetyState {
  safety: {separateWindow?: boolean; skipKnown?: boolean; reuseKnownPhone?: boolean; dailyLimit?: number; phoneDailyLimit?: number};
  alerts: {priceDrop?: boolean; minDropPercent?: number; newListing?: boolean; health?: boolean; summary?: boolean; summaryTime?: string};
  todayCount: number; todaySites: Record<string, {pages?: number; phones?: number}>;
}
export interface MessageItem {id: string; status: string; title?: string; listingId?: string; sellerName?: string; message?: string; lastError?: string; updatedAt?: string; createdAt?: string}
export interface MarketQuery {timeframe: '24h' | '7d' | 'all'; searchId: string}

export interface State {
  ready: boolean; extension: boolean; version: string;
  records: ListingRecord[]; stats: Map<string, MarketStat>; sellers: Map<string, number>; lists: ListMeta[];
  job: Job | null; monitor: MonitorState | null; telegram: TelegramState | null; searches: SavedSearch[];
  events: MarketEvent[]; marketQuery: MarketQuery; safety: SafetyState | null;
  backup: {auto: boolean; lastAt: string | null}; messages: {queue: MessageItem[]; templates: {id: string; name: string; body: string}[]};
}

let state: State = {
  ready: false, extension: false, version: '', records: [], stats: new Map(), sellers: new Map(), lists: [],
  job: null, monitor: null, telegram: null, searches: [], events: [], marketQuery: {timeframe: '24h', searchId: 'all'},
  safety: null, backup: {auto: true, lastAt: null}, messages: {queue: [], templates: []},
};
const listeners = new Set<() => void>();
function set(patch: Partial<State>) { state = {...state, ...patch}; listeners.forEach(listener => listener()); }
export const getState = () => state;
export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => selector(state));
}

/* ---------- archive ---------- */
const ARCHIVE_STAMP = 'ilan5.archive.updated';
let loading = false, refreshAgain = false, loadedStamp: number | undefined, autoTimer: ReturnType<typeof setTimeout> | undefined, staleWhileHidden = false;
export async function refresh() {
  if (loading) { refreshAgain = true; return; }
  loading = true;
  try {
    const stamp = (await storageGet<number>(ARCHIVE_STAMP)) || 0;
    const records = await DB().getAll();
    loadedStamp = stamp;
    set({records, stats: Core().marketStats(records), sellers: Core().sellerCounts(records)});
  } catch (error) { toast(`Arşiv okunamadı: ${(error as Error).message}`, true); }
  finally { loading = false; if (refreshAgain) { refreshAgain = false; autoRefresh(); } }
}
export function autoRefresh() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(async () => {
    if (document.hidden) { staleWhileHidden = true; return; }
    const stamp = (await storageGet<number>(ARCHIVE_STAMP)) || 0;
    if (loadedStamp !== undefined && stamp === loadedStamp) return;
    refresh();
  }, 400);
}

/* ---------- lists ---------- */
const LISTS_KEY = 'ilan5.lists';
export interface ListInfo extends ListMeta {count: number}
async function loadLists() {
  const value = await storageGet<ListMeta[]>(LISTS_KEY);
  set({lists: Array.isArray(value) ? value.filter(l => l && typeof l.id === 'string' && l.id) : []});
}
export async function saveLists(lists: ListMeta[]) { set({lists}); await storageSet({[LISTS_KEY]: lists}); }
export function allLists(s: State = state): ListInfo[] {
  const known = new Map<string, ListInfo>(s.lists.map(l => [l.id, {...l, count: 0}]));
  for (const r of s.records) {
    if (isDeleted(r)) continue;
    for (const id of r.lists || []) { if (!known.has(id)) known.set(id, {id, name: id, createdAt: '', count: 0}); known.get(id)!.count++; }
  }
  return [...known.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
export const listName = (id: string) => allLists().find(l => l.id === id)?.name || id;
export async function createList(name: string) {
  const list = {id: 'list-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.slice(0, 80), createdAt: new Date().toISOString()};
  await saveLists([...state.lists, list]);
  return list;
}
export async function mergeListMeta(incoming?: ListMeta[]) {
  const lists = [...state.lists]; let changed = false;
  for (const list of incoming || []) if (list && typeof list.id === 'string' && list.id && !lists.some(l => l.id === list.id)) {
    lists.push({id: list.id.slice(0, 100), name: String(list.name || list.id).slice(0, 80), createdAt: list.createdAt || new Date().toISOString()}); changed = true;
  }
  if (changed) await saveLists(lists);
}

/* ---------- background state ---------- */
export async function syncJob() { set({job: (await storageGet<Job>('ilan5.job.v2')) || null}); }
export async function syncMonitoring() {
  if (!hasExtension()) return;
  const [monitor, telegram] = await Promise.allSettled([runtime('ILAN_MONITOR_STATUS'), runtime('ILAN_TELEGRAM_STATUS')]);
  set({
    monitor: monitor.status === 'fulfilled' ? monitor.value.monitor : state.monitor,
    telegram: telegram.status === 'fulfilled' ? telegram.value.telegram : state.telegram,
  });
}
export async function syncSearches() {
  if (!hasExtension()) return;
  try { const result = await runtime('ILAN_SEARCH_STATUS'); if (Array.isArray(result.searches)) set({searches: result.searches}); } catch { /* shown when the view opens */ }
}
export async function syncSafety() {
  if (!hasExtension()) return;
  try { const r = await runtime('ILAN_SAFETY_STATUS'); set({safety: {safety: r.safety || {}, alerts: r.alerts || {}, todayCount: r.todayCount || 0, todaySites: r.todaySites || {}}}); } catch { /* older worker */ }
}
export function applySafetyResult(r: any) { set({safety: {safety: r.safety || {}, alerts: r.alerts || {}, todayCount: r.todayCount || 0, todaySites: r.todaySites || {}}}); }
export async function syncMessages() {
  if (!hasExtension()) return;
  try { const r = await runtime('ILAN_MESSAGE_STATUS', {status: 'all'}); set({messages: {queue: r.queue || [], templates: r.templates || []}}); } catch (error) { toast((error as Error).message, true); }
}
export function setJob(job: Job | null) { set({job}); }
export function setMonitor(monitor: MonitorState) { set({monitor}); }
export function setTelegram(telegram: TelegramState) { set({telegram}); }
export function setSearches(searches: SavedSearch[]) { set({searches}); }

/* ---------- market events ---------- */
let marketRequest = 0, marketTimer: ReturnType<typeof setTimeout> | undefined;
export async function refreshMarket(query: Partial<MarketQuery> = {}) {
  const marketQuery = {...state.marketQuery, ...query};
  if (query.timeframe || query.searchId) set({marketQuery});
  const request = ++marketRequest;
  const since = marketQuery.timeframe === 'all' ? undefined : new Date(Date.now() - (marketQuery.timeframe === '7d' ? 7 : 1) * 86400000).toISOString();
  try {
    const events = await DB().getEvents({since, searchId: marketQuery.searchId === 'all' ? undefined : marketQuery.searchId, limit: 0});
    if (request !== marketRequest) return;
    set({events: (events || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)))});
  } catch (error) { if (request === marketRequest) toast(`İlan hareketleri okunamadı: ${(error as Error).message}`, true); }
}
export function scheduleMarketRefresh() { clearTimeout(marketTimer); marketTimer = setTimeout(() => refreshMarket(), 350); }

/* ---------- backup & transfer ---------- */
const BACKUP_KEY = 'ilan5.backup.v1';
async function loadBackupConfig() {
  const value = await storageGet<{auto?: boolean; lastAt?: string}>(BACKUP_KEY);
  const backup = {auto: value?.auto !== false, lastAt: value?.lastAt || null};
  set({backup}); return backup;
}
export async function setAutoBackup(auto: boolean) { await storageSet({[BACKUP_KEY]: {...state.backup, auto}}); await loadBackupConfig(); }
async function collectSettings(): Promise<BackupSettings | null> {
  if (!hasExtension()) return null;
  const keys = ['ilan5.searches.v1', 'ilan5.monitor.v1', Core().SAFETY_KEY, 'ilan5.alerts.v1'];
  const stored = await storageGetMany(keys), monitor = stored['ilan5.monitor.v1'] || {};
  const searches = (stored['ilan5.searches.v1']?.items || []).map((s: SavedSearch) => ({searchUrl: s.searchUrl, name: s.name, category: s.category, intervalMinutes: s.intervalMinutes, delayMs: s.delayMs, revealPhone: s.revealPhone, enabled: s.enabled, listId: s.listId || ''}));
  return {searches, safety: stored[Core().SAFETY_KEY] || null, alerts: stored['ilan5.alerts.v1'] || null,
    monitor: {enabled: monitor.enabled !== false, intervalMinutes: monitor.intervalMinutes || 360, confirmationMinutes: monitor.confirmationMinutes || 15}, templates: await DB().getMessageTemplates()};
}
export async function restoreSettings(settings: BackupSettings) {
  const done: string[] = [];
  if (settings.safety) { await runtime('ILAN_SAFETY_CONFIG', {safety: settings.safety}); done.push('güvenli tarama'); }
  if (settings.alerts) { await runtime('ILAN_ALERTS_CONFIG', {alerts: settings.alerts}); done.push('bildirimler'); }
  if (settings.monitor) { await runtime('ILAN_MONITOR_CONFIG', settings.monitor); done.push('bağlantı takibi'); }
  for (const template of settings.templates || []) if (template?.body) await DB().saveMessageTemplate(template);
  if (settings.templates?.length) done.push('mesaj şablonları');
  let searches = 0;
  // Searches come back switched off so nothing starts crawling before the new computer is set up.
  for (const s of settings.searches || []) { try { await runtime('ILAN_SEARCH_SAVE', {...s, enabled: false}); searches++; } catch (error) { console.warn('Arama aktarılamadı', (error as Error).message); } }
  if (searches) done.push(`${searches} kayıtlı arama (takibi kapalı)`);
  await Promise.all([syncSafety(), syncSearches(), syncMonitoring()]);
  return done;
}
export async function runBackup(auto = false) {
  const events = await DB().getEvents({limit: 0});
  let settings: BackupSettings | null = null;
  try { settings = await collectSettings(); } catch { settings = null; }
  await Transfer().exportBackup(state.records, {events, lists: allLists().map(({id, name, createdAt}) => ({id, name, createdAt})), settings});
  await storageSet({[BACKUP_KEY]: {...state.backup, lastAt: new Date().toISOString()}});
  await loadBackupConfig();
  toast(auto ? 'Haftalık otomatik yedek indirildi (İndirilenler klasörü).' : 'Tam arşiv yedeğinin indirilmesi başlatıldı.');
}
async function checkAutoBackup() {
  const config = await loadBackupConfig();
  if (config.auto && state.records.length && (!config.lastAt || Date.now() - Date.parse(config.lastAt) > 7 * 86400000)) {
    try { await runBackup(true); } catch (error) { toast('Otomatik yedek alınamadı: ' + (error as Error).message, true); }
  }
}
export async function exportRecords(kind: 'exportXlsx' | 'exportCsv', records: ListingRecord[]) {
  if (!records.length) { toast('Dışa aktarılacak kayıt bulunmuyor.'); return; }
  try {
    await Transfer()[kind](records.map(r => ({...r, listNames: (r.lists || []).map(listName)})));
    toast(`${records.length.toLocaleString('tr-TR')} ilan için indirme başlatıldı.`);
  } catch (error) { toast(`Dosya oluşturulamadı: ${(error as Error).message}`, true); }
}
/** Imports JSON/XLSX/CSV. `confirmSettings` decides whether bundled settings are restored. */
export async function importArchive(file: File, confirmSettings: () => Promise<boolean>) {
  const records = await Transfer().importFile(file);
  if (!records?.length) { toast('Dosyada içe aktarılabilir ilan bulunamadı.', true); return; }
  const before = state.records.length;
  const result = await DB().upsertMany(records);
  if (records.marketEvents?.length) await DB().importEvents(records.marketEvents);
  if (records.listMeta) await mergeListMeta(records.listMeta);
  if (records.settingsMeta && await confirmSettings()) {
    try { const done = await restoreSettings(records.settingsMeta); if (done.length) setTimeout(() => toast('Ayarlar aktarıldı: ' + done.join(', ') + '.'), 400); }
    catch (error) { toast('Ayarlar aktarılamadı: ' + (error as Error).message, true); }
  }
  await refresh(); await refreshMarket();
  const summary = records.importSummary || {};
  const review = (records as unknown as ListingRecord[]).filter(r => r.archiveStatus === 'review').length;
  toast(`${records.length} kayıt işlendi; ${result?.added ?? Math.max(0, state.records.length - before)} yeni ilan eklendi.${result?.updated ? ` ${result.updated} mevcut ilan güncellendi.` : ''}${review ? ` ${review} kayıt kategori incelemesi gerektiriyor.` : ''}${summary.invalid ? ` ${summary.invalid} geçersiz satır atlandı.` : ''}${summary.duplicates ? ` ${summary.duplicates} yinelenen satır birleştirildi.` : ''}`);
}

/* ---------- start-up and live updates ---------- */
let started = false;
export async function start() {
  if (started) return; started = true;
  const extension = hasExtension();
  let version = '';
  try { version = chromeApi()?.runtime?.getManifest?.().version || ''; } catch { version = ''; }
  set({extension, version});
  await loadLists();
  await refresh();
  set({ready: true});
  await Promise.all([syncJob(), syncMonitoring(), syncSearches(), refreshMarket(), syncSafety(), syncMessages(), loadBackupConfig()]);
  await checkAutoBackup();
  setInterval(checkAutoBackup, 3600000);
  setInterval(() => { if (!document.hidden) syncSafety(); }, 20000);
  const chrome = chromeApi();
  chrome?.storage?.onChanged?.addListener((changes: Record<string, {newValue?: any}>, area: string) => {
    if (area !== 'local') return;
    if (changes['ilan5.job.v2']) set({job: changes['ilan5.job.v2'].newValue || null});
    if (changes['ilan5.monitor.v1']) syncMonitoring();
    if (Object.keys(changes).some(key => key.startsWith('ilan5.telegram'))) syncMonitoring();
    if (Object.keys(changes).some(key => key.includes('search'))) syncSearches();
    if (changes[LISTS_KEY]) loadLists();
    if (changes[ARCHIVE_STAMP] || Object.keys(changes).some(key => key.includes('event'))) scheduleMarketRefresh();
    if (changes[ARCHIVE_STAMP]) autoRefresh();
  });
  chrome?.runtime?.onMessage?.addListener((message: {type?: string}) => {
    if (message.type === 'ILAN_MONITOR_UPDATED' || message.type === 'ILAN_TELEGRAM_UPDATED') { syncMonitoring(); autoRefresh(); }
    if (['ILAN_ARCHIVE_CHANGED', 'ILAN_UPDATED', 'ILAN_JOB_UPDATED'].includes(message.type || '')) { autoRefresh(); syncJob(); scheduleMarketRefresh(); }
    if (message.type === 'ILAN_SEARCH_UPDATED') { syncSearches(); scheduleMarketRefresh(); }
  });
  setInterval(syncJob, 2000);
  setInterval(() => { if (!document.hidden) { syncMonitoring(); syncSearches(); refreshMarket(); syncMessages(); } }, 15000);
  setInterval(() => { if (!document.hidden) autoRefresh(); }, 6000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && staleWhileHidden) { staleWhileHidden = false; autoRefresh(); } });
}
