import { useEffect } from 'react';

export default function usePageTitle(title) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} — Exca Dijital` : 'Exca Dijital';
    return () => { document.title = prev; };
  }, [title]);
}
