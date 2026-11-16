// Hat yönetimi ekranındaki WhatsApp hat panosu: bağlı numara sayacı, arama,
// kart / liste görünümü, QR ile bağlama ve hat ayarları (ad + yetkili personel).
import "../lines-panel.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, List, Pencil, QrCode, RefreshCw, Search, Settings2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { formatPhone, groupNames, lines } from "../data";
import { lineDisplayName } from "../../../../shared/lines";
import { useStore } from "../store";
import { Empty, Modal } from "./ui";

interface StaffRef {
  id: string;
  name: string;
  /** Pasife alınmış ya da silinmiş personel yeni seçilemez; yalnız listeden çıkarılabilir. */
  active?: boolean;
}
export interface LineSummary {
  id: string;
  name: string;
  label: string;
  group: "ai" | "office" | "cloud";
  phone: string;
  profileName: string;
  status: "connected" | "disconnected";
  connectedAt: string | null;
  lastMessageAt: string | null;
  todayIn: number | null;
  todayOut: number | null;
  chats: number | null;
  waiting: number | null;
  staff: StaffRef[];
}

const VIEW_KEY = "xre-lines-view";
const readView = (): "cards" | "list" => {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
};

export const lineInitials = (text: string) =>
  text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toLocaleUpperCase("tr-TR") || "?";

