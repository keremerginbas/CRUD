import * as React from 'react';
import {Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis} from 'recharts';
import {motion} from 'motion/react';
import {Gem, Wallet, Zap, Gauge, CalendarRange, Globe2, Layers, Sparkles, ArrowUpRight, Activity, PhoneCall, ScanSearch, RefreshCw, MapPin, ChevronRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {NativeSelect} from '@/components/ui/input';
import {Progress} from '@/components/ui/progress';
import {toast} from '@/components/ui/toast';
import {siteColor} from '@/components/common';
import {CATEGORY_LABELS, Core, DB, Sites, availabilityOf, formatDate, isDeleted, money, num, runtime, type Category, type ListingRecord, type MarketEvent} from '@/lib/ext';
import {setMonitor, useStore} from '@/lib/store';
import {initials, median, percentChange, priorities, type Priority} from '@/lib/insights';
import {navigate, openDetail, showListings} from '@/lib/ui';
import {cn} from '@/lib/utils';

const DAY = 86400000;
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const tooltipStyle = {background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--popover-foreground)', boxShadow: '0 10px 30px -12px var(--glow)'};
const axis = {tick: {fontSize: 11, fill: 'var(--muted-foreground)'}, stroke: 'transparent', tickLine: false};
const compactMoney = (value: number) => '₺' + Intl.NumberFormat('tr-TR', {notation: 'compact', maximumFractionDigits: 1}).format(value);
const seen = (r: ListingRecord) => Date.parse(r.firstSeenAt || r.capturedAt);

function Delta({value, suffix = '', invert = false}: {value: number | null; suffix?: string; invert?: boolean}) {
  if (value === null || !Number.isFinite(value)) return <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">yeni</span>;
  const up = value >= 0, good = invert ? !up : up;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums', good ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive')}>
      {up ? '▲' : '▼'} %{Math.abs(value).toLocaleString('tr-TR', {maximumFractionDigits: 1})}{suffix}
    </span>
  );
}

