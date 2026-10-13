import { useState } from "react";
import { CalendarDays, Clock, Check } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "./ui";
import {
  appointmentIso,
  appointmentParts,
  validateAppointment,
} from "../../../../shared/appointments";
export default function AppointmentPrompt({
  name,
  initial,
  onResolve,
}: {
  name: string;
  initial?: string;
  onResolve: (v: string | null) => void;
}) {
  const parts = appointmentParts(initial);
  const [day, setDay] = useState(parts.day);
  const [time, setTime] = useState(parts.time);
  return (
    <Modal
      title="Randevu tarih ve saatini seçin"
      subtitle={`${name} · Randevu aşamasına tarih ve saat olmadan geçilemez.`}
      onClose={() => onResolve(null)}
    >
      <form
        className="cx-appointment-form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const iso = appointmentIso(day, time);
            validateAppointment(iso);
            onResolve(iso);
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      >
        <div className="cx-info">
          <CalendarDays size={20} />
          <p>
            Tarih ve saat zorunludur. Randevu müşteri kartına ve takvime
            eklenir; başlamadan 10 dakika önce uygulama içinde hatırlatılır.
          </p>
        </div>
        <div className="cx-date-row">
          <label>
            <CalendarDays size={15} />
            Randevu günü
            <input
              required
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <label>
            <Clock size={15} />
            Randevu saati
            <input
              required
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
        </div>
        <small>Saat dilimi: Türkiye · UTC+03:00</small>
        <footer>
          <button
            type="button"
            className="btn secondary"
            onClick={() => onResolve(null)}
          >
            Vazgeç
          </button>
          <button className="btn primary" disabled={!day || !time}>
            <Check size={15} />
            Randevuyu kaydet ve taşı
          </button>
        </footer>
      </form>
    </Modal>
  );
}
