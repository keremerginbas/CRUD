import { useEffect, useState } from 'react';

const WORDS = ['büyüten', 'parlatan', 'dönüştüren', 'öne çıkaran'];

/** Hero başlığındaki yaz-sil kelime rotasyon efekti. */
export default function useRotator() {
  const [text, setText] = useState(WORDS[0]);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setText(WORDS[0]); return; }

    let wi = 0, ci = WORDS[0].length, deleting = false, timer;
    const tick = () => {
      const word = WORDS[wi];
      setText(word.slice(0, ci));
      let delay = deleting ? 45 : 95;
      if (!deleting && ci === word.length) { delay = 2100; deleting = true; }
      else if (deleting && ci === 0) { deleting = false; wi = (wi + 1) % WORDS.length; delay = 350; }
      else { ci += deleting ? -1 : 1; }
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 95);
    return () => clearTimeout(timer);
  }, []);

  return text;
}
