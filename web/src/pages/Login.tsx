import { Button, Center, Group, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { useSession } from '../session';

export function Login() {
  const { login } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login(String(form.get('username')), String(form.get('password')));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center mih="100vh" p="md">
      <Paper component="form" onSubmit={submit} w="100%" maw={380} p="xl" radius="lg" bg="dark.6">
        <Stack gap="lg">
          <Group gap="sm" justify="center">
            <img src="/icon.svg" alt="" width={40} height={40} />
            <Title order={2}>santral</Title>
          </Group>
          <Text c="dimmed" ta="center" size="sm">Danışman girişi</Text>
          <TextInput name="username" label="Kullanıcı adı" placeholder="ad.soyad" autoComplete="username" autoCapitalize="none" required />
          <PasswordInput name="password" label="Şifre" autoComplete="current-password" required error={error} />
          <Button type="submit" loading={busy} size="md">Giriş yap</Button>
        </Stack>
      </Paper>
    </Center>
  );
}
