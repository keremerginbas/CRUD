import {Progress as BaseProgress} from '@base-ui/react/progress';
import {cn} from '@/lib/utils';

/** value null renders an indeterminate (striped, animated) bar. */
export function Progress({value, label, className}: {value: number | null; label: string; className?: string}) {
  return (
    <BaseProgress.Root value={value} aria-label={label} className={cn('w-full', className)}>
      <BaseProgress.Track className="relative h-2 overflow-hidden rounded-full bg-muted">
        <BaseProgress.Indicator className={cn('block h-full rounded-full bg-primary transition-[width] duration-500', value === null && 'w-1/3 animate-[ilan-indeterminate_1.4s_ease-in-out_infinite]')} />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
