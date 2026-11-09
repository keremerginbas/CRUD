import * as React from 'react';
import {Activity, Bookmark, Bell, BellRing, DownloadCloud, LayoutDashboard, MessageSquare, Moon, PanelsTopLeft, Search, Settings, Sun, Table2, TriangleAlert} from 'lucide-react';
import {cn} from '@/lib/utils';
import {start, useStore} from '@/lib/store';
import {navigate, showListings, useUi, type View} from '@/lib/ui';
import {priorities} from '@/lib/insights';
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger} from '@/components/ui/menu';
import {Button} from '@/components/ui/button';
import {runPriority} from '@/features/dashboard';
import {isDeleted} from '@/lib/ext';
import {Toaster} from '@/components/ui/toast';
import {ConfirmHost} from '@/components/ui/confirm';
import {TooltipProvider} from '@/components/ui/tooltip';
import {ViewTransition} from '@/components/common';
import {Dashboard} from '@/features/dashboard';
import {Listings} from '@/features/listings';
import {DetailSheet} from '@/features/detail';
import {Collect} from '@/features/collect';
import {Searches} from '@/features/searches';
import {Market} from '@/features/market';
import {Messages} from '@/features/messages';
import {Monitor} from '@/features/monitor';
import {SettingsView} from '@/features/settings';
import {ListChoiceHost} from '@/features/list-choice';

const NAV: {view: View; label: string; icon: React.ReactNode}[] = [
  {view: 'dashboard', label: 'Genel bakış', icon: <LayoutDashboard />},
  {view: 'listings', label: 'İlanlar', icon: <Table2 />},
  {view: 'collect', label: 'Veri çek', icon: <DownloadCloud />},
  {view: 'searches', label: 'Kayıtlı aramalar', icon: <Bookmark />},
  {view: 'market', label: 'İlan hareketleri', icon: <Activity />},
  {view: 'messages', label: 'Mesaj kampanyası', icon: <MessageSquare />},
  {view: 'monitor', label: 'Takip ve Telegram', icon: <BellRing />},
  {view: 'settings', label: 'Ayarlar ve yedek', icon: <Settings />},
];

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = React.useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark; setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('ilan5.theme', next ? 'dark' : 'light'); } catch { /* not persisted */ }
  };
  return [dark, toggle];
}

function Sidebar() {
  const view = useUi(s => s.view);
  const records = useStore(s => s.records);
  const job = useStore(s => s.job);
  const queue = useStore(s => s.messages.queue);
  const version = useStore(s => s.version);
  const [dark, toggleTheme] = useTheme();
  const active = records.filter(r => !isDeleted(r)).length;
  const queued = queue.filter(item => item.status === 'queued').length;
  const running = job?.status === 'running';
  const attention = job && ['blocked', 'paused'].includes(job.status);
  const badge = (v: View) => v === 'listings' ? active.toLocaleString('tr-TR') : v === 'messages' && queued ? queued.toLocaleString('tr-TR') : null;
  return (
    <aside className="sticky top-0 flex h-dvh w-16 shrink-0 flex-col border-r border-white/5 bg-sidebar/95 text-sidebar-foreground backdrop-blur lg:w-60">
      <div className="flex h-16 items-center gap-3 px-3 lg:px-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-chart-1 to-chart-2 text-lg font-bold text-white shadow-[0_8px_24px_-6px_var(--glow)]">i5</div>
        <div className="hidden leading-tight lg:block">
          <div className="text-lg font-bold tracking-tight">İlan<span className="text-primary">5</span></div>
          <div className="text-[11px] tracking-wider text-sidebar-muted uppercase">Çok siteli ilan paneli</div>
        </div>
      </div>
      <nav className="mt-3 flex flex-1 flex-col gap-1 px-2 lg:px-3" aria-label="Ana menü">
        {NAV.map(item => (
          <button key={item.view} type="button" onClick={() => navigate(item.view)} aria-current={view === item.view ? 'page' : undefined} title={item.label}
            className={cn('group relative flex h-10 items-center justify-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-foreground/75 transition-all hover:bg-sidebar-accent hover:text-sidebar-foreground lg:justify-start [&_svg]:size-[18px] [&_svg]:shrink-0',
              view === item.view && 'bg-gradient-to-r from-chart-1 to-chart-2 text-white shadow-[0_8px_24px_-8px_var(--glow)] hover:bg-transparent')}>
            {item.icon}
            <span className="hidden flex-1 text-left lg:inline">{item.label}</span>
            {item.view === 'collect' && (running || attention) && <span className={cn('absolute top-2 right-2 size-2 rounded-full lg:static', running ? 'animate-pulse bg-success' : 'bg-warning')} aria-label={running ? 'Tarama sürüyor' : 'Tarama bekliyor'} />}
            {badge(item.view) && <span className="hidden rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] tabular-nums lg:inline">{badge(item.view)}</span>}
          </button>
        ))}
      </nav>
      <div className="flex flex-col gap-1 border-t border-white/10 p-2 lg:p-3">
        <button type="button" onClick={toggleTheme} className="flex h-9 items-center justify-center gap-3 rounded-lg px-3 text-sm text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground lg:justify-start" aria-label={dark ? 'Açık temaya geç' : 'Koyu temaya geç'}>
          {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}<span className="hidden lg:inline">{dark ? 'Açık tema' : 'Koyu tema'}</span>
        </button>
        <a href="../archive.html" className="flex h-9 items-center justify-center gap-3 rounded-lg px-3 text-sm text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground lg:justify-start" title="Klasik panele geç">
          <PanelsTopLeft className="size-[18px]" /><span className="hidden lg:inline">Klasik panel</span>
        </a>
        <div className="hidden px-3 pt-1 text-[11px] text-sidebar-muted lg:block" data-testid="version">{version ? `Sürüm ${version}` : 'Sürüm bilinmiyor'}</div>
      </div>
    </aside>
  );
}