/** "az önce", "5 dk önce", "3 sa önce", "2 gün önce"; hiç mesaj yoksa "—". */
export function timeAgo(iso: string | null, now = Date.now()): string {
  const at = iso ? Date.parse(iso) : 0;
  if (!at) return "—";
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} sa önce`;
  return `${Math.floor(minutes / (60 * 24))} gün önce`;
}

const longDay = (iso: string | null) =>
  iso && Date.parse(iso)
    ? new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })
    : "—";

export default function LinePanel({
  group,
  onGroup,
  canEditInventory,
  onBulkEdit,
  onDetail,
}: {
  group: string;
  onGroup: (group: string) => void;
  canEditInventory: boolean;
  onBulkEdit: () => void;
  onDetail: (lineId: string) => void;
}) {
  const { data, demo, request, refresh, user } = useStore();
  const [summary, setSummary] = useState<LineSummary[] | null>(null);
  const [employees, setEmployees] = useState<StaffRef[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setViewState] = useState<"cards" | "list">(readView);
  const setView = (next: "cards" | "list") => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* gizli sekmede tercih saklanamazsa görünüm yine değişir */
    }
  };

  const loadSummary = async (): Promise<LineSummary[] | null> => {
    if (demo || !user) return null;
    try {
      const r = await request("/api/whatsapp/lines/summary");
      setSummary(r.lines || []);
      setEmployees(r.employees || []);
      setCanManage(Boolean(r.canManage));
      return r.lines || [];
    } catch {
      /* WhatsApp yetkisi yoksa kartlar yalnız envanter bilgisini gösterir */
      setSummary(null);
      return null;
    }
  };
  // Envanter, bağlantı durumu, mesajlar ya da hatların yetkili personeli değişince özet yenilenir.
  const inventoryKey = lines.map((l) => `${l.id}:${l.phone}:${l.label || ""}`).join("|");
  const connectionKey = data.connections.map((c) => `${c.id}:${c.status}:${c.phone || ""}`).join("|");
  useEffect(() => {
    void loadSummary();
  }, [inventoryKey, connectionKey, data.messages.length, data.lineStaffVersion, demo, user?.openId]);

  // Sayfa açılınca WhatsApp'taki gerçek durum ve bağlı numara okunur.
  const syncConnections = async () => {
    if (demo || !user) return;
    try {
      await request("/api/whatsapp/connections/sync", {});
      await refresh();
    } catch {
      /* bağlantı servisi kapalıysa kartlar son bilinen durumu gösterir */
    }
  };
  useEffect(() => {
    void syncConnections();
  }, []);

  // Özet alınamadıysa (demo ya da yetki yok) envanter ve bağlantı bilgisiyle sade kartlar gösterilir.
  const all: LineSummary[] = useMemo(() => {
    if (summary) return summary;
    return lines.map((line) => {
      const connection = data.connections.find((c) => c.id === line.id);
      const connected = connection?.status === "connected";
      return {
        id: line.id,
        name: lineDisplayName(line),
        label: line.label || "",
        group: line.group,
        phone: connected && connection?.phone ? `+${String(connection.phone).replace(/\D/g, "")}` : line.phone,
        profileName: connected ? connection?.profileName || "" : "",
        status: connected ? "connected" : "disconnected",
        connectedAt: connected && connection?.connectedAt ? String(connection.connectedAt) : null,
        lastMessageAt: null,
        todayIn: null,
        todayOut: null,
        chats: null,
        waiting: null,
        staff: [],
      };
    });
  }, [summary, inventoryKey, connectionKey]);

  const needle = query.trim().toLocaleLowerCase("tr-TR");
  const digits = query.replace(/\D/g, "");
  // SIM kart numarası (ICCID) envanterde durur; aramada o da eşleşir.
  const iccids = new Map(lines.map((l) => [l.id, l.iccid || ""]));
  const filtered = all.filter((l) => {
    if (group !== "all" && l.group !== group) return false;
    if (!needle) return true;
    if (`${l.name} ${l.profileName} ${l.id}`.toLocaleLowerCase("tr-TR").includes(needle)) return true;
    if (!digits) return false;
    return l.phone.replace(/\D/g, "").includes(digits) || (iccids.get(l.id) || "").includes(digits);
  });
  const connectedCount = all.filter((l) => l.status === "connected").length;

  // --- QR ile bağlama (WhatsApp sayfasındaki akışla aynı uçlar) -------------
  const [qrLine, setQrLine] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState("");
  const [qrBusy, setQrBusy] = useState(false);
  // Pencere açılırken hattın durumu: zaten bağlı bir hatta "bağlandı" demek için yeni bir bağlantı görülmelidir.
  const qrStart = useRef({ connected: false, connectedAt: "", sawOff: false });
  const openQr = (id: string) => {
    const c = data.connections.find((x) => x.id === id);
    qrStart.current = {
      connected: c?.status === "connected",
      connectedAt: String(c?.connectedAt || ""),
      sawOff: false,
    };
    void loadQr(id);
  };
  async function loadQr(id: string) {
    setQrLine(id);
    setQr(null);
    setQrError("");
    setQrBusy(true);
    try {
      if (demo)
        throw new Error("Demo modunda gerçek QR kodu üretilmez. Giriş yapıp canlı moda geçin.");
      const r = await request(`/api/connections/${id}/qr`, {});
      const image = typeof r === "string" ? r : r.base64 || r.qr || r.qrcode?.base64;
      if (!image) throw new Error(r.message || "QR kodu henüz hazır değil. Birazdan yeniden deneyin.");
      setQr(image.startsWith("data:") ? image : `data:image/png;base64,${image}`);
    } catch (e) {
      setQrError((e as Error).message);
    } finally {
      setQrBusy(false);
    }
  }
  useEffect(() => {
    if (!qrLine || !qr || demo) return;
    const timer = setInterval(() => void syncConnections(), 4000);
    return () => clearInterval(timer);
  }, [qrLine, qr]);
  useEffect(() => {
    if (!qrLine || !qr) return;
    const c = data.connections.find((x) => x.id === qrLine);
    const start = qrStart.current;
    if (c?.status !== "connected") {
      start.sawOff = true;
      return;
    }
    const renewed = Boolean(start.connectedAt && c.connectedAt && String(c.connectedAt) !== start.connectedAt);
    if (!start.connected || start.sawOff || renewed) {
      toast.success(`WhatsApp bağlandı${c.phone ? `: ${formatPhone(`+${c.phone}`)}` : ""}.`);
      setQrLine(null);
      setQr(null);
    }
  }, [data.connections, qrLine, qr]);
  const qrItem = all.find((l) => l.id === qrLine);

  // --- Hat ayarları ---------------------------------------------------------
  const [settings, setSettings] = useState<{ id: string; name: string; staff: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const settingsLine = all.find((l) => l.id === settings?.id);
  const openSettings = async (line: LineSummary) => {
    // Başka biri az önce değiştirmiş olabilir: pencere en güncel ad ve personel listesiyle açılır.
    const fresh = (await loadSummary())?.find((l) => l.id === line.id) || line;
    setSettings({ id: fresh.id, name: fresh.label, staff: fresh.staff.map((s) => s.id) });
  };
  // Listede olup artık çalışmayan personel de gösterilir; işaret kaldırılarak listeden çıkarılır.
  const staffOptions: StaffRef[] = [
    ...employees,
    ...(settingsLine?.staff || [])
      .filter((s) => !employees.some((e) => e.id === s.id))
      .map((s) => ({ ...s, active: false })),
  ];
  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await request(
        `/api/whatsapp/lines/${settings.id}/settings`,
        { name: settings.name.trim(), employeeIds: settings.staff },
        "PUT",
      );
      await refresh();
      await loadSummary();
      setSettings(null);
      toast.success("Hat ayarları kaydedildi.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const statusPill = (l: LineSummary) => (
    <span className={`lp-status ${l.status === "connected" ? "ok" : "off"}`}>
      {l.status === "connected" ? "Bağlı" : "Bağlı değil"}
    </span>
  );
  const today = (l: LineSummary) => (l.todayIn === null ? "—" : `${l.todayIn} gelen · ${l.todayOut} giden`);
  const chatCount = (l: LineSummary) =>
    l.chats === null ? (
      "—"
    ) : (
      <>
        {l.chats}
        {l.waiting ? (
          <>
            {" · "}
            <span className="lp-late" title="Son 7 günde yazıp henüz yanıt almayan sohbetler">
              {l.waiting} bekliyor
            </span>
          </>
        ) : null}
      </>
    );
  const staffChips = (l: LineSummary) => (
    <div className="lp-chips" aria-label="Yetkili personel">
      {l.staff.length ? (
        l.staff.map((s) => (
          <span className="lp-chip" key={s.id}>
            {s.name}
          </span>
        ))
      ) : (
        <span className="lp-chip none">Herkes</span>
      )}
    </div>
  );
  const actions = (l: LineSummary) => (
    <>
      <button
        type="button"
        className={`btn small ${l.status === "connected" ? "secondary" : "primary"}`}
        onClick={() => openQr(l.id)}
      >
        <QrCode size={15} />
        {l.status === "connected" ? "Yeniden bağla" : "QR okut"}
      </button>
      <button
        type="button"
        className="btn secondary small"
        onClick={() => (canManage ? void openSettings(l) : onDetail(l.id))}
      >
        <Settings2 size={15} />
        {canManage ? "Ayarlar" : "Hat bilgileri"}
      </button>
    </>
  );

  return (
    <div className="lp">
      <section className="lp-board" aria-label="Bağlı numaralar">
        <div className="lp-count">
          <strong>
            {connectedCount} <small>/ {all.length}</small>
          </strong>
          <span>numara bağlı</span>
        </div>
        <div className="lp-cells" role="img" aria-label={`${all.length} numaradan ${connectedCount} tanesi bağlı`}>
          {all.map((l) => (
            <span
              key={l.id}
              className={`lp-cell ${l.status === "connected" ? "ok" : ""}`}
              title={`${l.name} · ${formatPhone(l.phone)}`}
            />
          ))}
        </div>
      </section>

      <div className="lp-bar">
        <label className="lp-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ad, numara veya SIM kart numarası ara"
            aria-label="Ad, numara veya SIM kart numarası ara"
          />
        </label>
        <div className="lp-view" role="group" aria-label="Görünüm">
          <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}>
            <LayoutGrid size={15} />
            Kart
          </button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
            <List size={15} />
            Liste
          </button>
        </div>
        <select value={group} onChange={(e) => onGroup(e.target.value)} aria-label="Hat grubu">
          <option value="all">Tüm hizmet grupları</option>
          {Object.entries(groupNames).map(([g, n]) => (
            <option key={g} value={g}>
              {n}
            </option>
          ))}
        </select>
        <span className="lp-total">{filtered.length} hat</span>
        {canEditInventory && (
          <button type="button" className="btn secondary small" onClick={onBulkEdit}>
            <Pencil size={14} />
            Toplu düzenle
          </button>
        )}
      </div>
      <p className="lp-hint">
        Her numara ayrı bir WhatsApp hattıdır. Yetkili personel seçilen hattın sohbetlerini yalnız o kişiler görür ve
        yanıtlar.
      </p>

      {!all.length ? (
        summary && lines.length ? (
          <Empty
            title="Size atanmış hat yok"
            description="Bir hattın sohbetlerini görmek için yöneticinizden sizi o hatta yetkili personel olarak eklemesini isteyin."
          />
        ) : (
          <Empty
            title="Henüz hat eklenmemiş"
            description={
              canEditInventory
                ? "“Toplu düzenle” ile numaralarınızı ekleyin."
                : "Hatlar eklendiğinde burada görünür."
            }
          />
        )
      ) : !filtered.length ? (
        <Empty title="Hat bulunamadı" description="Aramayı değiştirin ya da başka bir hizmet grubu seçin." />
      ) : view === "cards" ? (
        <div className="lp-cards">
          {filtered.map((l) => {
            const ok = l.status === "connected";
            return (
              <article className={`lp-card ${ok ? "ok" : "off"}`} key={l.id}>
                <header>
                  <h3 title={l.name}>{l.name}</h3>
                  {statusPill(l)}
                </header>
                <div className="lp-profile">
                  <span className="lp-avatar" aria-hidden="true">
                    {lineInitials(l.profileName || l.name)}
                  </span>
                  <div>
                    <b>{l.profileName || (ok ? "WhatsApp profili" : "Profil bekleniyor")}</b>
                    <span>{ok ? formatPhone(l.phone) : `QR okutulmadı · ${formatPhone(l.phone)}`}</span>
                  </div>
                </div>
                <dl className="lp-facts">
                  <dt>Bağlandı</dt>
                  <dd>{ok ? longDay(l.connectedAt) : "—"}</dd>
                  <dt>Son mesaj</dt>
                  <dd>{timeAgo(l.lastMessageAt)}</dd>
                  <dt>Bugün</dt>
                  <dd>{today(l)}</dd>
                  <dt>Sohbet</dt>
                  <dd>{chatCount(l)}</dd>
                </dl>
                {staffChips(l)}
                <footer>{actions(l)}</footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="lp-list" role="table" aria-label="Hat listesi">
          <div className="lp-row head" role="row">
            <span role="columnheader">Hat</span>
            <span role="columnheader">Numara</span>
            <span role="columnheader">Durum</span>
            <span role="columnheader">Son mesaj</span>
            <span role="columnheader">Bugün</span>
            <span role="columnheader">Sohbet</span>
            <span role="columnheader">Yetkili personel</span>
            <span role="columnheader" />
          </div>
          {filtered.map((l) => (
            <div className="lp-row" role="row" key={l.id}>
              <span role="cell" data-label="Hat">
                <b>{l.name}</b>
                <small>{groupNames[l.group]}</small>
              </span>
              <span role="cell" data-label="Numara">
                <b className="lp-num">{formatPhone(l.phone)}</b>
                <small>{l.profileName || (l.status === "connected" ? "WhatsApp profili" : "QR okutulmadı")}</small>
              </span>
              <span role="cell" data-label="Durum">
                {statusPill(l)}
              </span>
              <span role="cell" data-label="Son mesaj">
                {timeAgo(l.lastMessageAt)}
              </span>
              <span role="cell" data-label="Bugün">
                {today(l)}
              </span>
              <span role="cell" data-label="Sohbet">
                {chatCount(l)}
              </span>
              <span role="cell" data-label="Yetkili personel">
                {staffChips(l)}
              </span>
              <span role="cell" className="lp-acts">
                {actions(l)}
              </span>
            </div>
          ))}
        </div>
      )}

      {settings && settingsLine && (
        <Modal
          title="Hat ayarları"
          subtitle={`${settingsLine.name} · ${formatPhone(settingsLine.phone)}`}
          onClose={() => setSettings(null)}
        >
          <div className="modal-content lp-settings">
            <label>
              Hat adı
              <input
                value={settings.name}
                maxLength={120}
                onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                placeholder="ör. Satış hattı"
              />
            </label>
            <fieldset>
              <legend>Yetkili personel</legend>
              <p className="lp-settings-note">
                {settings.staff.length
                  ? "Bu hattın sohbetlerini yalnız seçtiğiniz kişiler görür ve yanıtlar."
                  : "Kimse seçilmezse WhatsApp yetkisi olan herkes bu hattı kullanır."}
              </p>
              {staffOptions.length ? (
                <div className="lp-staff-list">
                  {staffOptions.map((e) => (
                    <label key={e.id} className="lp-staff-item">
                      <input
                        type="checkbox"
                        checked={settings.staff.includes(e.id)}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            staff: event.target.checked
                              ? [...settings.staff, e.id]
                              : settings.staff.filter((id) => id !== e.id),
                          })
                        }
                      />
                      <span>
                        {e.active === false && e.name !== "Ayrılan personel" ? `${e.name} (pasif)` : e.name}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="lp-settings-note">Henüz personel eklenmemiş. Personeli Kullanıcılar sayfasından ekleyin.</p>
              )}
            </fieldset>
          </div>
          <footer className="modal-footer">
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                const id = settings.id;
                setSettings(null);
                onDetail(id);
              }}
            >
              Numara ve SIM bilgileri
            </button>
            <button type="button" className="btn primary" onClick={() => void saveSettings()} disabled={saving}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </footer>
        </Modal>
      )}

      {all.length > 0 && (
        <p className="lp-footnote">
          Kayıtlı toplam {lines.length} hat · {lines.filter((l) => l.iccid).length} SIM kart numarası
        </p>
      )}

      {qrLine && (
        <Modal
          title="WhatsApp hesabını bağlayın"
          subtitle={qrItem ? `${qrItem.name} · ${formatPhone(qrItem.phone)}` : ""}
          onClose={() => setQrLine(null)}
        >
          <div className="qr-modal">
            <div className="qr-instructions">
              <span>1</span>
              <p>
                Telefonunuzda <strong>WhatsApp’ı</strong> açın.
              </p>
              <span>2</span>
              <p>
                <strong>Ayarlar → Bağlı cihazlar</strong> bölümüne gidin.
              </p>
              <span>3</span>
              <p>“Cihaz bağla” seçeneğiyle QR kodu tarayın.</p>
            </div>
            <div className={`qr-space ${qr ? "ready" : ""}`}>
              {qrBusy ? (
                <>
                  <RefreshCw size={30} className="spin" />
                  <p>Güvenli oturum oluşturuluyor…</p>
                </>
              ) : qr ? (
                <img src={qr} alt="WhatsApp bağlantı QR kodu" />
              ) : (
                <>
                  <QrCode size={65} strokeWidth={1} />
                  <h3>QR kodu alınamadı</h3>
                  <p>{qrError}</p>
                </>
              )}
            </div>
            <button
              type="button"
              className="btn secondary full-width"
              onClick={() => void loadQr(qrLine)}
              disabled={qrBusy}
            >
              <RefreshCw size={16} />
              QR kodunu yenile
            </button>
            <div className="qr-note">
              <ShieldCheck size={15} />
              Kod okutulunca bu pencere kendiliğinden kapanır.
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
