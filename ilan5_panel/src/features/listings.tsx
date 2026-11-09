import * as React from 'react';
import {
  flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type RowSelectionState, type SortingState, type VisibilityState,
} from '@tanstack/react-table';
import {ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, FileSpreadsheet, FolderCog, ListPlus, Search, SlidersHorizontal, Tag, Trash2, Undo2, X, Inbox, Upload, DownloadCloud} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Checkbox} from '@/components/ui/checkbox';
import {Input, Label, NativeSelect} from '@/components/ui/input';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {Tabs, TabsList, TabsTab} from '@/components/ui/tabs';
import {DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger} from '@/components/ui/menu';
import {Tooltip} from '@/components/ui/tooltip';
import {toast} from '@/components/ui/toast';
import {confirmDialog} from '@/components/ui/confirm';
import {AvailabilityBadge, EmptyState, PageHeader, QualityBadge, SourceBadge} from '@/components/common';
import {CATEGORY_LABELS, Core, DB, Sites, formatPhone, formatShortDate, isDeleted, money, type ListingRecord} from '@/lib/ext';
import {allLists, createList, exportRecords, listName, refresh, useStore, type ListInfo} from '@/lib/store';
import {navigate, openDetail, resetFilters, setFilters, useUi, type ListingFilters} from '@/lib/ui';
import {ListManageDialog} from './list-manage';
import {ImportButton} from './settings';

const CATEGORY_TABS: [string, string][] = [['all', 'Tümü'], ['arsa', 'Arsa'], ['arac', 'Araç'], ['konut', 'Konut'], ['isyeri', 'İşyeri'], ['diger', 'Diğer'], ['review', 'İnceleme'], ['trash', 'Çöp kutusu']];

/** Applies the archive filters exactly like the classic panel (Core.filterRecords + insight). */
export function useFilteredRecords(filters: ListingFilters) {
  const records = useStore(s => s.records);
  const stats = useStore(s => s.stats);
  const sellers = useStore(s => s.sellers);
  return React.useMemo(() => {
    const min = filters.minPrice === '' ? null : Number(filters.minPrice), max = filters.maxPrice === '' ? null : Number(filters.maxPrice);
    const currencyRequired = (min !== null || max !== null) && filters.currency === 'all';
    const base = Core().filterRecords(records, {category: filters.category, list: filters.list});
    if (currencyRequired) return {base, rows: [] as ListingRecord[], currencyRequired, min, max};
    let rows = Core().filterRecords(records, {...filters, minPrice: min, maxPrice: max, query: filters.query.trim()});
    const sellerCount = (r: ListingRecord) => Core().sellerListingCount(r, sellers);
    if (filters.insight === 'opportunity') rows = rows.filter(r => stats.get(r.id)?.opportunity);
    if (filters.insight === 'multi') rows = rows.filter(r => sellerCount(r) >= 3);
    if (filters.insight === 'single') rows = rows.filter(r => sellerCount(r) === 1);
    return {base, rows, currencyRequired, min, max};
  }, [records, stats, sellers, filters]);
}

function SortHeader({label, column}: {label: string; column: any}) {
  const sorted = column.getIsSorted();
  return (
    <button type="button" onClick={column.getToggleSortingHandler()} className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground" aria-label={`${label} sütununa göre sırala`}>
      {label}{sorted === 'asc' ? <ArrowUp className="size-3.5" /> : sorted === 'desc' ? <ArrowDown className="size-3.5" /> : <ArrowUpDown className="size-3.5 opacity-40" />}
    </button>
  );
}

function specificText(r: ListingRecord, category: string) {
  if (['all', 'review', 'trash'].includes(category)) return CATEGORY_LABELS[r.category] || 'Belirsiz';
  if (category === 'arac') { const d = r.rawDetails || {}; return [d['Yıl'] || d['Yil'] || d['Model'], d['KM'] || d['Km'] || d['Kilometre']].filter(Boolean).join(' · ') || '—'; }
  return r.area !== null && r.area !== undefined ? `${Number(r.area).toLocaleString('tr-TR')} m²` : '—';
}

