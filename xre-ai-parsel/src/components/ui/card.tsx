import * as React from 'react';
import {cn} from '@/lib/utils';

export function Card({className,...props}:React.ComponentProps<'div'>){
 return <div data-slot="card" className={cn('rounded-xl border border-border bg-card text-card-foreground shadow-xs',className)} {...props}/>;
}
export function CardHeader({className,...props}:React.ComponentProps<'div'>){
 return <div className={cn('flex items-center justify-between gap-2 border-b border-border px-4 py-3',className)} {...props}/>;
}
export function CardTitle({className,...props}:React.ComponentProps<'h3'>){
 return <h3 className={cn('text-sm font-bold text-foreground',className)} {...props}/>;
}
export function CardContent({className,...props}:React.ComponentProps<'div'>){
 return <div className={cn('p-4',className)} {...props}/>;
}
export function Badge({className,tone='neutral',...props}:React.ComponentProps<'span'>&{tone?:'neutral'|'ok'|'warn'|'parcel'}){
 const tones={neutral:'bg-muted text-muted-foreground',ok:'bg-success/10 text-success',warn:'bg-amber-500/10 text-amber-700 dark:text-amber-400',parcel:'bg-parcel/10 text-parcel'};
 return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',tones[tone],className)} {...props}/>;
}
