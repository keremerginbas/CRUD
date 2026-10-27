import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { styles } from '../../components/ui';
import { useSession } from '../../lib/session';
import { colors } from '../../theme';

const NUMBER_LABEL = { personal: 'dijital telefon', listing: 'ilan hattı', hunt: 'karşılama hattı' };

export default function Profile() {
  const { user, logout } = useSession();
  if (!user) return null;

  const MenuItem = ({ title, onPress }: { title: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={[styles.row, { flexDirection: 'row', justifyContent: 'center', marginHorizontal: 24 }]}>
      <Text style={[styles.text, { flex: 1, textAlign: 'center' }]}>{title}</Text>
      <Ionicons name="chevron-forward" size={20} color={colors.text} />
    </Pressable>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingVertical: 24 }}>
      <View style={{ alignItems: 'center', gap: 6, marginBottom: 20 }}>
        <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.text }}>
          <Text style={{ color: colors.text, fontSize: 32 }}>{user.name[0]}</Text>
        </View>
        <Text style={[styles.text, { fontSize: 17, marginTop: 8 }]}>{user.name}</Text>
        <Text style={styles.muted}>{user.title}</Text>
      </View>

      <View style={{ alignSelf: 'center', gap: 6, marginBottom: 24 }}>
        <InfoRow label="telefon" value={user.phone} />
        {user.numbers?.map((n) => <InfoRow key={n.did} label={n.type === 'listing' ? n.label : NUMBER_LABEL[n.type]} value={n.did} />)}
        {user.extension && <InfoRow label="dahili" value={user.extension} />}
      </View>

      <MenuItem title="santral ayarları" onPress={() => router.push('/santral')} />
      <MenuItem
        title="çıkış yap"
        onPress={() => Alert.alert('Çıkış', 'Oturumunuz kapatılsın mı?', [
          { text: 'Vazgeç', style: 'cancel' },
          { text: 'Çıkış yap', style: 'destructive', onPress: logout },
        ])}
      />
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Text style={[styles.muted, { width: 130, textAlign: 'right' }]}>{label}</Text>
      <Text style={styles.text}>{value}</Text>
    </View>
  );
}
