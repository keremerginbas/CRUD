import * as React from 'react';
import {Menu} from '@base-ui/react/menu';
import {Check} from 'lucide-react';
import {cn} from '@/lib/utils';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({className, align = 'end', children}: {className?: string; align?: 'start' | 'center' | 'end'; children: React.ReactNode}) {
  return (
    <Menu.Portal>
      <Menu.Positioner sideOffset={6} align={align} className="z-50 outline-none">
        <Menu.Popup className={cn('min-w-48 origin-[var(--transform-origin)] rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg transition-[transform,opacity] duration-150 outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0', className)}>
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}
const item = 'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground';
export function DropdownMenuItem({className, ...props}: React.ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={cn(item, className)} {...props} />;
}
export function DropdownMenuCheckboxItem({className, children, ...props}: React.ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(item, 'pl-7 relative', className)} closeOnClick={false} {...props}>
      <Menu.CheckboxItemIndicator className="absolute left-2 flex"><Check className="!text-foreground" /></Menu.CheckboxItemIndicator>
      {children}
    </Menu.CheckboxItem>
  );
}
export function DropdownMenuLabel({className, ...props}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)} {...props} />;
}
export function DropdownMenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-border" />;
}
