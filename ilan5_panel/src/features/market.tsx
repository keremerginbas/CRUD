import * as React from 'react';
import {ArrowDownRight, ArrowUpRight, CirclePlus, CircleMinus, RotateCcw, ExternalLink, ChevronLeft, ChevronRight, Activity} from 'lucide-react';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {NativeSelect} from '@/components/ui/input';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {EmptyState, PageHeader, SourceBadge} from '@/components/common';
import {CATEGORY_LABELS, formatDate, moneyValue, num, safeUrl, type MarketEvent} from '@/lib/ext';
import {refreshMarket, useStore} from '@/lib/store';
import {openDetail} from '@/lib/ui';
import {cn} from '@/lib/utils';

const TYPES: {type: MarketEvent['type']; label: string; hint: string; icon: React.ReactNode; tone: string}[] = [
  {type: 'new', label: 'Bu aramada yeni', hint: 'Tekil ilan · başlangıç sonrası', icon: <CirclePlus />, tone: 'text-chart-1'},
  {type: 'removed', label: 'Yayından kaldırılan', hint: 'Kaldırıldığı doğrulanan', icon: <CircleMinus />, tone: 'text-destructive'},
  {type: 'price_down', label: 'Fiyatı düşen', hint: 'Tekil ilan', icon: <ArrowDownRight />, tone: 'text-success'},
  {type: 'price_up', label: 'Fiyatı yükselen', hint: 'Tekil ilan', icon: <ArrowUpRight />, tone: 'text-chart-2'},
  {type: 'reactivated', label: 'Yeniden yayında', hint: 'Tekrar aktif görülen', icon: <RotateCcw />, tone: 'text-chart-3'},
];
const NAMES: Record<string, string> = {new: 'Aramada yeni görülen', removed: 'Yayından kaldırıldı', price_down: 'Fiyat düştü', price_up: 'Fiyat yükseldi', reactivated: 'Yeniden yayında'};
const PAGE = 20;

