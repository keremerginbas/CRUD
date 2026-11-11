// Panelin kullandığı saf yardımcılar (tarayıcıda ve testlerde ortak).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KitapTakipLib = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const STATUS_LABEL = {
    in_stock: 'Stokta',
    on_order: 'Siparişle temin',
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

  // Başlık karşılaştırması için: büyük/küçük harf, Türkçe harf ve noktalama farklarını yok sayar.
  const normTitle = (s) => (s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]/g, '');

  const dayKey = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function latestByTarget(snapshots) {
    const map = {};
    for (const s of snapshots) if (!map[s.targetId] || s.ts > map[s.targetId].ts) map[s.targetId] = s;
    return map;
  }

  // Sitenin gerçekten paylaştığı stok adedi; yer tutucu değerler (100, 999999) sayılmaz.
  const realQty = (s) => (s && s.stockQty != null && !s.stockQtyPlaceholder ? s.stockQty : null);
  const SELLABLE = new Set(['in_stock', 'on_order', 'preorder']);
  const isRankJump = (prev, s) => prev.rank != null && s.rank != null && s.rank < prev.rank * 0.85;

  // Bir sitenin kayıtlarından satış işaretlerini çıkarır. Hiçbiri kesin satış adedi değildir;
  // "satın alma sayacı" sitenin kendi beyanı, diğerleri dolaylı göstergedir.
  function salesSignals(snapshots, targetId, sinceTs) {
    const rows = snapshots.filter((s) => s.targetId === targetId && !UNREADABLE.has(s.status)).sort((a, b) => a.ts - b.ts);
    const out = { readings: 0, hasRealStock: false, stockDrop: 0, stockRise: 0, soldOut: 0, restocked: 0, rankJumps: 0, hasRank: false, soldGain: null, soldCount: null, reviewGain: null };
    let prev = null;
    for (const s of rows) {
      const inWindow = s.ts >= sinceTs;
      if (inWindow) out.readings++;
      if (realQty(s) != null) out.hasRealStock = true;
      if (s.rank != null) out.hasRank = true;
      if (s.soldCount != null) out.soldCount = s.soldCount;
      if (prev && inWindow) {
        const a = realQty(prev), b = realQty(s);
        if (a != null && b != null) { if (b < a) out.stockDrop += a - b; else out.stockRise += b - a; }
        if (SELLABLE.has(prev.status) && s.status === 'out_of_stock') out.soldOut++;
        if (prev.status === 'out_of_stock' && SELLABLE.has(s.status)) out.restocked++;
        // Sıralama numarasının belirgin biçimde küçülmesi, arada en az bir satış olduğunu gösterir.
        if (isRankJump(prev, s)) out.rankJumps++;
        if (prev.soldCount != null && s.soldCount != null && s.soldCount > prev.soldCount) out.soldGain = (out.soldGain || 0) + (s.soldCount - prev.soldCount);
        if (prev.reviewCount != null && s.reviewCount != null && s.reviewCount > prev.reviewCount) out.reviewGain = (out.reviewGain || 0) + (s.reviewCount - prev.reviewCount);
      }
      prev = s;
    }
    return out;
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
      for (const f of ['price', 'edition', 'reviewCount', 'soldCount', 'leadTime', 'sellers', 'seller']) {
        const a = prev[f], b = s[f];
        if (a != null && b != null && a !== b) push(f, a, b);
      }
      // Sıralama her gün oynar; yalnızca belirgin yükselişler (olası satış) olay sayılır.
      if (isRankJump(prev, s)) push('rank', prev.rank, s.rank);
      const qa = realQty(prev), qb = realQty(s);
      if (qa != null && qb != null && qa !== qb) push('stockQty', qa, qb);
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
    const cols = ['ts', 'site', 'status', 'seller', 'sellerList', 'stockQty', 'stockQtySource', 'stockQtyPlaceholder', 'maxOrderQty', 'cartLimit', 'cartLimitCapped', 'cartNote', 'soldCount', 'price', 'listPrice', 'currency', 'leadTime', 'edition', 'rating', 'reviewCount', 'rank', 'sellers', 'counts', 'signals', 'note'];
    const cell = (v) => {
      if (v == null) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [...snapshots].sort((a, b) => a.ts - b.ts).map((s) =>
      cols.map((c) => cell(c === 'ts' ? new Date(s.ts).toISOString() : c === 'site' ? name[s.targetId] || s.targetId : c === 'status' ? STATUS_LABEL[s.status] || s.status : s[c])).join(','));
    return '﻿' + [cols.join(','), ...rows].join('\n');
  }

  // Bir okumanın, aynı sitenin önceki okunabilir kaydına göre getirdiği değişiklikler.
  function newEvents(snapshots, snapshot) {
    return deriveEvents(snapshots.filter((s) => s.targetId === snapshot.targetId)).filter((e) => e.ts === snapshot.ts);
  }

  const FIELD_LABEL = { price: 'Fiyat', stockQty: 'Stok adedi', soldCount: 'Satın alma sayacı', edition: 'Baskı', reviewCount: 'Yorum sayısı', rank: 'Satış sıralaması', leadTime: 'Temin süresi', sellers: 'Satıcı sayısı', seller: 'Satıcı' };

  // Olayın okura gösterilen cümlesi (panelde ve Telegram mesajında aynı).
  function describeEvent(e) {
    const label = (st) => STATUS_LABEL[st] || st;
    const show = (v) => (typeof v === 'number' ? v.toLocaleString('tr-TR') : v);
    if (e.field === 'status') {
      if (e.to === 'out_of_stock') return 'Stok tükendi';
      if (e.to === 'in_stock' && e.from !== 'in_stock') return `Yeniden stokta (önceki durum: ${label(e.from)})`;
      return `Durum değişti: ${label(e.from)} → ${label(e.to)}`;
    }
    if (e.field === 'stockQty') return e.to < e.from ? `Stoktan ${e.from - e.to} adet düştü (kalan: ${e.to})` : `Stoka ${e.to - e.from} adet girdi (toplam: ${e.to})`;
    if (e.field === 'soldCount' && e.to > e.from) return `${e.to - e.from} adet satıldı (satın alma sayacı ${show(e.from)} → ${show(e.to)})`;
    if (e.field === 'rank') return `Satış sıralaması yükseldi: ${show(e.from)}. sıradan ${show(e.to)}. sıraya (arada satış olmuş olabilir)`;
    if (e.field === 'edition' && e.to > e.from) return `${e.to}. baskı göründü (önceki: ${e.from}. baskı)`;
    return `${FIELD_LABEL[e.field] || e.field}: ${show(e.from)} → ${show(e.to)}`;
  }

  // --- Sepet sınırı ölçümü ---

  const CART_REASON = {
    already_in_cart: 'Kitap zaten sepetinizde olduğu için ölçüm yapılmadı; sepetinize dokunulmadı.',
    login: 'Sepet sayfası giriş istedi; ölçüm yapılamadı. Sitede oturum açıp yeniden deneyin.',
    blocked: 'Sepet sayfası doğrulama istedi; ölçüm yapılamadı.',
    no_add_button: 'Ürün sayfasında "Sepete ekle" düğmesi bulunamadı; ölçüm yapılamadı.',
    not_in_cart: 'Kitap sepete eklenemedi ya da sepette bulunamadı; ölçüm yapılamadı.',
    error: 'Ölçüm sırasında beklenmeyen bir hata oldu.',
  };
  const CART_WARNING = 'Ölçümden sonra kitap sepetinizden çıkarılamadı; sepetinizi kontrol edin.';
  const CART_EVERY_MS = 20 * 3600000; // günde bir ölçüm
  const CART_CARRY_MS = 36 * 3600000; // son ölçümün geçerli sayıldığı süre

  // Adresteki ürün kodu: Amazon'da ASIN, Hepsiburada'da SKU gibi.
  function urlIds(url) {
    let path = '';
    try { path = new URL(url).pathname; } catch (e) { return []; }
    return [...new Set((path.match(/[A-Za-z0-9]{10,}/g) || []).filter((t) => /\d/.test(t) && /^[A-Z0-9]+$/.test(t)))];
  }

  // Ölçüm sonucunu taramanın kaydına işler.
  function applyCartResult(data, res, now) {
    const out = { ...data, cartCheckedAt: now };
    if (res.cleaned === false) out.cartWarning = CART_WARNING;
    if (!res.ok) return { ...out, cartNote: CART_REASON[res.reason] || CART_REASON.error };
    out.cartLimit = res.limit;
    out.cartLimitCapped = !!res.capped;
    if (res.note) out.cartNote = res.note;
    // Sınıra gerçekten ulaşıldıysa ve sayfa kendi stokunu yazmıyorsa, sınır stok adedi sayılır.
    if (res.limit != null && !res.capped && realQty(data) == null) {
      out.stockQty = res.limit;
      out.stockQtySource = 'sepet sınırı';
      out.stockQtyPlaceholder = false;
    }
    return out;
  }

  const lastCartCheck = (snapshots, targetId) => snapshots.filter((s) => s.targetId === targetId && s.cartCheckedAt != null).sort((a, b) => b.cartCheckedAt - a.cartCheckedAt)[0] || null;

  function cartProbeDue(snapshots, targetId, now) {
    const last = lastCartCheck(snapshots, targetId);
    return !last || now - last.cartCheckedAt >= CART_EVERY_MS;
  }

  // Ölçüm yapılmayan taramada son ölçümün sonucunu kayda taşır.
  function carryCartLimit(data, snapshots, targetId, now) {
    const last = lastCartCheck(snapshots, targetId);
    if (!last || last.cartLimit == null || now - last.cartCheckedAt > CART_CARRY_MS || !SELLABLE.has(data.status)) return data;
    const out = { ...data, cartLimit: last.cartLimit, cartLimitCapped: !!last.cartLimitCapped, cartCheckedAt: last.cartCheckedAt };
    if (last.cartNote) out.cartNote = last.cartNote;
    if (!last.cartLimitCapped && realQty(data) == null) {
      out.stockQty = last.cartLimit;
      out.stockQtySource = 'sepet sınırı';
      out.stockQtyPlaceholder = false;
    }
    return out;
  }

  return { applyCartResult, cartProbeDue, carryCartLimit, urlIds, STATUS_LABEL, UNREADABLE, normTitle, realQty, salesSignals, dayKey, latestByTarget, deriveEvents, newEvents, describeEvent, dayStrip, toCsv };
});
