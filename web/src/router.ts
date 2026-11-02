import { useEffect, useState } from 'react';

// Basit hash yönlendirme: #/aramalar, #/arama/12, #/kisiler ...
const read = () => location.hash.replace(/^#\/?/, '').split('/');

export function useRoute() {
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const onChange = () => { setParts(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return { page: parts[0] || 'aramalar', id: parts[1] };
}

export const go = (path: string) => { location.hash = `#/${path}`; };