export function Market() {
  const events = useStore(s => s.events);
  const query = useStore(s => s.marketQuery);
  const searches = useStore(s => s.searches);
  const records = useStore(s => s.records);
  const [type, setType] = React.useState<string>('all');
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [type, query]);
  const counts = React.useMemo(() => Object.fromEntries(TYPES.map(t => [t.type, new Set(events.filter(e => e.type === t.type).map(e => e.recordId || `${e.source}:${e.listingId}`)).size])), [events]);
  const filtered = events.filter(e => type === 'all' || e.type === type);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE)), current = Math.min(page, pages), rows = filtered.slice((current - 1) * PAGE, current * PAGE);
  const searchOptions = new Map(searches.map(s => [s.id, s.name || s.searchUrl]));
  for (const e of events) for (const id of e.searchIds || []) if (id && !searchOptions.has(id)) searchOptions.set(id, `Arşivdeki arama · ${id.slice(-10)}`);
  const recordFor = (e: MarketEvent) => records.find(r => r.id === e.recordId || (r.listingId && r.listingId === e.listingId));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Piyasa takibi" title="İlan hareketleri" description="Takip edilen aramalarda yeni ilanlar, fiyat değişimleri ve doğrulanmış yayından kalkmalar."
        actions={<>
          <NativeSelect value={query.timeframe} onChange={e => refreshMarket({timeframe: e.target.value as '24h'})} className="w-auto" aria-label="Hareket dönemi" data-testid="market-timeframe">
            <option value="24h">Son 24 saat</option><option value="7d">Son 7 gün</option><option value="all">Tüm zamanlar</option>
          </NativeSelect>
          <NativeSelect value={query.searchId} onChange={e => refreshMarket({searchId: e.target.value})} className="w-auto max-w-[260px]" aria-label="İzlenen arama">
            <option value="all">Tüm aramalar</option>{[...searchOptions].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </NativeSelect>
        </>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {TYPES.map(t => (
          <button key={t.type} type="button" onClick={() => setType(type === t.type ? 'all' : t.type)} aria-pressed={type === t.type}
            className={cn('flex flex-col gap-1.5 surface rounded-xl p-4 text-left transition-all hover:shadow-md', type === t.type && 'border-primary ring-2 ring-primary/20')}>
            <span className={cn('flex items-center gap-2 text-sm font-medium [&_svg]:size-4', t.tone)}>{t.icon}{t.label}</span>
            <span className="text-2xl font-semibold tabular-nums">{num(counts[t.type])}</span>
            <span className="text-xs text-muted-foreground">{t.hint}</span>
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3 text-sm">
          <span className="font-medium">Son hareketler <span className="text-muted-foreground">· {num(filtered.length)}</span></span>
          {type !== 'all' && <Button variant="ghost" size="sm" onClick={() => setType('all')}>Tüm hareketleri göster</Button>}
        </div>
        {rows.length ? (
          <Table data-testid="market-table">
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Hareket</TableHead><TableHead>İlan</TableHead><TableHead>Fiyat</TableHead><TableHead>Değişim</TableHead><TableHead>Zaman</TableHead><TableHead className="w-10"><span className="sr-only">Kaynak</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map(e => {
                const t = TYPES.find(x => x.type === e.type), record = recordFor(e), url = safeUrl(e.url), priceMove = e.type === 'price_up' || e.type === 'price_down';
                return (
                  <TableRow key={e.id}>
                    <TableCell><span className={cn('inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap [&_svg]:size-4', t?.tone)}>{t?.icon}{NAMES[e.type]}</span></TableCell>
                    <TableCell>
                      <div className="flex max-w-[380px] flex-col gap-1">
                        {record ? <button type="button" className="text-left font-medium hover:text-primary hover:underline" onClick={() => openDetail(record.id)}>{e.title || record.title}</button> : <span className="font-medium">{e.title || 'Başlık kaydedilmemiş'}</span>}
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><SourceBadge source={e.source} />{CATEGORY_LABELS[e.category] || 'Diğer'} · {e.listingId}</span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums"><div className="font-medium">{moneyValue(e.newPrice ?? e.oldPrice, e.currency)}</div>{priceMove && <div className="text-xs text-muted-foreground line-through">{moneyValue(e.oldPrice, e.currency)}</div>}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{priceMove ? <span className={cn('font-medium', e.type === 'price_down' ? 'text-success' : 'text-chart-2')}>{e.percent !== null && Number.isFinite(e.percent) ? `%${Math.abs(e.percent).toLocaleString('tr-TR', {maximumFractionDigits: 2})}` : 'Oran hesaplanamadı'}</span> : <span className="text-muted-foreground/50">—</span>}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{formatDate(e.at)}</TableCell>
                    <TableCell>{url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" aria-label={`${e.title || 'İlan'} kaynak sayfasını aç`}><ExternalLink className="size-4" /></a>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={<Activity />} title={type === 'all' ? 'Hareketler burada görünecek' : 'Bu türde kayıtlı hareket yok'} description="İlk tarama başlangıç kaydıdır; sonraki taramalarda yeni görülenler ve doğrulanmış değişimler gösterilir." />
        )}
        <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
          <span>{filtered.length ? `${((current - 1) * PAGE + 1).toLocaleString('tr-TR')}–${Math.min(current * PAGE, filtered.length).toLocaleString('tr-TR')} / ${filtered.length.toLocaleString('tr-TR')} hareket` : 'Seçili dönemde hareket yok'}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon-sm" disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label="Önceki sayfa"><ChevronLeft /></Button>
            <span className="tabular-nums">{current} / {pages}</span>
            <Button variant="outline" size="icon-sm" disabled={current >= pages} onClick={() => setPage(current + 1)} aria-label="Sonraki sayfa"><ChevronRight /></Button>
          </div>
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">“Yeni”, kayıtlı aramada ilk gözlem zamanıdır; sitede yayınlanma tarihi değildir. Değişimler belirlediğiniz aralıklarla taranır; anlık veri akışı değildir.</p>
    </div>
  );
}
