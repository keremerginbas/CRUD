// Telefonu lead'de değil bağlı kişide olan (tekrarlayan) lead'lerin kişi ID'leri
const kisiIdleri = [
  ...new Set(
    $('Bitrix: Kuyruktaki Leadler')
      .all()
      .flatMap((i) => (Array.isArray(i.json.result) ? i.json.result : []))
      .filter((l) => !leadTelefonu(l) && l.CONTACT_ID)
      .map((l) => String(l.CONTACT_ID))
  ),
].slice(0, 50);

return [{ json: { kisiIdleri } }];
