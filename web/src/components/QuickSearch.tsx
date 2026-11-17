import { Avatar } from '@mantine/core';
import { Spotlight, type SpotlightActionData, type SpotlightActionGroupData } from '@mantine/spotlight';
import { IconSearch, type Icon } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { go } from '../router';
import type { Contact } from '../types';
import { maskedCall } from './maskedCall';

// Ctrl+K: kişi adı ya da telefonla hızlı arama (seçilince aranır) ve sayfalar arası geçiş
export function QuickSearch({ pages }: { pages: { path: string; label: string; icon: Icon }[] }) {
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      api<Contact[]>(`/api/contacts?q=${encodeURIComponent(query.trim())}`).then((list) => { if (!stale) setContacts(list.slice(0, 8)); }).catch(() => {});
    }, 200);
    return () => { stale = true; clearTimeout(t); };
  }, [query]);

  const contactActions: SpotlightActionData[] = contacts.map((c) => ({
    id: `c${c.id}`, label: c.name, description: `${c.phone} · ${c.type === 'SATICI' ? 'Satıcı' : 'Alıcı'} · Enter ile ara`,
    leftSection: <Avatar name={c.name} color="initials" radius="xl" size={32} />,
    onClick: () => maskedCall({ contactId: c.id, phone: c.phone, name: c.name }),
  }));
  const pageActions: SpotlightActionData[] = pages.map(({ path, label, icon: I }) => ({
    id: `p${path}`, label, leftSection: <I size={20} stroke={1.6} />, onClick: () => go(path),
  }));
  const actions: SpotlightActionGroupData[] = [
    { group: 'Kişiler', actions: contactActions },
    { group: 'Sayfalar', actions: pageActions },
  ];

  return (
    <Spotlight
      actions={actions} shortcut="mod + K" query={query} onQueryChange={setQuery} nothingFound="Sonuç yok" highlightQuery scrollable maxHeight={420}
      // Kişiler sunucuda aranır (telefonla da); sayfalar adla süzülür
      filter={(q, list) => list.map((g) => ('actions' in g && g.group === 'Sayfalar'
        ? { ...g, actions: g.actions.filter((a) => String(a.label).toLocaleLowerCase('tr-TR').includes(q.trim().toLocaleLowerCase('tr-TR'))) } : g))}
      searchProps={{ leftSection: <IconSearch size={18} />, placeholder: 'Kişi adı, telefon ya da sayfa…' }}
    />
  );
}
