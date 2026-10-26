// Resmi kaynak kontrol listesi. Kesin bilinen adresler dogrudan, adresi belediyeye/yila gore degisenler
// arama baglantisi olarak verilir; uydurma derin baglanti uretilmez.
const search=q=>'https://www.google.com/search?q='+encodeURIComponent(q);

export function officialSources(parcel={},year=new Date().getFullYear()){
 const {province='',district='',neighborhood='',block='',parcel:number=''}=parcel;
 const place=[province,district,neighborhood].filter(Boolean).join(' ');
 const adaParsel=block&&number?`${block} ada ${number} parsel`:'';
 return [
  {id:'tkgm',group:'Kadastro',title:'TKGM Parsel Sorgu',detail:'Resmî kadastro sınırı, yüzölçümü ve nitelik.',url:'https://parselsorgu.tkgm.gov.tr/',direct:true},
  {id:'edevlet-tapu',group:'Kadastro',title:'e-Devlet Tapu Bilgileri',detail:'Malik olarak tapu kaydı, şerh ve beyanlar (giriş gerekir).',url:'https://www.turkiye.gov.tr/',direct:true},
  {id:'eplan',group:'İmar',title:'e-Plan (ÇŞB Mekânsal Planlar)',detail:'Onaylı imar planı ve plan notları.',url:search(`e-Plan mekansal planlar bilgi sistemi ${place}`)},
  {id:'belediye-imar',group:'İmar',title:`${district||'İlçe'} Belediyesi e-İmar / İmar Durumu`,detail:'Parselin imar durumu, TAKS/KAKS, yol ve çekme mesafeleri. Kesin bilgi için imar durum belgesi alınmalı.',url:search(`${district} belediyesi e-imar imar durumu sorgulama ${adaParsel}`)},
  {id:'belediye-emsal',group:'Değer',title:`${district||'İlçe'} Belediyesi arsa m² birim değeri (emlak vergisi)`,detail:'Belediyenin ilan ettiği sokak/mahalle bazlı arsa rayiç değeri.',url:search(`${district} belediyesi ${neighborhood} arsa metrekare birim değeri emlak vergisi ${year}`)},
  {id:'dsi',group:'Kısıt',title:'DSİ kamulaştırma / proje alanı',detail:'Baraj, sulama, taşkın veya kamulaştırma kapsamında olup olmadığı.',url:search(`DSİ kamulaştırma ${place} ${adaParsel}`)},
  {id:'csb-maliyet',group:'Maliyet',title:`ÇŞB yapı yaklaşık birim maliyetleri ${year}`,detail:'Bayındırlık birim fiyatları / poz bazlı inşaat maliyet hesabı için resmî tebliğ.',url:search(`Çevre Şehircilik Bakanlığı yapı yaklaşık birim maliyetleri ${year} tebliğ`)}
 ];
}
