// Müşteri mesajı cevap bekler mi? Tepkiler, yalnız emoji, "teşekkürler / tamam /
// iyi akşamlar" gibi kapanış mesajları ve karşı tarafın otomatik cevapları
// sohbeti "cevap bekliyor" durumuna almaz ve bekleyen sohbet alarmı tetiklemez.

const ACK =
  /^(?:(?:ben de|bende|çok|cok|size de|sizlere de|biz de|çok çok|hocam|abi|abla|bey|hanım|hanim|efendim)\s+)*(?:tamam[a-zçğıöşü]*|tmm|ok|oki|okey|okay|peki|anla[sş][ıi]ld[ıi]|anlad[ıi]m|te[sş]ekk[uü]r[a-zçğıöşü]*|t[sş]k[a-zçğıöşü]*|sa[gğ]ol[a-zçğıöşü]*|eyvallah|rica ederim|iyi (?:ak[sş]amlar|g[uü]nler|geceler|[cç]al[ıi][sş]malar|hafta ?sonlar[ıi]|bayramlar)|kolay gelsin|g[oö]r[uü][sş][uü]r[uü]z|kusura bakmay[ıi]n[a-zçğıöşü]*|kaydettim|kaydedildi|olur|s[uü]per|harika|haber verece[gğ][a-zçğıöşü]*|thanks?|thank you|thx|ty|merci|great|good|perfect|okey dokey)(?:\s+(?:ederim|ederiz|ediyorum|ediyoruz|ettim))?(?:\s+(?:size|sizlere|sana|hocam|abi|abla|bey|hanım|hanim|efendim|çok|cok|ben|biz))*$/;

const AUTO_REPLY = /(en k[ıi]sa s[uü]rede|en yak[ıi]n zamanda|mesai saatleri d[ıi][sş][ıi]nda|şu an müsait değil|su an musait degil|we will get back|out of office).{0,60}|mesaj[ıi]n[ıi]z i[cç]in te[sş]ekk[uü]r/;

/** Metinden emoji, noktalama ve fazla boşluk temizlenmiş küçük harfli hali. */
function normalize(text: string) {
  return text
    .toLocaleLowerCase("tr")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, " ")
    .replace(/[.,!?;:…'"“”‘’()\-–—*_~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function needsReply(text: string | undefined | null, hasMedia = false): boolean {
  if (hasMedia) return true;
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/^(tepki|reaction)[: ]/i.test(raw) || /^(tepki kaldırıldı|reaction removed)$/i.test(raw)) return false;
  const t = normalize(raw);
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return false; // yalnız emoji / noktalama
  if (AUTO_REPLY.test(t)) return false;
  if (t.length > 70) return true;
  // "teşekkürler iyi akşamlar", "tamam sağolun" gibi kalıpların birleşimi
  const parts = t.split(/\s+(?:ve|da|de)\s+|\s*,\s*/).flatMap((p) => p.split(/\s+(?=(?:te[sş]ekk|t[sş]k|sa[gğ]ol|iyi |kolay |g[oö]r[uü][sş]|kusura |tamam|peki|ok\b|rica ))/));
  return !parts.every((p) => ACK.test(p.trim()));
}
