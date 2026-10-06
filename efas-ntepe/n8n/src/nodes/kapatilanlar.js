// Bu turda OLUMSUZ'a taşınan lead varsa Olay Merkezi'ne bildir (yoksa akış durur)
const olaylar = $('Aranacakları Seç').first().json.olaylar || [];
return olaylar.length ? [{ json: { olaylar } }] : [];
