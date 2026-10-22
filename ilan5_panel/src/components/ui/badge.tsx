import * as React from 'react';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/utils';

export const badgeVariants = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium [&_svg]:size-3', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/12 text-primary',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      outline: 'text-foreground',
      success: 'border-transparent bg-success/15 text-success',
      warning: 'border-transparent bg-warning/18 text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning',
      danger: 'border-transparent bg-destructive/12 text-destructive',
      muted: 'border-transparent bg-muted text-muted-foreground',
      info: 'border-transparent bg-chart-3/15 text-chart-3',
    },
  },
  defaultVariants: {variant: 'default'},
});

export function Badge({className, variant, ...props}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({variant}), className)} {...props} />;
}
