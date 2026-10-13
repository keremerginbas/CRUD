import { useEffect, useState } from "react";
import { ChevronDown, KeyRound, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Badge } from "./ui";
import {
  SETTING_GROUPS,
  type SettingGroup,
  type SettingStatus,
} from "../../../../shared/integration-settings";
import "../integration-settings.css";

function GroupCard({
  group,
  status,
  onSaved,
}: {
  group: SettingGroup;
  status: Record<string, SettingStatus>;
  onSaved: (s: SettingStatus[]) => void;
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
      const url = group.test === "pbx" ? "/api/pbx/test" : `/api/integrations/${group.test}/test`;
      const r = await request(url, {});
      toast.success(r.message || "Bağlantı başarılı.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <details className="is-group">
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
              <code>{f.key}</code>
            </div>
          );
        })}
      </div>
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
    <section className="panel is-panel">
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
          {SETTING_GROUPS.map((g) => (
            <GroupCard key={g.id} group={g} status={status} onSaved={setSettings} />
          ))}
        </div>
      )}
    </section>
  );
}
