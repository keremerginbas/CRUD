import * as React from 'react';
import {motion} from 'motion/react';
import {cn} from '@/lib/utils';
import {Badge} from '@/components/ui/badge';
import {AVAILABILITY_LABELS, availabilityOf, qualityOf, sourceName, type ListingRecord} from '@/lib/ext';

export function PageHeader({title, description, actions, eyebrow}: {title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold tracking-wider text-primary uppercase">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Fades content in when a view opens. */
export function ViewTransition({children, id}: {children: React.ReactNode; id: string}) {
  return (
    <motion.div key={id} initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} transition={{duration: 0.22, ease: 'easeOut'}}>
      {children}
    </motion.div>
  );
}

export function StatCard({label, value, hint, icon, tone = 'default', onClick}: {label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: 'default' | 'warning' | 'success' | 'danger'; onClick?: () => void}) {
  const Comp = onClick ? motion.button : motion.div;
  return (
    <Comp type={onClick ? 'button' : undefined} onClick={onClick} whileHover={onClick ? {y: -2} : undefined}
      className={cn('flex min-w-0 flex-col gap-2 surface rounded-xl p-4 text-left', onClick && 'cursor-pointer transition-shadow hover:shadow-md',
        tone === 'warning' && 'border-warning/40 bg-warning/5', tone === 'danger' && 'border-destructive/30 bg-destructive/5', tone === 'success' && 'border-success/30 bg-success/5')}>
      <div className="flex items-center justify-between gap-2 text-[13px] font-medium text-muted-foreground">
        <span>{label}</span>{icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </Comp>
  );
}

export function EmptyState({icon, title, description, children}: {icon?: React.ReactNode; title: string; description?: string; children?: React.ReactNode}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground [&_svg]:size-6">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {children && <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

const SITE_TONES: Record<string, string> = {
  sahibinden: 'bg-chart-4/18 text-[color-mix(in_oklch,var(--chart-4),black_45%)] dark:text-chart-4',
  hepsiemlak: 'bg-chart-2/15 text-chart-2',
  emlakjet: 'bg-chart-1/15 text-chart-1',
  arabam: 'bg-chart-5/15 text-chart-5',
};
export const siteColor = (id: string) => ({sahibinden: 'var(--chart-4)', hepsiemlak: 'var(--chart-2)', emlakjet: 'var(--chart-1)', arabam: 'var(--chart-5)'} as Record<string, string>)[id] || 'var(--muted-foreground)';
export function SourceBadge({source, className}: {source: string; className?: string}) {
  return <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap', SITE_TONES[source] || 'bg-muted text-muted-foreground', className)}>{sourceName(source)}</span>;
}

const AVAILABILITY_DOT: Record<string, string> = {active: 'bg-success', suspected: 'bg-warning', removed: 'bg-destructive', unknown: 'bg-muted-foreground/50', blocked: 'bg-warning', error: 'bg-destructive/70'};
export function AvailabilityBadge({record}: {record: ListingRecord}) {
  const status = availabilityOf(record);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn('size-1.5 rounded-full', AVAILABILITY_DOT[status])} />
      {AVAILABILITY_LABELS[status] || 'Henüz doğrulanmadı'}
    </span>
  );
}
export function QualityBadge({record}: {record: ListingRecord}) {
  const q = qualityOf(record);
  return <Badge variant={q.tone === 'success' ? 'success' : q.tone === 'warning' ? 'warning' : q.tone === 'danger' ? 'danger' : 'muted'}>{q.label}</Badge>;
}

export function Section({title, description, actions, children, className}: {title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string}) {
  return (
    <section className={cn('surface rounded-xl', className)}>
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Field({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}
