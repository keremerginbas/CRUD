import * as React from 'react';
import {Dialog as BaseDialog} from '@base-ui/react/dialog';
import {X} from 'lucide-react';
import {cn} from '@/lib/utils';

export const Dialog = BaseDialog.Root;
export const DialogClose = BaseDialog.Close;

const backdrop = 'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0';

/** Centered modal. */
export function DialogContent({className, children, showClose = true, ...props}: React.ComponentProps<typeof BaseDialog.Popup> & {showClose?: boolean}) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={backdrop} />
      <BaseDialog.Popup className={cn('fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border bg-popover p-6 text-popover-foreground shadow-2xl transition-all duration-200 outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0', className)} {...props}>
        {children}
        {showClose && (
          <BaseDialog.Close className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Kapat">
            <X className="size-4" />
          </BaseDialog.Close>
        )}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

/** Right-hand drawer for listing details. */
export function SheetContent({className, children, title, ...props}: React.ComponentProps<typeof BaseDialog.Popup> & {title?: React.ReactNode}) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={backdrop} />
      <BaseDialog.Popup className={cn('fixed inset-y-0 right-0 z-50 flex h-dvh w-full max-w-2xl flex-col border-l bg-popover text-popover-foreground shadow-2xl transition-transform duration-300 ease-out outline-none data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full', className)} {...props}>
        <div className="flex items-center justify-between gap-3 border-b px-6 py-4">
          <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</div>
          <BaseDialog.Close className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Kapat">
            <X className="size-4" />
          </BaseDialog.Close>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogHeader({className, ...props}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 pr-6', className)} {...props} />;
}
export function DialogFooter({className, ...props}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}
export function DialogTitle({className, ...props}: React.ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title className={cn('text-lg font-semibold tracking-tight', className)} {...props} />;
}
export function DialogDescription({className, ...props}: React.ComponentProps<typeof BaseDialog.Description>) {
  return <BaseDialog.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
