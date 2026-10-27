import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Button, Field, styles } from '../components/ui';
import { useSession } from '../lib/session';
import { colors } from '../theme';

export default function Login() {
  const { user, login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Redirect href="/" />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
      <View style={{ width: '100%', maxWidth: 380, gap: 18 }}>
        <Text style={{ color: colors.text, fontSize: 28, fontWeight: '700', textAlign: 'center' }}>Santral</Text>
        <Text style={[styles.muted, { textAlign: 'center' }]}>Danışman girişi</Text>
        <Field label="e-posta" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="şifre" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={{ flexDirection: 'row' }}>
          <Button title={busy ? 'Giriş yapılıyor…' : 'Giriş Yap'} onPress={submit} disabled={busy || !email || !password} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
