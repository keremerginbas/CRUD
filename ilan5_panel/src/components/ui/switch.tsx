import {Switch as BaseSwitch} from '@base-ui/react/switch';
import {cn} from '@/lib/utils';

export function Switch({className, label, ...props}: React.ComponentProps<typeof BaseSwitch.Root> & {label?: string}) {
  return (
    <BaseSwitch.Root aria-label={label} className={cn('peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[checked]:bg-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50', className)} {...props}>
      <BaseSwitch.Thumb className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[checked]:translate-x-[18px]" />
    </BaseSwitch.Root>
  );
}

/** A labelled switch row: the whole row toggles. */
export function SwitchField({label, description, checked, onCheckedChange, disabled, id}: {label: string; description?: string; checked: boolean; onCheckedChange: (value: boolean) => void; disabled?: boolean; id?: string}) {
  return (
    <label className={cn('flex cursor-pointer items-start justify-between gap-4 rounded-lg py-1.5', disabled && 'cursor-not-allowed opacity-60')}>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </span>
      <Switch id={id} checked={checked} onCheckedChange={value => onCheckedChange(value)} disabled={disabled} label={label} />
    </label>
  );
}