export function Listings() {
  const filters = useUi(s => s.filters);
  const stats = useStore(s => s.stats);
  const sellers = useStore(s => s.sellers);
  const records = useStore(s => s.records);
  useStore(s => s.lists);
  const {base, rows, currencyRequired, min, max} = useFilteredRecords(filters);
  const lists = allLists();
  const [sorting, setSorting] = React.useState<SortingState>([{id: 'capturedAt', desc: true}]);
  const [visibility, setVisibility] = React.useState<VisibilityState>(() => {
    try { return JSON.parse(localStorage.getItem('ilan5.columns') || '') || {seller: false}; } catch { return {seller: false}; }
  });
  const [selection, setSelection] = React.useState<RowSelectionState>({});
  const [pagination, setPagination] = React.useState({pageIndex: 0, pageSize: 25});
  const [showMore, setShowMore] = React.useState(false);
  const [manageOpen, setManageOpen] = React.useState(false);
  React.useEffect(() => { try { localStorage.setItem('ilan5.columns', JSON.stringify(visibility)); } catch { /* not persisted */ } }, [visibility]);
  React.useEffect(() => { setPagination(p => ({...p, pageIndex: 0})); setSelection({}); }, [filters]);

  const cities = React.useMemo(() => [...new Set(records.filter(r => !isDeleted(r)).map(r => r.location?.city).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'tr')), [records]);
  const counts = React.useMemo(() => Object.fromEntries(CATEGORY_TABS.map(([key]) => [key, Core().filterRecords(records, {category: key, list: filters.list}).length])), [records, filters.list]);

  const columns = React.useMemo<ColumnDef<ListingRecord>[]>(() => [
    {id: 'select', enableSorting: false, enableHiding: false, size: 36,
      header: ({table}) => <Checkbox checked={table.getIsAllPageRowsSelected()} indeterminate={table.getIsSomePageRowsSelected()} onCheckedChange={value => table.toggleAllPageRowsSelected(Boolean(value))} aria-label="Bu sayfadaki tüm ilanları seç" />,
      cell: ({row}) => <Checkbox checked={row.getIsSelected()} onCheckedChange={value => row.toggleSelected(Boolean(value))} aria-label="İlanı seç" />},
    {id: 'title', header: 'İlan', enableSorting: false, enableHiding: false, accessorFn: r => r.title,
      cell: ({row: {original: r}}) => (
        <div className="flex max-w-[380px] min-w-[220px] flex-col gap-1.5">
          <button type="button" onClick={() => openDetail(r.id)} className="text-left font-medium leading-snug text-foreground hover:text-primary hover:underline">{r.title || 'Başlık okunamadı'}</button>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <SourceBadge source={r.source} /><span className="tabular-nums">{String(r.listingId || r.id).replace(/^[a-z]+:/, '')}</span>
            {r.crm?.status && <Badge variant="info">{Core().CRM_STATUSES[r.crm.status as keyof ReturnType<typeof Core>['CRM_STATUSES']]}</Badge>}
            {r.messagedAt && <Badge variant="muted">Mesaj gönderildi</Badge>}
          </div>
          <AvailabilityBadge record={r} />
        </div>
      )},
    {id: 'price', accessorFn: r => r.price ?? -1, header: ({column}) => <SortHeader label="Fiyat" column={column} />,
      cell: ({row: {original: r}}) => {
        const stat = stats.get(r.id);
        return (
          <div className="flex flex-col items-start gap-1 whitespace-nowrap">
            <span className="font-semibold tabular-nums">{money(r)}</span>
            {stat && stat.opportunity && stat.ratio !== null && (
              <Tooltip content={`Bölge medyanı ${Core().formatMoney(Math.round(stat.median || 0), r.currency || 'TRY')} / m² (${stat.sample} ilan)`}>
                <span tabIndex={0}><Badge variant="success">Fırsat −%{Math.round((1 - stat.ratio) * 100)}</Badge></span>
              </Tooltip>
            )}
          </div>
        );
      }},
    {id: 'ppa', accessorFn: r => stats.get(r.id)?.ppa ?? -1, header: ({column}) => <SortHeader label="m² fiyatı" column={column} />,
      cell: ({row: {original: r}}) => { const s = stats.get(r.id); return s ? <span className="text-muted-foreground tabular-nums whitespace-nowrap">{Core().formatMoney(Math.round(s.ppa), r.currency || 'TRY')}</span> : <span className="text-muted-foreground/50">—</span>; }},
    {id: 'location', accessorFn: r => [r.location?.city, r.location?.district].join(' '), header: ({column}) => <SortHeader label="Konum" column={column} />,
      cell: ({row: {original: r}}) => (
        <div className="flex min-w-[120px] flex-col"><span>{[r.location?.city, r.location?.district].filter(Boolean).join(' / ') || '—'}</span><span className="text-xs text-muted-foreground">{r.location?.neighborhood || ''}</span></div>
      )},
    {id: 'spec', accessorFn: r => r.area ?? -1, header: ({column}) => <SortHeader label={filters.category === 'arac' ? 'Model / KM' : ['all', 'review', 'trash'].includes(filters.category) ? 'Kategori / Alan' : 'Alan'} column={column} />,
      cell: ({row: {original: r}}) => (
        <div className="flex flex-col whitespace-nowrap"><span>{specificText(r, filters.category)}</span>
          {['all', 'review', 'trash'].includes(filters.category) && r.area ? <span className="text-xs text-muted-foreground">{Number(r.area).toLocaleString('tr-TR')} m²</span> : null}</div>
      )},
    {id: 'phone', header: 'Telefon', enableSorting: false, accessorFn: r => r.phones?.[0] || '',
      cell: ({row: {original: r}}) => {
        const phones = r.phones || [], total = Core().sellerListingCount(r, sellers);
        return (
          <div className="flex flex-col items-start gap-1 whitespace-nowrap tabular-nums">
            <span>{phones.length ? formatPhone(phones[0]) : <span className="text-muted-foreground/50">—</span>}</span>
            {phones.length > 1 && <span className="text-xs text-muted-foreground">+{phones.length - 1} telefon</span>}
            {total >= 3 && <Tooltip content="Bu telefon numarası arşivde birden fazla ilanda geçiyor; emlakçı olabilir."><span tabIndex={0}><Badge variant="warning">{total} ilanı var</Badge></span></Tooltip>}
          </div>
        );
      }},
    {id: 'seller', header: 'Satıcı', accessorFn: r => r.sellerName || '', cell: ({getValue}) => <span className="text-sm">{String(getValue() || '—')}</span>},
    {id: 'quality', header: 'Veri durumu', enableSorting: false, cell: ({row: {original: r}}) => <QualityBadge record={r} />},
    {id: 'capturedAt', accessorFn: r => r.capturedAt || '', header: ({column}) => <SortHeader label="Eklenme" column={column} />,
      cell: ({row: {original: r}}) => <span className="text-xs whitespace-nowrap text-muted-foreground">{formatShortDate(r.capturedAt)}</span>},
    {id: 'open', enableSorting: false, enableHiding: false, header: () => <span className="sr-only">Aç</span>,
      cell: ({row: {original: r}}) => <Button variant="ghost" size="icon-sm" onClick={() => openDetail(r.id)} aria-label={`${r.title || 'İlan'} ayrıntılarını aç`}><ChevronRight /></Button>},
  ], [stats, sellers, filters.category]);

  const table = useReactTable({
    data: rows, columns, getRowId: r => r.id,
    state: {sorting, columnVisibility: visibility, rowSelection: selection, pagination},
    onSortingChange: setSorting, onColumnVisibilityChange: setVisibility, onRowSelectionChange: setSelection, onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    enableRowSelection: true, autoResetPageIndex: false, sortDescFirst: false,
  });
  const selectedIds = Object.keys(selection).filter(id => selection[id]);
  const selectedRecords = React.useMemo(() => rows.filter(r => selection[r.id]), [rows, selection]);
  const filterActive = filters.excludeList !== 'none' || filters.crm !== 'all' || filters.insight !== 'all' || Boolean(filters.query) || filters.source !== 'all' || filters.currency !== 'all' || filters.city !== 'all' || min !== null || max !== null || filters.quality !== 'all' || filters.availability !== 'all';
  const moreActive = filters.excludeList !== 'none' || filters.crm !== 'all' || filters.insight !== 'all' || filters.currency !== 'all' || min !== null || max !== null || filters.quality !== 'all' || filters.availability !== 'all';
  const columnLabels: Record<string, string> = {price: 'Fiyat', ppa: 'm² fiyatı', location: 'Konum', spec: 'Alan / kategori', phone: 'Telefon', seller: 'Satıcı', quality: 'Veri durumu', capturedAt: 'Eklenme'};

  async function bulk(action: 'trash' | 'restore' | 'crm' | 'list', value = '') {
    if (!selectedIds.length) return;
    try {
      if (action === 'trash' || action === 'restore') {
        if (action === 'trash' && !await confirmDialog({title: `${selectedIds.length} ilan çöp kutusuna taşınsın mı?`, description: 'Çöp kutusundan geri alabilirsiniz.', confirmLabel: 'Çöp kutusuna taşı', destructive: true})) return;
        for (const id of selectedIds) await DB().setDeleted(id, action === 'trash');
        toast(action === 'trash' ? `${selectedIds.length} ilan çöp kutusuna taşındı.` : `${selectedIds.length} ilan arşive geri alındı.`);
      } else if (action === 'crm') {
        for (const id of selectedIds) await DB().setCrm(id, {status: value});
        toast(`${selectedIds.length} ilanın takip durumu “${value ? Core().CRM_STATUSES[value as 'new'] : 'Durum yok'}” yapıldı.`);
      } else {
        let listId = value;
        if (!listId) { const list = await createList(`Seçim · ${new Intl.DateTimeFormat('tr-TR', {dateStyle: 'short', timeStyle: 'short'}).format(new Date())}`); listId = list.id; }
        const result = await DB().addToList(selectedIds, listId);
        toast(`${result.changed} ilan “${listName(listId)}” listesine eklendi.`);
      }
      setSelection({});
      await refresh();
    } catch (error) { toast((error as Error).message, true); }
  }

  const archiveEmpty = base.length === 0 && !filterActive;
  const viewTitle = filters.category === 'all' ? 'Tüm ilanlar' : filters.category === 'review' ? 'İnceleme gerekli' : filters.category === 'trash' ? 'Çöp kutusu' : `${CATEGORY_LABELS[filters.category as 'arsa']} ilanları`;
  const pageCount = Math.max(1, table.getPageCount());
  const start = pagination.pageIndex * pagination.pageSize;

  return (
    <div>
      <PageHeader eyebrow="Arşiv" title={viewTitle}
        description={filters.category === 'review' ? 'Kategori bilgisi belirsiz veya çelişkili ilanlar. Kontrol edilene kadar kategori arşivlerine eklenmez.' : filters.category === 'trash' ? 'Arşivden kaldırdığınız ilanlar. Buradan geri alabilirsiniz.' : 'Sütun başlıklarına tıklayarak sıralayın; satırları seçip toplu işlem yapın.'}
        actions={<>
          <ImportButton />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" disabled={!rows.length} data-testid="export-menu"><Download />Dışa aktar</Button>} />
            <DropdownMenuContent>
              <DropdownMenuLabel>Ekrandaki {rows.length.toLocaleString('tr-TR')} ilan</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => exportRecords('exportXlsx', table.getSortedRowModel().rows.map(r => r.original))}><FileSpreadsheet />Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportRecords('exportCsv', table.getSortedRowModel().rows.map(r => r.original))} data-testid="export-csv"><Download />CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>} />

      <div className="surface overflow-hidden rounded-xl">
        <div className="flex flex-col gap-3 border-b p-4">
          <Tabs value={filters.category} onValueChange={value => setFilters({category: String(value)})}>
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <TabsList>
                {CATEGORY_TABS.map(([key, label]) => (
                  <TabsTab key={key} value={key} data-category={key}>{label}<span className="rounded bg-muted-foreground/10 px-1.5 text-[11px] tabular-nums">{(counts[key] || 0).toLocaleString('tr-TR')}</span></TabsTab>
                ))}
              </TabsList>
            </div>
          </Tabs>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={filters.query} onChange={e => setFilters({query: e.target.value})} placeholder="Başlık, ilan no, telefon, satıcı veya konum ara…" className="pl-9" aria-label="İlanlarda ara" data-testid="filter-query" />
            </div>
            <NativeSelect value={filters.list} onChange={e => setFilters({list: e.target.value})} className="w-auto min-w-[160px]" aria-label="Liste" data-testid="filter-list">
              <option value="all">Tüm listeler</option>
              {lists.map((l: ListInfo) => <option key={l.id} value={l.id}>{l.name} ({l.count.toLocaleString('tr-TR')})</option>)}
            </NativeSelect>
            <Tooltip content="Listeyi yeniden adlandır, birleştir veya kaldır"><Button variant="outline" size="icon" disabled={filters.list === 'all'} onClick={() => setManageOpen(true)} aria-label="Listeyi yönet" data-testid="list-manage"><FolderCog /></Button></Tooltip>
            <NativeSelect value={filters.source} onChange={e => setFilters({source: e.target.value})} className="w-auto" aria-label="Kaynak" data-testid="filter-source">
              <option value="all">Tüm siteler</option>
              {Sites().SITES.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
              <option value="import">İçe aktarılan</option>
            </NativeSelect>
            <NativeSelect value={filters.city} onChange={e => setFilters({city: e.target.value})} className="w-auto" aria-label="İl">
              <option value="all">Tüm iller</option>
              {cities.map(city => <option key={city} value={city}>{city}</option>)}
            </NativeSelect>
            <Button variant={showMore || moreActive ? 'secondary' : 'outline'} onClick={() => setShowMore(v => !v)} aria-expanded={showMore} data-testid="more-filters">
              <SlidersHorizontal />Filtreler{moreActive && <span className="size-1.5 rounded-full bg-primary" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Sütunları seç"><Columns3 /></Button>} />
              <DropdownMenuContent>
                <DropdownMenuLabel>Görünen sütunlar</DropdownMenuLabel>
                {table.getAllLeafColumns().filter(c => c.getCanHide()).map(column => (
                  <DropdownMenuCheckboxItem key={column.id} checked={column.getIsVisible()} onCheckedChange={value => column.toggleVisibility(Boolean(value))}>{columnLabels[column.id] || column.id}</DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <AnimatePresence initial={false}>
            {showMore && (
              <motion.div initial={{height: 0, opacity: 0}} animate={{height: 'auto', opacity: 1}} exit={{height: 0, opacity: 0}} transition={{duration: 0.2}} className="overflow-hidden">
                <div className="grid grid-cols-2 gap-3 pt-1 md:grid-cols-4 xl:grid-cols-8">
                  <Label>Öne çıkanlar<NativeSelect value={filters.insight} onChange={e => setFilters({insight: e.target.value})} data-testid="filter-insight">
                    <option value="all">Hepsi</option><option value="opportunity">Fırsat (m² fiyatı %20+ altında)</option><option value="multi">Çok ilanlı satıcı (3+)</option><option value="single">Tek ilanlı satıcı</option>
                  </NativeSelect></Label>
                  <Label>Takip durumu<NativeSelect value={filters.crm} onChange={e => setFilters({crm: e.target.value})} data-testid="filter-crm">
                    <option value="all">Tüm durumlar</option><option value="none">Durum girilmemiş</option>
                    {Object.entries(Core().CRM_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </NativeSelect></Label>
                  <Label>Yayın durumu<NativeSelect value={filters.availability} onChange={e => setFilters({availability: e.target.value})}>
                    <option value="all">Tümü</option><option value="active">Yayında</option><option value="suspected">Tekrar kontrol bekliyor</option><option value="removed">Yayından kaldırılmış</option><option value="unknown">Henüz doğrulanmadı</option>
                  </NativeSelect></Label>
                  <Label>Veri durumu<NativeSelect value={filters.quality} onChange={e => setFilters({quality: e.target.value})}>
                    <option value="all">Tümü</option><option value="complete">Temel alanlar tam</option><option value="missing">Eksik alan var</option><option value="review">İnceleme gerekli</option>
                  </NativeSelect></Label>
                  <Label>Para birimi<NativeSelect value={filters.currency} onChange={e => setFilters({currency: e.target.value})}>
                    <option value="all">Tümü</option><option value="TRY">TL</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
                  </NativeSelect></Label>
                  <Label>En düşük fiyat<Input type="number" min={0} value={filters.minPrice} onChange={e => setFilters({minPrice: e.target.value})} placeholder="Sınır yok" /></Label>
                  <Label>En yüksek fiyat<Input type="number" min={0} value={filters.maxPrice} onChange={e => setFilters({maxPrice: e.target.value})} placeholder="Sınır yok" /></Label>
                  <Label>Şu listede olmayanlar<NativeSelect value={filters.excludeList} onChange={e => setFilters({excludeList: e.target.value})} data-testid="filter-exclude">
                    <option value="none">Karşılaştırma yok</option>{lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </NativeSelect></Label>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {(filterActive || currencyRequired) && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground" data-testid="filter-summary">
              <span>{currencyRequired ? 'Fiyat aralığı için bir para birimi seçin. Farklı para birimlerindeki fiyatlar birlikte karşılaştırılmaz.'
                : min !== null && max !== null && min > max ? 'En düşük fiyat, en yüksek fiyattan büyük. Fiyat aralığını kontrol edin.'
                : `${base.length.toLocaleString('tr-TR')} kayıttan ${rows.length.toLocaleString('tr-TR')} ilan filtrelerle eşleşiyor.`}</span>
              <Button variant="ghost" size="sm" onClick={() => resetFilters()}><X />Filtreleri temizle</Button>
            </div>
          )}
        </div>

        <AnimatePresence>
          {selectedIds.length > 0 && (
            <motion.div initial={{height: 0, opacity: 0}} animate={{height: 'auto', opacity: 1}} exit={{height: 0, opacity: 0}} className="overflow-hidden border-b bg-accent/60">
              <div className="flex flex-wrap items-center gap-2 px-4 py-2.5" data-testid="bulk-bar">
                <span className="mr-2 text-sm font-medium">{selectedIds.length.toLocaleString('tr-TR')} ilan seçildi</span>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button size="sm" variant="outline"><ListPlus />Listeye ekle</Button>} />
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => bulk('list')} data-testid="bulk-new-list"><ListPlus />Yeni listeye ekle</DropdownMenuItem>
                    {lists.length > 0 && <DropdownMenuSeparator />}
                    {lists.map(l => <DropdownMenuItem key={l.id} onClick={() => bulk('list', l.id)}>{l.name}</DropdownMenuItem>)}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button size="sm" variant="outline"><Tag />Takip durumu</Button>} />
                  <DropdownMenuContent align="start">
                    {Object.entries(Core().CRM_STATUSES).map(([k, v]) => <DropdownMenuItem key={k} onClick={() => bulk('crm', k)}>{v}</DropdownMenuItem>)}
                    <DropdownMenuSeparator /><DropdownMenuItem onClick={() => bulk('crm', '')}>Durumu kaldır</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" variant="outline" onClick={() => exportRecords('exportXlsx', selectedRecords)}><FileSpreadsheet />Seçilenleri Excel'e aktar</Button>
                {filters.category === 'trash'
                  ? <Button size="sm" variant="outline" onClick={() => bulk('restore')}><Undo2 />Arşive geri al</Button>
                  : <Button size="sm" variant="outline" className="text-destructive" onClick={() => bulk('trash')}><Trash2 />Çöp kutusuna taşı</Button>}
                <Button size="sm" variant="ghost" onClick={() => setSelection({})}>Seçimi temizle</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {rows.length ? (
          <Table data-testid="records-table">
            <TableHeader>
              {table.getHeaderGroups().map(group => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map(header => <TableHead key={header.id} className={header.id === 'select' ? 'w-10' : undefined}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map(row => (
                <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined} data-record={row.id}>
                  {row.getVisibleCells().map(cell => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : archiveEmpty && !['review', 'trash'].includes(filters.category) ? (
          <EmptyState icon={<Inbox />} title="Arşiviniz hazır" description="İlk ilanlarınızı toplamak için bir arama bağlantısı ekleyin veya mevcut Excel / JSON dosyanızı içe aktarın.">
            <Button onClick={() => navigate('collect')}><DownloadCloud />Veri çek</Button>
            <ImportButton icon={<Upload />} />
          </EmptyState>
        ) : (
          <EmptyState icon={<Inbox />} title={filterActive ? 'Bu filtrelerle eşleşen ilan yok' : filters.category === 'review' ? 'İnceleme bekleyen kayıt yok' : filters.category === 'trash' ? 'Çöp kutusu boş' : 'Bu görünümde ilan yok'}
            description={filterActive ? 'Aramanızı veya filtrelerinizi değiştirerek tekrar deneyin.' : undefined} />
        )}

        <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span data-testid="range-text">{rows.length ? `${(start + 1).toLocaleString('tr-TR')}–${Math.min(start + pagination.pageSize, rows.length).toLocaleString('tr-TR')} / ${rows.length.toLocaleString('tr-TR')} ilan` : 'Görüntülenecek kayıt yok'}</span>
          <div className="flex items-center gap-2">
            <NativeSelect value={pagination.pageSize} onChange={e => setPagination({pageIndex: 0, pageSize: Number(e.target.value)})} className="h-8 w-auto" aria-label="Sayfa başına ilan">
              {[25, 50, 100, 200].map(size => <option key={size} value={size}>{size} / sayfa</option>)}
            </NativeSelect>
            <Button variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Önceki sayfa"><ChevronLeft /></Button>
            <span className="min-w-14 text-center tabular-nums">{pagination.pageIndex + 1} / {pageCount}</span>
            <Button variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Sonraki sayfa"><ChevronRight /></Button>
          </div>
        </div>
      </div>
      <ListManageDialog open={manageOpen} onOpenChange={setManageOpen} listId={filters.list} />
    </div>
  );
}
