import * as React from 'react';
import {cn} from '@/lib/utils';

const field = 'w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm shadow-xs transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({className, ...props}, ref) => (
  <input ref={ref} className={cn(field, 'h-9', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({className, ...props}, ref) => (
  <textarea ref={ref} className={cn(field, 'min-h-24 py-2 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

/** Native select styled like the other fields: fully keyboard and screen-reader friendly. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({className, children, ...props}, ref) => (
  <select ref={ref} className={cn(field, 'h-9 cursor-pointer appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8', "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23889' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]", className)} {...props}>
    {children}
  </select>
));
NativeSelect.displayName = 'NativeSelect';

export function Label({className, ...props}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('flex flex-col gap-1.5 text-[13px] font-medium text-foreground/85', className)} {...props} />;
}
export function Hint({className, ...props}: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('text-xs font-normal text-muted-foreground', className)} {...props} />;
}
