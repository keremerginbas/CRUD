import * as React from 'react';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './dialog';
import {Button} from './button';

type Request = {title: string; description?: string; confirmLabel?: string; destructive?: boolean; resolve: (ok: boolean) => void};
let open: ((request: Request) => void) | null = null;

/** Promise-based replacement for window.confirm, rendered as an accessible dialog. */
export function confirmDialog(options: Omit<Request, 'resolve'>): Promise<boolean> {
  return new Promise(resolve => { if (open) open({...options, resolve}); else resolve(window.confirm(options.title)); });
}

export function ConfirmHost() {
  const [request, setRequest] = React.useState<Request | null>(null);
  React.useEffect(() => { open = setRequest; return () => { open = null; }; }, []);
  const close = (ok: boolean) => { request?.resolve(ok); setRequest(null); };
  return (
    <Dialog open={Boolean(request)} onOpenChange={value => { if (!value) close(false); }}>
      <DialogContent className="max-w-md" showClose={false}>
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          {request?.description && <DialogDescription className="whitespace-pre-line">{request.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>Vazgeç</Button>
          <Button variant={request?.destructive ? 'destructive' : 'default'} onClick={() => close(true)} data-confirm="ok">{request?.confirmLabel || 'Tamam'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
