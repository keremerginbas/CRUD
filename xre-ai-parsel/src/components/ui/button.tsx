import * as React from 'react';
import {cva,type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/utils';

export const buttonVariants=cva(
 'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-[background,box-shadow,color,transform] outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
 {
  variants:{
   variant:{
    default:'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
    success:'bg-success text-white shadow-sm hover:bg-success/90',
    secondary:'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    outline:'border border-border bg-card text-foreground hover:bg-muted',
    danger:'border border-parcel/30 bg-parcel/5 text-parcel hover:bg-parcel/10',
    ghost:'text-muted-foreground hover:bg-muted hover:text-foreground'
   },
   size:{default:'h-10 px-4',sm:'h-8 px-3 text-xs',lg:'h-11 px-5',icon:'size-8'}
  },
  defaultVariants:{variant:'default',size:'default'}
 }
);

export function Button({className,variant,size,...props}:React.ComponentProps<'button'>&VariantProps<typeof buttonVariants>){
 return <button data-slot="button" className={cn(buttonVariants({variant,size}),className)} {...props}/>;
}
