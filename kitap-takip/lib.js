// Panelin kullandığı saf yardımcılar (tarayıcıda ve testlerde ortak).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KitapTakipLib = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const STATUS_LABEL = {
    in_stock: 'Stokta',
    out_of_stock: 'Tükendi',
    preorder: 'Ön sipariş',
    no_buy_button: 'Satışa kapalı',
    not_listed: 'Listelenmiyor',
    blocked: 'Doğrulama bekliyor',
    error: 'Açılamadı',
    unknown: 'Belirsiz',
  };
  // Bu durumlar "okuyamadık" demektir; değişiklik hesabına katılmaz.
  const UNREADABLE = new Set(['blocked', 'error', 'unknown']);

  const dayKey = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function latestByTarget(snapshots) {
    const map = {};
    for (const s of snapshots) if (!map[s.targetId] || s.ts > map[s.targetId].ts) map[s.targetId] = s;
    return map;
  }

  // Art arda iki okuma arasındaki farkları olaya çevirir.
  function deriveEvents(snapshots) {
    const events = [];
    const byTarget = {};
    for (const s of [...snapshots].sort((a, b) => a.ts - b.ts)) {
      if (UNREADABLE.has(s.status)) continue;
      const prev = byTarget[s.targetId];
      byTarget[s.targetId] = s;
      if (!prev) continue;
      const push = (field, from, to) => events.push({ ts: s.ts, targetId: s.targetId, field, from, to });
      if (prev.status !== s.status) push('status', prev.status, s.status);
      for (const f of ['price', 'stockQty', 'edition', 'reviewCount', 'rank', 'leadTime', 'sellers']) {
        const a = prev[f], b = s[f];
        if (a != null && b != null && a !== b) push(f, a, b);
      }
    }
    return events.sort((a, b) => b.ts - a.ts);
  }

  // Son `days` gün için günlük durum şeridi; o gün okuma yoksa null.
  function dayStrip(snapshots, targetId, days, now) {
    const perDay = {};
    for (const s of snapshots) {
      if (s.targetId !== targetId) continue;
      const k = dayKey(s.ts);
      const cur = perDay[k];
      // Aynı gün okunabilir bir kayıt varsa onu, yoksa en sonuncuyu göster.
      if (!cur || (UNREADABLE.has(cur.status) && !UNREADABLE.has(s.status)) || (UNREADABLE.has(cur.status) === UNREADABLE.has(s.status) && s.ts > cur.ts)) perDay[k] = s;
    }
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = dayKey(now - i * 86400000);
      out.push({ day: k, snapshot: perDay[k] || null });
    }
    return out;
  }

  function toCsv(snapshots, targets) {
    const name = Object.fromEntries(targets.map((t) => [t.id, t.name]));
    const cols = ['ts', 'site', 'status', 'stockQty', 'stockQtySource', 'stockQtyPlaceholder', 'maxOrderQty', 'price', 'currency', 'leadTime', 'edition', 'rating', 'reviewCount', 'rank', 'sellers', 'counts', 'note'];
    const cell = (v) => {
      if (v == null) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [...snapshots].sort((a, b) => a.ts - b.ts).map((s) =>
      cols.map((c) => cell(c === 'ts' ? new Date(s.ts).toISOString() : c === 'site' ? name[s.targetId] || s.targetId : c === 'status' ? STATUS_LABEL[s.status] || s.status : s[c])).join(','));
    return '﻿' + [cols.join(','), ...rows].join('\n');
  }

  return { STATUS_LABEL, UNREADABLE, dayKey, latestByTarget, deriveEvents, dayStrip, toCsv };
});