function Panel({title, description, action, children, className}: {title: string; description?: string; action?: React.ReactNode; children: React.ReactNode; className?: string}) {
  return (
    <motion.section initial={{opacity: 0, y: 12}} animate={{opacity: 1, y: 0}} transition={{duration: 0.3}} className={cn('surface flex flex-col rounded-2xl p-5', className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>{description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}</div>
        {action}
      </div>
      {children}
    </motion.section>
  );
}
const ViewAll = ({onClick, label = 'Tümü'}: {onClick: () => void; label?: string}) => (
  <button type="button" onClick={onClick} className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">{label}<ChevronRight className="size-3" /></button>
);

function Kpi({title, icon, value, delta, sub, insight, onClick, index}: {title: string; icon: React.ReactNode; value: React.ReactNode; delta?: React.ReactNode; sub: string; insight: string; onClick?: () => void; index: number}) {
  return (
    <motion.button type="button" onClick={onClick} initial={{opacity: 0, y: 14}} animate={{opacity: 1, y: 0}} transition={{delay: index * 0.05, duration: 0.3}} whileHover={{y: -3}}
      className="surface group relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl p-5 text-left" data-kpi={title}>
      <span className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-primary/10 blur-2xl transition-opacity group-hover:opacity-100" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">{title}</span>
        <span className="flex size-8 items-center justify-center rounded-full border bg-primary/10 text-primary [&_svg]:size-4">{icon}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2"><span className="glow-text text-3xl font-semibold tracking-tight tabular-nums">{value}</span>{delta}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
      <div className="mt-auto flex items-start gap-2 rounded-lg border border-primary/15 bg-primary/5 px-2.5 py-2 text-xs">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" /><span><span className="font-medium text-primary">İlan5 içgörüsü: </span><span className="text-muted-foreground">{insight}</span></span>
      </div>
    </motion.button>
  );
}

function ScoreGauge({score}: {score: number}) {
  const radius = 78, length = Math.PI * radius, filled = length * Math.max(0, Math.min(100, score)) / 100;
  const label = score >= 75 ? 'Güçlü' : score >= 50 ? 'Orta' : 'Zayıf';
  return (
    <div className="relative mx-auto mt-2 w-[200px]" role="img" aria-label={`Veri skoru ${score} / 100, ${label}`}>
      <svg viewBox="0 0 200 112" className="w-full overflow-visible">
        <defs>
          <linearGradient id="gauge" x1="0" x2="1"><stop offset="0%" stopColor="var(--chart-1)" /><stop offset="100%" stopColor="var(--chart-2)" /></linearGradient>
          <filter id="gaugeGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <path d="M 22 100 A 78 78 0 0 1 178 100" fill="none" stroke="var(--muted)" strokeWidth="14" strokeLinecap="round" />
        <motion.path d="M 22 100 A 78 78 0 0 1 178 100" fill="none" stroke="url(#gauge)" strokeWidth="14" strokeLinecap="round" filter="url(#gaugeGlow)"
          strokeDasharray={`${length} ${length}`} initial={{strokeDashoffset: length}} animate={{strokeDashoffset: length - filled}} transition={{duration: 1.1, ease: 'easeOut'}} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
        <span className="glow-text text-3xl font-semibold tabular-nums">{score}<span className="text-base text-muted-foreground"> / 100</span></span>
        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px]"><span className={cn('size-1.5 rounded-full', score >= 75 ? 'bg-success' : score >= 50 ? 'bg-warning' : 'bg-destructive')} />Veri kalitesi {label.toLocaleLowerCase('tr-TR')}</span>
      </div>
    </div>
  );
}

const STAGES: Record<string, string> = {meeting: 'bg-chart-1/20 text-chart-1 border-chart-1/40', interested: 'bg-chart-2/20 text-chart-2 border-chart-2/40', called: 'bg-chart-3/20 text-chart-3 border-chart-3/40', new: 'bg-muted text-muted-foreground', opportunity: 'bg-success/15 text-success border-success/40'};
const LEVEL_STYLE: Record<Priority['level'], string> = {high: 'bg-destructive/15 text-destructive', medium: 'bg-warning/15 text-warning', low: 'bg-chart-3/15 text-chart-3'};
const LEVEL_LABEL: Record<Priority['level'], string> = {high: 'Yüksek öncelik', medium: 'Orta öncelik', low: 'Bilgi'};

export function runPriority(p: Priority) {
  if (p.action.kind === 'detail') openDetail(p.action.id);
  else if (p.action.kind === 'listings') showListings(p.action.filters);
  else navigate(p.action.view);
}

export function Dashboard() {
  const records = useStore(s => s.records);
  const stats = useStore(s => s.stats);
  const safety = useStore(s => s.safety);
  const job = useStore(s => s.job);
  const monitor = useStore(s => s.monitor);
  const [days, setDays] = React.useState(30);
  const [scope, setScope] = React.useState('all');
  const [category, setCategory] = React.useState('all');
  const [events, setEvents] = React.useState<MarketEvent[]>([]);
  React.useEffect(() => {
    let alive = true;
    DB().getEvents({since: new Date(Date.now() - 2 * days * DAY).toISOString(), limit: 0}).then(rows => { if (alive) setEvents(rows || []); }).catch(() => {});
    return () => { alive = false; };
  }, [records, days]);

  const now = Date.now(), from = now - days * DAY, prevFrom = now - 2 * days * DAY;
  const inScope = (r: {source: string; category: Category}) => (scope === 'all' || r.source === scope) && (category === 'all' || r.category === category);
  const active = React.useMemo(() => records.filter(r => !isDeleted(r) && inScope(r)), [records, scope, category]); // eslint-disable-line react-hooks/exhaustive-deps
  const scopedEvents = events.filter(e => inScope(e));
  const windowEvents = scopedEvents.filter(e => Date.parse(e.at) >= from);
  const added = active.filter(r => seen(r) >= from), prevAdded = active.filter(r => seen(r) >= prevFrom && seen(r) < from);
  const isOpp = (r: ListingRecord) => Boolean(stats.get(r.id)?.opportunity);

  // KPI 1: opportunities
  const opps = active.filter(isOpp), newOpps = added.filter(isOpp).length, prevOpps = prevAdded.filter(isOpp).length;
  const oppDistricts = new Map<string, number>();
  for (const r of opps) { const d = r.location?.district || r.location?.city; if (d) oppDistricts.set(d, (oppDistricts.get(d) || 0) + 1); }
  const topDistrict = [...oppDistricts].sort((a, b) => b[1] - a[1])[0];
  // KPI 2: portfolio value (TRY)
  const tryPrices = active.filter(r => r.currency === 'TRY' && r.price).map(r => Number(r.price));
  const total = tryPrices.reduce((a, b) => a + b, 0), med = median(tryPrices);
  const drops = windowEvents.filter(e => e.type === 'price_down'), dropTotal = drops.reduce((a, e) => a + Math.abs(Number(e.delta || 0)), 0);
  // KPI 3: critical actions
  const meetings = active.filter(r => r.crm?.status === 'meeting').length, interested = active.filter(r => r.crm?.status === 'interested').length;
  const review = active.filter(r => r.archiveStatus === 'review').length;
  const untouched = opps.filter(r => !r.crm?.status && !r.messagedAt && (r.phones || []).length).length;
  // KPI 4: reach rate
  const reached = active.filter(r => r.crm?.status || r.messagedAt).length, withPhone = active.filter(r => (r.phones || []).length).length;
  const reach = active.length ? Math.round(reached / active.length * 1000) / 10 : 0;
  const notReached = active.filter(r => (r.phones || []).length && !r.crm?.status && !r.messagedAt).length;

  // Growth pulse: listings added in the last 7 days.
  const pulse = React.useMemo(() => {
    const rows = Array.from({length: 7}, (_, i) => { const t = dayStart(now) - (6 - i) * DAY; return {t, day: new Intl.DateTimeFormat('tr-TR', {weekday: 'short'}).format(t), value: 0}; });
    for (const r of active) { const t = dayStart(seen(r)), row = rows.find(x => x.t === t); if (row) row.value++; }
    return rows;
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const pulseTotal = pulse.reduce((a, r) => a + r.value, 0);
  const pulsePrev = active.filter(r => seen(r) >= dayStart(now) - 13 * DAY && seen(r) < dayStart(now) - 6 * DAY).length;
  const peak = Math.max(...pulse.map(r => r.value));

  // Price-per-m² trend of listings first seen in the window (TRY).
  const trend = React.useMemo(() => {
    const bucket = days > 30 ? 7 : days > 7 ? 3 : 1, rows: {label: string; value: number | null; t: number}[] = [];
    for (let t = dayStart(from); t <= now; t += bucket * DAY) {
      const values = active.filter(r => r.currency === 'TRY' && seen(r) >= t && seen(r) < t + bucket * DAY).map(r => stats.get(r.id)?.ppa).filter((v): v is number => Boolean(v));
      rows.push({t, label: new Intl.DateTimeFormat('tr-TR', {day: '2-digit', month: 'short'}).format(t), value: values.length ? Math.round(median(values)!) : null});
    }
    return rows;
  }, [active, stats, days]); // eslint-disable-line react-hooks/exhaustive-deps
  const ppaNow = median(added.filter(r => r.currency === 'TRY').map(r => stats.get(r.id)?.ppa).filter((v): v is number => Boolean(v)));
  const ppaPrev = median(prevAdded.filter(r => r.currency === 'TRY').map(r => stats.get(r.id)?.ppa).filter((v): v is number => Boolean(v)));

  // Data score: phones 40, complete fields 40, seller names 20.
  const score = active.length ? Math.round(withPhone / active.length * 40 + active.filter(r => r.quality?.status === 'complete').length / active.length * 40 + active.filter(r => r.sellerName).length / active.length * 20) : 0;
  const sitesInScope = Sites().SITES.filter(s => scope === 'all' || s.id === scope);
  const todayPages = sitesInScope.reduce((a, s) => a + Number(safety?.todaySites?.[s.id]?.pages || 0), 0);
  const todayPhones = sitesInScope.reduce((a, s) => a + Number(safety?.todaySites?.[s.id]?.phones || 0), 0);

  // Market distribution by city.
  const cities = React.useMemo(() => {
    const map = new Map<string, {count: number; recent: number; prev: number}>();
    for (const r of active) { const c = r.location?.city; if (!c) continue; const v = map.get(c) || {count: 0, recent: 0, prev: 0}; v.count++; if (seen(r) >= from) v.recent++; else if (seen(r) >= prevFrom) v.prev++; map.set(c, v); }
    return [...map].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
  }, [active, days]); // eslint-disable-line react-hooks/exhaustive-deps
  const cityMax = Math.max(1, ...cities.map(([, v]) => v.count));

  // Deal flow: CRM pipeline first, then the strongest opportunities.
  const order: Record<string, number> = {meeting: 0, interested: 1, called: 2, new: 3};
  const flow = [...active.filter(r => r.crm?.status && r.crm.status in order).sort((a, b) => order[a.crm!.status] - order[b.crm!.status]),
    ...opps.filter(r => !r.crm?.status).sort((a, b) => Number(stats.get(a.id)?.ratio) - Number(stats.get(b.id)?.ratio))].slice(0, 6);
  const prio = priorities({records: active, stats, events: windowEvents, job, safety});

  const availability = (kind: string) => active.filter(r => kind === 'unknown' ? ['unknown', 'blocked', 'error'].includes(availabilityOf(r)) : availabilityOf(r) === kind).length;
  async function runMonitor() {
    try { const r = await runtime('ILAN_MONITOR_RUN'); if (r.monitor) setMonitor(r.monitor); toast('Kontrol isteği sıraya alındı; ilan taraması sürüyorsa tamamlanınca başlayacak.'); } catch (error) { toast((error as Error).message, true); }
  }
  const jobRunning = job && ['running', 'paused', 'blocked'].includes(job.status);
  const chip = 'h-8 rounded-full border-border bg-card/60 pl-3 text-xs backdrop-blur';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">İlan5 Komuta Merkezi</h1>
          <p className="mt-1 text-sm text-muted-foreground">Dört sitedeki ilanlarınız, fırsatlar, piyasa hareketleri ve öncelikli işler — arşivinizden canlı.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative"><CalendarRange className="pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <NativeSelect value={days} onChange={e => setDays(Number(e.target.value))} className={cn(chip, 'pl-8')} aria-label="Zaman aralığı" data-testid="dash-days"><option value={7}>Son 7 gün</option><option value={30}>Son 30 gün</option><option value={90}>Son 90 gün</option></NativeSelect></label>
          <label className="relative"><Globe2 className="pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <NativeSelect value={scope} onChange={e => setScope(e.target.value)} className={cn(chip, 'pl-8')} aria-label="Site kapsamı" data-testid="dash-scope"><option value="all">Tüm siteler</option>{Sites().SITES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></label>
          <label className="relative"><Layers className="pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <NativeSelect value={category} onChange={e => setCategory(e.target.value)} className={cn(chip, 'pl-8')} aria-label="Kategori"><option value="all">Tüm kategoriler</option>{(['arsa', 'konut', 'isyeri', 'arac', 'diger'] as Category[]).map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</NativeSelect></label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi index={0} title="Büyüme fırsatları" icon={<Gem />} value={num(opps.length)} delta={<Delta value={percentChange(newOpps, prevOpps)} />}
          sub={`+${num(newOpps)} yeni fırsat bu dönemde`} insight={topDistrict ? `En çok fırsat ${topDistrict[0]} bölgesinde (${topDistrict[1]} ilan).` : 'Fırsat hesaplamak için bölgede en az 5 m² fiyatlı ilan gerekir.'}
          onClick={() => showListings({insight: 'opportunity', ...(scope !== 'all' ? {source: scope} : {})})} />
        <Kpi index={1} title="Portföy değeri" icon={<Wallet />} value={total ? compactMoney(total) : '—'} delta={<Delta value={percentChange(added.length, prevAdded.length)} />}
          sub={med ? `Medyan ilan ${compactMoney(med)} · ${num(tryPrices.length)} TL ilan` : 'TL fiyatlı ilan yok'}
          insight={drops.length ? `${num(drops.length)} ilanın fiyatı düştü (toplam −${compactMoney(dropTotal)}).` : 'Bu dönemde takipteki aramalarda fiyat düşüşü görülmedi.'} onClick={() => navigate('market')} />
        <Kpi index={2} title="Kritik aksiyonlar" icon={<Zap />} value={num(meetings + interested + review)} delta={meetings ? <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">{meetings} görüşme</span> : undefined}
          sub={`${num(meetings)} görüşülecek · ${num(interested)} ilgileniyor · ${num(review)} inceleme`}
          insight={untouched ? `${num(untouched)} fırsat ilanına henüz ulaşılmadı.` : 'Telefonu kayıtlı bütün fırsat ilanlarına ulaşılmış.'} onClick={() => showListings({crm: 'meeting'})} />
        <Kpi index={3} title="Ulaşma oranı" icon={<Gauge />} value={`%${reach.toLocaleString('tr-TR')}`} sub={`${num(reached)} ilana ulaşıldı · telefonu olan %${active.length ? Math.round(withPhone / active.length * 100) : 0}`}
          insight={notReached ? `Telefonu olan ama hiç ulaşılmamış ${num(notReached)} ilan var.` : 'Telefonu olan bütün ilanlarda takip durumu girilmiş.'} onClick={() => showListings({crm: 'none'})} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_340px]">
        <Panel title="Büyüme nabzı (son 7 gün)" description="Arşive ilk kez eklenen ilanlar" action={<ViewAll onClick={() => showListings({})} />}>
          <div className="mb-3 flex items-center gap-3"><Activity className="size-4 text-primary" /><span className="glow-text text-2xl font-semibold tabular-nums">{num(pulseTotal)}</span><Delta value={percentChange(pulseTotal, pulsePrev)} /><span className="text-xs text-muted-foreground">önceki 7 güne göre</span></div>
          <div className="h-52" data-testid="pulse-chart">
            <ResponsiveContainer>
              <BarChart data={pulse} margin={{top: 6, right: 0, left: -24, bottom: 0}}>
                <defs>
                  <linearGradient id="pulseBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-2)" /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.55} /></linearGradient>
                  <filter id="barGlow" x="-50%" y="-20%" width="200%" height="140%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" {...axis} /><YAxis {...axis} allowDecimals={false} />
                <ChartTooltip contentStyle={tooltipStyle} cursor={{fill: 'var(--muted)', opacity: 0.4}} formatter={v => [`${v} ilan`, 'Eklenen']} />
                <Bar dataKey="value" radius={[8, 8, 3, 3]} maxBarSize={34} filter="url(#barGlow)">
                  {pulse.map(row => <Cell key={row.t} fill="url(#pulseBar)" fillOpacity={row.value === peak && peak > 0 ? 1 : 0.75} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="m² fiyat trendi" description="Dönemde eklenen TL ilanların medyan m² fiyatı" action={<ViewAll onClick={() => showListings({})} />}>
          <div className="mb-3 flex items-center gap-3"><ArrowUpRight className="size-4 text-primary" /><span className="glow-text text-2xl font-semibold tabular-nums">{ppaNow ? Core().formatMoney(Math.round(ppaNow), 'TRY') : '—'}</span>{ppaNow !== null && ppaPrev !== null && <Delta value={percentChange(ppaNow, ppaPrev)} invert />}<span className="text-xs text-muted-foreground">/ m²</span></div>
          <div className="h-52" data-testid="trend-chart">
            {trend.some(t => t.value !== null) ? (
              <ResponsiveContainer>
                <LineChart data={trend} margin={{top: 6, right: 8, left: -8, bottom: 0}}>
                  <defs>
                    <linearGradient id="trendLine" x1="0" x2="1"><stop offset="0%" stopColor="var(--chart-1)" /><stop offset="100%" stopColor="var(--chart-2)" /></linearGradient>
                    <filter id="lineGlow" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="3.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                  </defs>
                  <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis {...axis} domain={[(min: number) => Math.floor(min * 0.85), (max: number) => Math.ceil(max * 1.1)]} tickFormatter={v => Intl.NumberFormat('tr-TR', {notation: 'compact'}).format(v)} width={44} />
                  <ChartTooltip contentStyle={tooltipStyle} formatter={v => [`${Core().formatMoney(Number(v), 'TRY')} / m²`, 'Medyan']} />
                  <Line type="monotone" dataKey="value" stroke="url(#trendLine)" strokeWidth={3} connectNulls dot={{r: 3, fill: 'var(--card)', stroke: 'var(--chart-1)', strokeWidth: 2}} activeDot={{r: 5}} filter="url(#lineGlow)" />
                </LineChart>
              </ResponsiveContainer>
            ) : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Bu dönemde m² fiyatlı yeni ilan yok.</div>}
          </div>
        </Panel>
        <Panel title="Performans motoru" description="Bugünkü tarama ve arşiv veri kalitesi">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border bg-card/50 p-3"><div className="flex items-center gap-2 text-xl font-semibold tabular-nums"><ScanSearch className="size-4 text-primary" />{num(todayPages)}</div><div className="mt-1 text-xs text-muted-foreground">Bugün açılan ilan</div></div>
            <div className="rounded-xl border bg-card/50 p-3"><div className="flex items-center gap-2 text-xl font-semibold tabular-nums"><PhoneCall className="size-4 text-chart-2" />{num(todayPhones)}</div><div className="mt-1 text-xs text-muted-foreground">Bugün gösterilen telefon</div></div>
          </div>
          <ScoreGauge score={score} />
          <p className="mt-3 text-center text-[11px] text-muted-foreground">Telefon (%40), tam alanlar (%40) ve satıcı adı (%20) oranından hesaplanır.</p>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_340px]">
        <Panel title="Pazar dağılımı" description="İllere göre ilan sayısı ve dönemdeki yeni ilanlar" action={<ViewAll onClick={() => showListings({})} />}>
          {cities.length ? (
            <ul className="flex flex-col gap-2.5" data-testid="city-list">
              {cities.map(([city, v]) => (
                <li key={city}>
                  <button type="button" onClick={() => showListings({city})} className="flex w-full items-center gap-3 rounded-xl border bg-card/40 px-3 py-2.5 text-left transition-colors hover:border-primary/40">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-chart-1/30 to-chart-2/30 text-[11px] font-semibold"><MapPin className="size-3.5" /></span>
                    <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2 text-sm"><span className="truncate font-medium">{city}</span><span className="font-semibold tabular-nums">{num(v.count)}</span></span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted"><motion.span className="block h-full rounded-full bg-gradient-to-r from-chart-1 to-chart-2" initial={{width: 0}} animate={{width: `${v.count / cityMax * 100}%`}} transition={{duration: 0.8}} /></span></span>
                    <Delta value={percentChange(v.recent, v.prev)} />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="py-10 text-center text-sm text-muted-foreground">Konum bilgisi olan ilan yok.</p>}
          <div className="mt-4 flex h-2 overflow-hidden rounded-full" aria-label="Sitelere göre dağılım">
            {Sites().SITES.map(s => { const c = active.filter(r => r.source === s.id).length; return c ? <span key={s.id} title={`${s.name}: ${c}`} style={{width: `${c / Math.max(1, active.length) * 100}%`, background: siteColor(s.id)}} /> : null; })}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">{Sites().SITES.map(s => <span key={s.id} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{background: siteColor(s.id)}} />{s.name} {num(active.filter(r => r.source === s.id).length)}</span>)}</div>
        </Panel>
        <Panel title="Aktif fırsat akışı" description="Takipteki görüşmeler ve en güçlü fırsatlar" action={<ViewAll onClick={() => showListings({insight: 'opportunity'})} />}>
          {flow.length ? (
            <div className="flex flex-col" data-testid="deal-flow">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b pb-2 text-[11px] text-muted-foreground"><span>İlan / satıcı</span><span>Aşama</span><span className="w-20 text-right">Değer</span></div>
              {flow.map(r => {
                const stage = r.crm?.status ? Core().CRM_STATUSES[r.crm.status as 'new'] : `Fırsat −%${Math.round((1 - Number(stats.get(r.id)?.ratio)) * 100)}`;
                return (
                  <button key={r.id} type="button" onClick={() => openDetail(r.id)} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b py-2.5 text-left last:border-0 hover:bg-muted/30">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-chart-1 to-chart-2 text-[11px] font-semibold text-white">{initials(r.sellerName || r.title)}</span>
                      <span className="min-w-0"><span className="block truncate text-sm font-medium">{r.title}</span><span className="block truncate text-xs text-muted-foreground">{r.sellerName || Sites().name(r.source)}</span></span>
                    </span>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap', STAGES[r.crm?.status || 'opportunity'])}>{stage}</span>
                    <span className="w-20 text-right text-sm font-semibold tabular-nums">{r.price ? compactMoney(Number(r.price)) : money(r)}</span>
                  </button>
                );
              })}
            </div>
          ) : <p className="py-10 text-center text-sm text-muted-foreground">Henüz takipte ilan veya fırsat yok. İlan ayrıntısından takip durumu ekleyin.</p>}
        </Panel>
        <Panel title="Öncelikli işler" description="Zamanında yapılması gerekenler" action={prio.length > 3 ? <ViewAll label={`${prio.length} iş`} onClick={() => document.getElementById('priority-list')?.scrollIntoView({behavior: 'smooth'})} /> : undefined}>
          {prio.length ? (
            <ul id="priority-list" className="flex max-h-[420px] flex-col gap-2.5 overflow-y-auto" data-testid="priorities">
              {prio.map(p => (
                <li key={p.id}>
                  <button type="button" onClick={() => runPriority(p)} className="flex w-full flex-col gap-1.5 rounded-xl border bg-card/40 p-3 text-left transition-colors hover:border-primary/40">
                    <span className="flex flex-wrap items-center gap-1.5"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', LEVEL_STYLE[p.level])}>● {LEVEL_LABEL[p.level]}</span><span className="text-[11px] text-muted-foreground">{p.label}</span></span>
                    <span className="line-clamp-2 text-sm font-medium">{p.title}</span>
                    {p.detail && <span className="line-clamp-1 text-xs text-muted-foreground">{p.detail}</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="py-10 text-center text-sm text-muted-foreground">Bekleyen öncelikli iş yok.</p>}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Siteler" description="Bugünkü kullanım ve son tarama">
          <div className="grid grid-cols-2 gap-3" data-testid="site-cards">
            {Sites().SITES.map(site => {
              const today = safety?.todaySites?.[site.id] || {}, limit = Number(safety?.safety.phoneDailyLimit ?? 150), running = jobRunning && job!.source === site.id;
              return (
                <button key={site.id} type="button" onClick={() => showListings({source: site.id})} className="relative flex flex-col gap-1.5 overflow-hidden rounded-xl border bg-card/40 p-3 text-left transition-colors hover:border-primary/40" data-site={site.id}>
                  <span className="absolute inset-x-0 top-0 h-0.5" style={{background: siteColor(site.id)}} />
                  <span className="flex items-center justify-between text-sm font-semibold">{site.name}{running && <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] text-success">{job!.status === 'running' ? 'Taranıyor' : 'Bekliyor'}</span>}</span>
                  <span className="text-2xl font-semibold tabular-nums">{num(records.filter(r => !isDeleted(r) && r.source === site.id).length)}</span>
                  <span className="text-[11px] text-muted-foreground">Bugün {num(today.pages)} ilan · {num(today.phones)}{limit ? `/${num(limit)}` : ''} telefon</span>
                  {limit > 0 && <Progress value={Math.min(100, Math.round(Number(today.phones || 0) / limit * 100))} label={`${site.name} telefon limiti`} />}
                </button>
              );
            })}
          </div>
        </Panel>
        <Panel title="İlan yayında mı?" description={monitor?.lastRun ? `Son kontrol: ${formatDate(monitor.lastRun)}` : 'Henüz kontrol yapılmadı.'} action={<Button size="sm" variant="outline" className="rounded-full" onClick={runMonitor} disabled={monitor?.status === 'running'}><RefreshCw />Şimdi kontrol et</Button>}>
          <div className="grid grid-cols-2 gap-3">
            {([['active', 'Yayında', 'bg-success'], ['suspected', 'Tekrar kontrol', 'bg-warning'], ['removed', 'Kaldırılmış', 'bg-destructive'], ['unknown', 'Doğrulanmadı', 'bg-muted-foreground/50']] as const).map(([kind, label, dot]) => (
              <button key={kind} type="button" onClick={() => showListings({availability: kind})} className="flex items-center gap-2.5 rounded-xl border bg-card/40 px-3 py-3 text-left transition-colors hover:border-primary/40">
                <span className={cn('size-2 rounded-full', dot)} /><span className="flex-1 text-sm">{label}</span><span className="text-lg font-semibold tabular-nums">{num(availability(kind))}</span>
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
