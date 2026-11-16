import { useEffect, useState } from "react";
import { ChevronDown, Copy, KeyRound, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Badge } from "./ui";
import {
  SETTING_GROUPS,
  type SettingGroup,
  type SettingStatus,
} from "../../../../shared/integration-settings";
import "../integration-settings.css";

/** Netsantral paneline yapıştırılacak bildirim adresi (API şifresi tarayıcıya gelmez). */
function NetsantralWebhook({ refreshKey }: { refreshKey: string }) {
  const { request } = useStore();
  const [info, setInfo] = useState<{ webhookUrl: string; missing: string[]; active: boolean; portalPath: string } | null>(null);
  useEffect(() => {
    request("/api/pbx/netsantral")
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [refreshKey]);
  if (!info) return null;
  const copy = () =>
    navigator.clipboard
      .writeText(info.webhookUrl)
      .then(() => toast.success("Adres kopyalandı."))
      .catch(() => toast.error("Kopyalanamadı; adresi elle seçip kopyalayın."));
  return (
    <div className="is-webhook">
      <label htmlFor="is-netsantral-webhook">Netsantral'a yapıştırılacak bildirim adresi</label>
      {info.webhookUrl ? (
        <div className="is-input">
          <input id="is-netsantral-webhook" readOnly value={info.webhookUrl} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn secondary small" onClick={() => void copy()}>
            <Copy size={14} /> Kopyala
          </button>
        </div>
      ) : (
        <small>Adres oluşturulamadı. Önce "Genel" bölümüne CRM genel adresini yazın.</small>
      )}
      <small>
        Netsantral panelinde {info.portalPath} bölümüne bu adresi yapıştırıp etkinleştirin. Gelen aramalar ve görüşme
        kayıtları CRM'e bu adresten gelir. Adres gizlidir; kimseyle paylaşmayın.
      </small>
      {info.missing.length > 0 && <small>Eksik alanlar: {info.missing.join(", ")}.</small>}
      {!info.active && info.missing.length === 0 && (
        <small>Şu an başka bir santral sürücüsü seçili. Netsantral'ı kullanmak için "Santral" bölümündeki Sürücü alanına netsantral yazın.</small>
      )}
    </div>
  );
}

function GroupCard({
  group,
  status,
  onSaved,
  open = false,
}: {
  group: SettingGroup;
  status: Record<string, SettingStatus>;
  onSaved: (s: SettingStatus[]) => void;
  open?: boolean;
}) {
  const { request } = useStore();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const configured = group.fields.filter((f) => status[f.key]?.configured).length;
  const dirty = Object.keys(draft).length > 0;

  const save = async (values: Record<string, string | null>) => {
    setBusy("save");
    try {
      const r = await request("/api/settings/integrations", { values }, "PUT");
      onSaved(r.settings);
      setDraft({});
      toast.success(`${group.title} ayarları kaydedildi.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const test = async () => {
    if (!group.test) return;
    setBusy("test");
    try {
      const pbx = group.test === "pbx" || group.test === "netsantral";
      const url = pbx ? "/api/pbx/test" : `/api/integrations/${group.test}/test`;
      const r = await request(url, group.test === "netsantral" ? { driver: "netsantral" } : {});
      toast.success(r.message || "Bağlantı başarılı.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <details className={`is-group ${open ? "is-inline" : ""}`} open={open}>
      <summary>
        <span>
          <strong>{group.title}</strong>
          <small>{group.description.replace("{origin}", location.origin)}</small>
        </span>
        <Badge tone={configured ? (configured === group.fields.length ? "green" : "blue") : "gray"}>
          {configured}/{group.fields.length}
        </Badge>
        <ChevronDown size={16} />
      </summary>
      <div className="is-fields">
        {group.fields.map((f) => {
          const s = status[f.key];
          const placeholder = s?.configured
            ? f.secret
              ? `${s.preview} · kayıtlı (değiştirmek için yazın)`
              : s.preview
            : f.placeholder || "";
          const common = {
            id: `is-${f.key}`,
            value: draft[f.key] ?? (f.secret || !s?.configured ? "" : s.preview),
            placeholder,
            autoComplete: "off",
            onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
              setDraft({ ...draft, [f.key]: e.target.value }),
          };
          return (
            <div key={f.key} className="is-field">
              <label htmlFor={`is-${f.key}`}>
                {f.label}
                {s?.source === "env" && <em>.env</em>}
                {s?.source === "ui" && <em className="ui">arayüz</em>}
              </label>
              <div className="is-input">
                {f.multiline ? (
                  <textarea rows={3} {...common} />
                ) : (
                  <input type={f.secret ? "password" : "text"} {...common} />
                )}
                {s?.source === "ui" && (
                  <button
                    className="icon-button"
                    aria-label={`${f.label} sil`}
                    title="Arayüzde kayıtlı değeri sil"
                    onClick={() => void save({ [f.key]: null })}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              {f.help && <small>{f.help}</small>}
            </div>
          );
        })}
      </div>
      {group.id === "netsantral" && (
        <NetsantralWebhook refreshKey={group.fields.map((f) => status[f.key]?.preview || "").join("|")} />
      )}
      <footer>
        {group.test && (
          <button className="btn secondary small" disabled={!!busy} onClick={() => void test()}>
            <RefreshCw size={14} className={busy === "test" ? "spin" : ""} /> Bağlantıyı test et
          </button>
        )}
        <button className="btn primary small" disabled={!dirty || !!busy} onClick={() => void save(draft)}>
          <Save size={14} /> Kaydet
        </button>
      </footer>
    </details>
  );
}

/** Tek bir bağlantının ayarları (Entegrasyonlar sayfasındaki "Bağla" penceresi içinde). */
export function ProviderSettings({ groupId, onChanged }: { groupId: string; onChanged?: () => void }) {
  const { demo, user, request } = useStore();
  const [settings, setSettings] = useState<SettingStatus[] | null>(null);
  const owner = !demo && Boolean(user?.isOwner);
  const group = SETTING_GROUPS.find((g) => g.id === groupId);
  useEffect(() => {
    if (!owner) return;
    request("/api/settings/integrations")
      .then((r) => setSettings(r.settings))
      .catch((e: Error) => toast.error(e.message));
  }, [owner, groupId]);
  if (!group) return null;
  if (!owner)
    return (
      <p className="is-note">
        {demo ? "Demo modunda bağlantı bilgisi girilmez. Canlı modda yönetici hesabıyla açın." : "Bağlantı bilgilerini yalnız çalışma alanı sahibi düzenleyebilir."}
      </p>
    );
  if (!settings) return <p className="is-note">Yükleniyor…</p>;
  return (
    <GroupCard
      group={group}
      open
      status={Object.fromEntries(settings.map((s) => [s.key, s]))}
      onSaved={(next) => {
        setSettings(next);
        onChanged?.();
      }}
    />
  );
}

/** Sahip için: tüm entegrasyon anahtarlarını arayüzden şifreli kaydetme. */
export default function IntegrationSettings() {
  const { demo, user, request } = useStore();
  const [settings, setSettings] = useState<SettingStatus[] | null>(null);
  const owner = !demo && Boolean(user?.isOwner);
  useEffect(() => {
    if (!owner) return;
    request("/api/settings/integrations")
      .then((r) => setSettings(r.settings))
      .catch((e: Error) => toast.error(e.message));
  }, [owner]);
  const status = Object.fromEntries((settings || []).map((s) => [s.key, s]));

  return (
    <details className="panel is-panel is-all">
      <summary>Tüm gelişmiş ayarlar (takvim, sosyal giriş, genel adres…)</summary>
      <header>
        <span className="rule-icon blue"><KeyRound size={20} /></span>
        <div>
          <h3>Anahtarlar ve bağlantı ayarları</h3>
          <p>
            Değerler sunucuda AES-256 ile şifrelenir, kaydedince hemen etkinleşir; tarayıcıya yalnız son 4 karakter gelir.
            <code>.env</code> dosyası düzenlemeniz gerekmez.
          </p>
        </div>
        <ShieldCheck size={20} className="green-text" />
      </header>
      {!owner ? (
        <p className="is-note">
          {demo ? "Demo modunda anahtar girilmez. Canlı modda yönetici hesabıyla açın." : "Anahtarları yalnız çalışma alanı sahibi düzenleyebilir."}
        </p>
      ) : !settings ? (
        <p className="is-note">Yükleniyor…</p>
      ) : (
        <div className="is-groups">
          {SETTING_GROUPS.filter((g) => !g.hidden).map((g) => (
            <GroupCard key={g.id} group={g} status={status} onSaved={setSettings} />
          ))}
        </div>
      )}
    </details>
  );
}
