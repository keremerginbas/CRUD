import { Alert, Anchor, Button, Chip, Group, Input, Paper, PasswordInput, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconCircleCheck, IconInfoCircle } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { SPECIALTY_LABELS } from '../specialties';

type Mode = 'login' | 'register' | 'forgot';

export function Login() {
  const { login } = useSession();
  const [mode, setMode] = useState<Mode>('login');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [forgotUser, setForgotUser] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  const switchTo = (m: Mode) => { setMode(m); setError(null); setInfo(null); setCodeSent(false); };
  const run = (fn: (form: FormData) => Promise<void>) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try { await fn(form); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  const doLogin = run(async (f) => { await login(String(f.get('username')), String(f.get('password'))); });
  const doRegister = run(async (f) => {
    if (f.get('password') !== f.get('password2')) throw new Error('Şifreler aynı değil');
    await api('/api/auth/register', { method: 'POST', body: { name: f.get('name'), email: f.get('username'), phone: f.get('phone'), password: f.get('password'), specialties } });
    switchTo('login');
    setInfo('Başvurunuz alındı. Yönetici onayladıktan sonra giriş yapabilirsiniz.');
  });
  const doForgot = run(async (f) => {
    if (!codeSent) {
      const user = String(f.get('username'));
      const r = await api<{ sms: boolean }>('/api/auth/forgot', { method: 'POST', body: { email: user } });
      if (!r.sms) throw new Error('SMS servisi henüz ayarlı değil. Şifrenizi yöneticiniz sıfırlayabilir (Ekip → Şifre sıfırla).');
      setForgotUser(user); setCodeSent(true);
      setInfo('Kullanıcı adınız kayıtlıysa cep telefonunuza 6 haneli bir kod gönderdik.');
      return;
    }
    if (f.get('password') !== f.get('password2')) throw new Error('Şifreler aynı değil');
    await api('/api/auth/reset', { method: 'POST', body: { email: forgotUser, code: f.get('code'), password: f.get('password') } });
    switchTo('login');
    setInfo('Şifreniz değişti, yeni şifrenizle giriş yapabilirsiniz.');
  });

  return (
    <Stack mih="100vh" p="md" justify="center" align="center">
      <Paper w="100%" maw={420} p="xl" radius="xl" className="card login-card">
        <Stack gap="lg">
          <Group gap="sm" justify="center" mt="sm">
            <img src="/icon.svg" alt="" width={44} height={44} />
            <Title order={1} fz={30} className="brand"><span><b>XRE</b> Santral</span></Title>
          </Group>
          {mode !== 'forgot' && (
            <SegmentedControl fullWidth radius="xl" value={mode} onChange={(v) => switchTo(v as Mode)}
              data={[{ value: 'login', label: 'Giriş yap' }, { value: 'register', label: 'Üye ol' }]} />
          )}
          {info && <Alert color="lime" variant="light" icon={<IconCircleCheck size={18} />}>{info}</Alert>}

          {mode === 'login' && (
            <form onSubmit={doLogin}>
              <Stack>
                <TextInput name="username" label="Kullanıcı adı" placeholder="ad.soyad" autoComplete="username" autoCapitalize="none" required />
                <PasswordInput name="password" label="Şifre" autoComplete="current-password" required error={error} />
                <Button type="submit" loading={busy} size="md" mt="xs">Giriş yap</Button>
                <Anchor component="button" type="button" size="sm" c="dimmed" ta="center" onClick={() => switchTo('forgot')}>Şifremi unuttum</Anchor>
              </Stack>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={doRegister}>
              <Stack gap="sm">
                <TextInput name="name" label="Ad soyad" required />
                <TextInput name="username" label="Kullanıcı adı" placeholder="ad.soyad" autoCapitalize="none" required />
                <TextInput name="phone" label="Cep telefonu" type="tel" placeholder="05XX XXX XX XX" required
                  description="Müşteriler bu numarayı görmez; aramalarınız buraya yönlendirilir" />
                <Group grow>
                  <PasswordInput name="password" label="Şifre" description="En az 8 karakter" autoComplete="new-password" required />
                  <PasswordInput name="password2" label="Şifre (tekrar)" description=" " autoComplete="new-password" required />
                </Group>
                <Input.Wrapper label="Uzmanlık alanı" required error={error}>
                  <Chip.Group multiple value={specialties} onChange={setSpecialties}>
                    <Group gap="xs" mt={6}>{Object.entries(SPECIALTY_LABELS).map(([k, l]) => <Chip key={k} value={k}>{l}</Chip>)}</Group>
                  </Chip.Group>
                </Input.Wrapper>
                <Button type="submit" loading={busy} size="md" mt="xs" disabled={!specialties.length}>Başvur</Button>
                <Text size="xs" c="dimmed" ta="center">Hesabınız yönetici onayından sonra açılır.</Text>
              </Stack>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={doForgot}>
              <Stack gap="sm">
                <Text fw={600}>Şifremi unuttum</Text>
                {!codeSent ? (
                  <>
                    <Text size="sm" c="dimmed">Kullanıcı adınızı yazın; kayıtlı cep telefonunuza bir kod gönderelim.</Text>
                    <TextInput name="username" label="Kullanıcı adı" placeholder="ad.soyad" autoCapitalize="none" required />
                  </>
                ) : (
                  <>
                    <TextInput name="code" label="SMS kodu" inputMode="numeric" maxLength={6} required />
                    <PasswordInput name="password" label="Yeni şifre" description="En az 8 karakter" autoComplete="new-password" required />
                    <PasswordInput name="password2" label="Yeni şifre (tekrar)" autoComplete="new-password" required />
                  </>
                )}
                {error && <Alert color="red" variant="light" icon={<IconInfoCircle size={18} />}>{error}</Alert>}
                <Button type="submit" loading={busy} size="md">{codeSent ? 'Şifreyi değiştir' : 'Kod gönder'}</Button>
                <Anchor component="button" type="button" size="sm" c="dimmed" ta="center" onClick={() => switchTo('login')}>Girişe dön</Anchor>
              </Stack>
            </form>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
