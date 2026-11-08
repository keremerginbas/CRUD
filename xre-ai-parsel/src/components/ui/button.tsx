import * as React from 'react';
import {cva,type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/utils';

export const buttonVariants=cva(
 'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-[background,box-shadow,color,transform,border-color] duration-200 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
 {
  variants:{
   variant:{
    default:'btn-mint',
    success:'btn-mint',
    secondary:'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    outline:'border border-input bg-white/[.04] text-foreground backdrop-blur hover:bg-white/[.09] hover:-translate-y-px',
    danger:'border border-parcel/30 bg-parcel/5 text-parcel hover:bg-parcel/10',
    ghost:'text-muted-foreground hover:bg-white/[.07] hover:text-foreground'
   },
   size:{default:'h-10 px-5',sm:'h-8 px-3.5 text-xs',lg:'h-12 px-6 text-[15px]',icon:'size-8'}
  },
  defaultVariants:{variant:'default',size:'default'}
 }
);

export function Button({className,variant,size,...props}:React.ComponentProps<'button'>&VariantProps<typeof buttonVariants>){
 return <button data-slot="button" className={cn(buttonVariants({variant,size}),className)} {...props}/>;
}
