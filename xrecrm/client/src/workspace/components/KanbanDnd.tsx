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

const CARD = "card:";
// İmleç bir kartın üstündeyse o kartın önüne, sütunun boş yerindeyse sütunun sonuna bırakılır;
// imleç hiçbir şeyin üstünde değilse (klavye ile taşırken) en yakın hedef seçilir.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (!hits.length) return closestCenter(args);
  const cards = hits.filter((h) => String(h.id).startsWith(CARD));
  return cards.length ? cards : hits;
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
  /** beforeId: önüne bırakılan kart; null ise sütunun sonu. */
  onMove: (id: string, stage: string, beforeId: string | null) => void;
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
    const id = String(event.active.id);
    const over = event.over ? String(event.over.id) : "";
    if (!over || over === CARD + id) return onCancel();
    if (over.startsWith(CARD)) onMove(id, String(event.over?.data.current?.stage || ""), over.slice(CARD.length));
    else onMove(id, over, null);
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

export function KanbanCard({ id, stage, className, children, ...rest }: { id: string; stage: string; className: string; children: ReactNode } & Omit<HTMLAttributes<HTMLElement>, "id">) {
  const { setNodeRef: dragRef, attributes, listeners, isDragging } = useDraggable({ id });
  // Kart aynı zamanda bırakma hedefidir: üzerine bırakılan kart bu kartın önüne yerleşir.
  const { setNodeRef: dropRef, isOver, active } = useDroppable({ id: CARD + id, data: { stage } });
  const ref = (node: HTMLElement | null) => {
    dragRef(node);
    dropRef(node);
  };
  const showGap = isOver && active && String(active.id) !== id;
  return (
    <article ref={ref} className={`${className} ${isDragging ? "is-dragging" : ""} ${showGap ? "drop-before" : ""}`} {...rest} {...attributes} {...listeners} role={undefined} tabIndex={0} aria-roledescription="sürüklenebilir müşteri kartı">
      {children}
    </article>
  );
}
