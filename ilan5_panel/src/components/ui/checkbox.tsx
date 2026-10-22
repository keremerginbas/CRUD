import {Checkbox as BaseCheckbox} from '@base-ui/react/checkbox';
import {Check, Minus} from 'lucide-react';
import {cn} from '@/lib/utils';

export function Checkbox({className, indeterminate, ...props}: React.ComponentProps<typeof BaseCheckbox.Root>) {
  return (
    <BaseCheckbox.Root indeterminate={indeterminate} className={cn('peer flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-input bg-card shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground data-[indeterminate]:border-primary data-[indeterminate]:bg-primary data-[indeterminate]:text-primary-foreground', className)} {...props}>
      <BaseCheckbox.Indicator className="flex">{indeterminate ? <Minus className="size-3" /> : <Check className="size-3" strokeWidth={3} />}</BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}
