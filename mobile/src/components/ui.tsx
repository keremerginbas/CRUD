import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors } from '../theme';

export function Button({ title, onPress, variant = 'primary', disabled }: {
  title: string; onPress: () => void; variant?: 'primary' | 'outline'; disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, variant === 'outline' && styles.outline, (pressed || disabled) && { opacity: 0.6 }]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={styles.input} {...props} />
    </View>
  );
}

export function Checkbox({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked: value }}>
      <View style={[styles.checkbox, value && styles.checkboxOn]}>{value && <Text style={styles.tick}>✓</Text>}</View>
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

export function Center({ children }: { children: ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

export const Loading = () => <Center><ActivityIndicator color={colors.accent} /></Center>;

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24 },
  text: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13 },
  label: { color: colors.muted, fontSize: 13, marginLeft: 12 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
    color: colors.text, textAlign: 'center', fontSize: 15,
  },
  button: { backgroundColor: colors.accent, borderRadius: 22, paddingVertical: 12, alignItems: 'center', flex: 1 },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.text },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  checkbox: { width: 26, height: 26, borderRadius: 6, borderWidth: 1.5, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.text },
  tick: { color: colors.bg, fontWeight: '900' },
  row: { paddingHorizontal: 24, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  section: { paddingHorizontal: 24, paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, gap: 14 },
  error: { color: colors.danger, textAlign: 'center' },
});