function Topbar() {
  const records = useStore(s => s.records);
  const stats = useStore(s => s.stats);
  const events = useStore(s => s.events);
  const job = useStore(s => s.job);
  const safety = useStore(s => s.safety);
  const [query, setQuery] = React.useState('');
  const items = React.useMemo(() => priorities({records, stats, events, job, safety}), [records, stats, events, job, safety]);
  return (
    <div className="mb-6 flex items-center gap-3">
      <form className="relative max-w-md flex-1" onSubmit={e => { e.preventDefault(); showListings({query: query.trim()}); }} role="search">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="İlan, telefon, satıcı veya konum ara…" aria-label="Tüm ilanlarda ara" data-testid="global-search"
          className="h-10 w-full rounded-full border border-border bg-card/60 pr-4 pl-10 text-sm backdrop-blur outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30" />
      </form>
      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="relative rounded-full bg-card/60" aria-label={`Öncelikli işler: ${items.length}`} data-testid="bell" />}>
            <Bell />{items.length > 0 && <span className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">{items.length}</span>}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-80">
            <DropdownMenuLabel>Öncelikli işler</DropdownMenuLabel>
            {items.length ? items.slice(0, 8).map(p => (
              <DropdownMenuItem key={p.id} onClick={() => runPriority(p)} className="flex-col items-start gap-0.5">
                <span className="text-[11px] text-muted-foreground">{p.label}</span><span className="line-clamp-2 text-sm">{p.title}</span>
              </DropdownMenuItem>
            )) : <div className="px-2 py-3 text-sm text-muted-foreground">Bekleyen iş yok.</div>}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button className="rounded-full" onClick={() => navigate('collect')}><DownloadCloud /><span className="hidden sm:inline">Veri çek</span></Button>
      </div>
    </div>
  );
}

function JobBanner() {
  const job = useStore(s => s.job);
  const view = useUi(s => s.view);
  if (!job || view === 'collect' || !['blocked', 'paused'].includes(job.status)) return null;
  return (
    <button type="button" onClick={() => navigate('collect')} className="mb-5 flex w-full items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-left text-sm">
      <TriangleAlert className="size-4 shrink-0 text-warning" />
      <span className="flex-1">{job.status === 'blocked' ? 'Tarama doğrulama veya giriş bekliyor. Tarama penceresini kontrol edip devam ettirin.' : 'Tarama duraklatıldı. Kalan sıra korunuyor.'}</span>
      <span className="font-medium text-primary">Taramaya git →</span>
    </button>
  );
}

const VIEW_COMPONENTS: Record<View, React.ComponentType> = {
  dashboard: Dashboard, listings: Listings, collect: Collect, searches: Searches, market: Market, messages: Messages, monitor: Monitor, settings: SettingsView,
};

export function App() {
  const view = useUi(s => s.view);
  const ready = useStore(s => s.ready);
  const extension = useStore(s => s.extension);
  React.useEffect(() => { start(); }, []);
  const Current = VIEW_COMPONENTS[view];
  return (
    <TooltipProvider delay={300}>
      <div className="flex min-h-dvh">
        <Sidebar />
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <div className="mx-auto max-w-[1500px]">
            {ready && !extension && (
              <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">Bu ekranı kurulu İlan5 eklentisi üzerinden açın. Tarama ve ayar komutları çalışmaz.</div>
            )}
            <Topbar />
            <JobBanner />
            {ready ? <ViewTransition id={view}><Current /></ViewTransition> : <div className="py-24 text-center text-sm text-muted-foreground">Arşiv yükleniyor…</div>}
          </div>
        </main>
      </div>
      <DetailSheet />
      <ListChoiceHost />
      <ConfirmHost />
      <Toaster />
    </TooltipProvider>
  );
}
