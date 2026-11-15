// Kanban sürükle-bırak: fare, dokunmatik ekran (telefon/tablet) ve klavye ile çalışır.
// Tarayıcının yerleşik sürüklemesi dokunmayla çalışmadığı için @dnd-kit kullanılır.
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

const INTERACTIVE = "button, a, input, select, textarea, label, [contenteditable]";
/** Düğme, seçim kutusu veya açılır listeden başlayan hareket sürükleme sayılmaz. */
const fromControl = (target: EventTarget | null) => Boolean((target as HTMLElement | null)?.closest?.(INTERACTIVE));

class CardPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) => nativeEvent.isPrimary && nativeEvent.button === 0 && nativeEvent.pointerType !== "touch" && !fromControl(nativeEvent.target),
    },
  ];
}
class CardTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: "onTouchStart" as const,
      handler: ({ nativeEvent }: { nativeEvent: TouchEvent }) => nativeEvent.touches.length === 1 && !fromControl(nativeEvent.target),
    },
  ];
}

// İmleç bir sütunun üstündeyse o sütun; değilse (klavye ile taşırken) en yakın sütun.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCenter(args);
};

export function KanbanBoard({
  children,
  overlay,
  activeId,
  onStart,
  onMove,
  onCancel,
  className,
}: {
  children: ReactNode;
  /** Sürüklenen kartın imleçle birlikte taşınan görüntüsü. */
  overlay: ReactNode;
  activeId: string | null;
  onStart: (id: string) => void;
  onMove: (id: string, stage: string) => void;
  onCancel: () => void;
  className: string;
}) {
  const sensors = useSensors(
    // Fare: 6 piksel oynayınca sürükleme başlar; tıklama ve çift tıklama bozulmaz.
    useSensor(CardPointerSensor, { activationConstraint: { distance: 6 } }),
    // Dokunma: kısa basılı tutunca başlar; sayfa kaydırma engellenmez.
    useSensor(CardTouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const start = (event: DragStartEvent) => onStart(String(event.active.id));
  const end = (event: DragEndEvent) => {
    const stage = event.over ? String(event.over.id) : "";
    if (stage) onMove(String(event.active.id), stage);
    else onCancel();
  };
  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={start} onDragEnd={end} onDragCancel={onCancel} autoScroll={{ threshold: { x: 0.12, y: 0.18 } }}>
      <div className={className}>{children}</div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>{activeId ? overlay : null}</DragOverlay>
    </DndContext>
  );
}

export function KanbanColumn({ id, className, style, children }: { id: string; className: string; style?: CSSProperties; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={`${className} ${isOver ? "drag-over" : ""}`} style={style}>
      {children}
    </section>
  );
}

export function KanbanCard({ id, className, children, ...rest }: { id: string; className: string; children: ReactNode } & Omit<HTMLAttributes<HTMLElement>, "id">) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id });
  return (
    <article ref={setNodeRef} className={`${className} ${isDragging ? "is-dragging" : ""}`} {...rest} {...attributes} {...listeners} role={undefined} tabIndex={0} aria-roledescription="sürüklenebilir müşteri kartı">
      {children}
    </article>
  );
}
