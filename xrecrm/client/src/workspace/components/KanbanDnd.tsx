// Kanban sürükle-bırak: fare, dokunmatik ekran (telefon/tablet) ve klavye ile çalışır.
// Tarayıcının yerleşik sürüklemesi dokunmayla çalışmadığı için @dnd-kit kullanılır.
import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
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
// Müşteri adı bir düğmedir ama kartın büyük kısmını kapladığı için oradan da sürüklenebilir;
// kısa tıklama yine kartı açar (sürükleme ancak fare birkaç piksel oynayınca başlar).
const DRAGGABLE_CONTROL = ".b24-deal-title";
const fromControl = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (el?.closest?.(DRAGGABLE_CONTROL)) return false;
  return Boolean(el?.closest?.(INTERACTIVE));
};

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
  // Yatay kaydırma okları: tahta sağa/sola taşıyorsa kenarda ok görünür. Tıklayınca bir ekran kayar,
  // basılı tutunca ya da kart sürüklerken üzerine gelince sürekli kayar.
  const boardRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const holdTimer = useRef<number | null>(null);
  const updateEdges = () => {
    const el = boardRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { left: el.scrollLeft > 8, right: el.scrollLeft < max - 8 };
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  };
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateEdges, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateEdges) : null;
    observer?.observe(el);
    window.addEventListener("resize", updateEdges);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      observer?.disconnect();
      window.removeEventListener("resize", updateEdges);
    };
  }, []);
  // Sütun sayısı değişince (huni değişimi, süzme) okların gerekip gerekmediği yeniden ölçülür.
  useEffect(updateEdges);
  const release = () => {
    if (holdTimer.current !== null) window.clearInterval(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(() => release, []);
  const step = (side: "left" | "right") => {
    const el = boardRef.current;
    if (!el) return;
    el.scrollBy({ left: (side === "right" ? 1 : -1) * Math.max(280, el.clientWidth * 0.7), behavior: "smooth" });
  };
  const hold = (side: "left" | "right", speed = 22) => {
    release();
    holdTimer.current = window.setInterval(() => boardRef.current?.scrollBy({ left: side === "right" ? speed : -speed }), 16);
  };
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
      <div className="kanban-scroll-wrap">
        <div className={className} ref={boardRef}>
          {children}
        </div>
        {edges.left && <EdgeScroller side="left" dragging={Boolean(activeId)} onStep={step} onHold={hold} onRelease={release} />}
        {edges.right && <EdgeScroller side="right" dragging={Boolean(activeId)} onStep={step} onHold={hold} onRelease={release} />}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>{activeId ? overlay : null}</DragOverlay>
    </DndContext>
  );
}

function EdgeScroller({ side, dragging, onStep, onHold, onRelease }: { side: "left" | "right"; dragging: boolean; onStep: (side: "left" | "right") => void; onHold: (side: "left" | "right", speed?: number) => void; onRelease: () => void }) {
  const longPress = useRef(false);
  const over = useRef(false);
  const pressTimer = useRef<number | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const stopTimers = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    pressTimer.current = hoverTimer.current = null;
  };
  // Ok kaybolurken (kaydıracak yer kalmadı) zamanlayıcılar ve kaydırma durur.
  useEffect(
    () => () => {
      stopTimers();
      onRelease();
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <div
      className={`kanban-edge kanban-edge-${side} ${dragging ? "is-dragging" : ""}`}
      // Kart sürüklenirken kenar şeridinin üzerine gelmek tahtayı o yöne kaydırır.
      onMouseEnter={() => dragging && onHold(side)}
      onMouseLeave={() => dragging && onRelease()}
    >
      <button
        type="button"
        aria-label={side === "right" ? "Sağa kaydır" : "Sola kaydır"}
        title={side === "right" ? "Sağdaki aşamaları göster" : "Soldaki aşamaları göster"}
        // Fare okun üzerine gelince (tıklamadan) tahta o yöne akıcı biçimde kayar; çekilince durur.
        onMouseEnter={() => {
          over.current = true;
          if (dragging) return;
          hoverTimer.current = window.setTimeout(() => over.current && onHold(side, 11), 140);
        }}
        onMouseLeave={() => {
          over.current = false;
          stopTimers();
          onRelease();
        }}
        // Basılı tutmak daha hızlı kaydırır; kısa tıklama bir ekran atlar.
        onPointerDown={() => {
          longPress.current = false;
          pressTimer.current = window.setTimeout(() => {
            longPress.current = true;
            onHold(side, 26);
          }, 260);
        }}
        onPointerUp={() => {
          if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
          pressTimer.current = null;
          // Fare hâlâ okun üzerindeyse yavaş kaydırma sürer.
          if (longPress.current) (over.current && !dragging ? onHold(side, 11) : onRelease());
        }}
        onClick={() => {
          if (!longPress.current) onStep(side);
          longPress.current = false;
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={side === "right" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
        </svg>
      </button>
    </div>
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
