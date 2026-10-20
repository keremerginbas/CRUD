/* ==================================================================
   XRE Operasyon Paneli — Bitrix Randevu Yaması
   index.html içinde </body> etiketinden HEMEN ÖNCE şu satırı ekleyin:
       <script src="./randevu-bitrix-patch.js"></script>
   Mevcut kodun hiçbir yerini değiştirmeye gerek yok; bu betik
   ekrandaki RANDEVU değerlerini Bitrix verisiyle üzerine yazar.
   ================================================================== */
(function () {
  'use strict';

  var API = './api/bitrix-appointments.php';
  var state = { toplam: null, byName: {}, gunBazinda: {}, hata: null };

  /* Aktif sekmenin gerçek tarih seçicisini okur. */
  function donem() {
    var f = function (d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    var repPage = document.getElementById('p-temsilciler');
    var repActive = repPage && repPage.classList.contains('active');
    var selId = repActive ? 'repPeriyot' : 'genelPeriyot';
    var startId = repActive ? 'repStart' : 'genelStart';
    var endId = repActive ? 'repEnd' : 'genelEnd';
    var sel = document.getElementById(selId);
    var value = String(sel ? sel.value : 'bugun').toLowerCase();
    var to = new Date(), from = new Date(to), label = 'bugün';
    if (value === 'dun') {
      from.setDate(from.getDate() - 1); to = new Date(from); label = 'dün';
    } else if (value === 'custom') {
      var a = document.getElementById(startId), b = document.getElementById(endId);
      if (a && b && a.value && b.value) return {from:a.value,to:b.value,label:a.value+' – '+b.value};
    } else if (value === 'hepsi') {
      return {from:'2020-01-01',to:f(to),label:'tüm zamanlar'};
    } else if (/^\d+$/.test(value)) {
      var gun = Math.max(1, parseInt(value, 10));
      from.setDate(from.getDate() - (gun - 1)); label = 'son '+gun+' gün';
    }
    return { from: f(from), to: f(to), label: label };
  }

  function normAd(s) {
    return String(s || '').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
  }

  function cek() {
    var d = donem();
    return fetch(API + '?from=' + d.from + '&to=' + d.to, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.ok !== true) throw new Error((j && j.error) || 'Bitrix randevu verisi alınamadı');
        state.hata = null;
        state.toplam = j.toplam_randevu;
        state.gunBazinda = j.gun_bazinda || {};
        state.byName = {};
        (j.temsilci_bazinda || []).forEach(function (t) {
          state.byName[normAd(t.ad)] = t.randevu;
        });
        boya();
      })
      .catch(function (e) { state.hata = e.message; boya(); });
  }

  /* --- Genel Bakış KPI kartı --- */
  function boyaKpi() {
    var kpis = document.querySelectorAll('#genelKpis .kpi');
    for (var i = 0; i < kpis.length; i++) {
      var lab = kpis[i].querySelector('.l');
      if (!lab || normAd(lab.textContent) !== 'randevu') continue;
      var v = kpis[i].querySelector('.v');
      var s = kpis[i].querySelector('.s');
      if (state.hata) {
        if (s) s.textContent = 'Bitrix bağlantı hatası';
        return;
      }
      if (state.toplam === null) return;
      if (v) v.textContent = state.toplam;
      if (s) s.textContent = 'Bitrix CRM kaydı · ' + donem().label;
      kpis[i].setAttribute('data-kaynak', 'bitrix');
    }
    try {
      if (typeof charts !== 'undefined' && charts.chTrend) {
        var chart = charts.chTrend;
        var ds = (chart.data.datasets || []).find(function (x) { return normAd(x.label) === 'randevu'; });
        if (ds) {
          ds.data = (chart.data.labels || []).map(function (label) {
            var p = String(label).split('.');
            var key = p.length === 3 ? p[2]+'-'+p[1]+'-'+p[0] : String(label);
            return Number(state.gunBazinda[key] || 0);
          });
          chart.update('none');
        }
      }
    } catch (_) { /* grafik oluşmadıysa sonraki çizimde denenir */ }
  }

  /* --- Temsilci Karnesi kartları --- */
  function boyaKarne() {
    var cards = document.querySelectorAll('#repList .repcard');
    for (var i = 0; i < cards.length; i++) {
      var adEl = cards[i].querySelector('.rephead b');
      if (!adEl) continue;
      var ad = normAd(adEl.textContent);
      if (!(ad in state.byName)) continue;
      var stats = cards[i].querySelectorAll('.repstat');
      var gorusme = null, randevuEl = null, donusumEl = null;
      for (var k = 0; k < stats.length; k++) {
        var etiket = normAd(stats[k].querySelector('span') ? stats[k].querySelector('span').textContent : '');
        var deger = stats[k].querySelector('b');
        if (etiket === 'görüşme') gorusme = parseInt(deger.textContent, 10) || 0;
        if (etiket === 'randevu') randevuEl = deger;
        if (etiket === 'dönüşüm') donusumEl = deger;
      }
      var r = state.byName[ad];
      if (randevuEl) randevuEl.textContent = r;
      if (donusumEl && gorusme) donusumEl.textContent = '%' + Math.round(100 * r / gorusme);
    }
  }

  function boya() { try { boyaKpi(); boyaKarne(); } catch (e) { /* sessiz */ } }

  /* Panel kendi verisini yeniden çizdiğinde tekrar üzerine yaz. */
  var obs = new MutationObserver(function () {
    clearTimeout(obs._t);
    obs._t = setTimeout(boya, 120);
  });

  function baslat() {
    ['genelKpis', 'repList'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) obs.observe(el, { childList: true, subtree: true });
    });
    cek();
    setInterval(cek, 180000); // 3 dakikada bir tazele
    document.addEventListener('change', function (e) {
      if (e.target && /^(genel|rep)(Periyot|Start|End)$/.test(e.target.id || '')) setTimeout(cek, 300);
    });
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('nav button')) setTimeout(cek, 250);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', baslat);
  else baslat();
})();
