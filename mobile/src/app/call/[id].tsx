import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Button, Loading, styles } from '../../components/ui';
import { authHeaders, recordingUrl } from '../../lib/api';
import { startMaskedCall } from '../../lib/calls';
import { formatDate, formatDuration } from '../../lib/format';
import type { Call } from '../../lib/types';
import { useApi } from '../../lib/useApi';

const STATUS: Record<Call['status'], string> = {
  initiated: 'Başlatıldı', ringing: 'Çalıyor', answered: 'Görüşmede',
  completed: 'Tamamlandı', missed: 'Cevapsız', failed: 'Başarısız',
};

export default function CallDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: call, error } = useApi<Call>(`/api/calls/${id}`);
  if (error) return <View style={styles.center}><Text style={styles.muted}>{error}</Text></View>;
  if (!call) return <Loading />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingVertical: 12 }}>
      <Info label="Müşteri" value={call.contact_name ? `${call.contact_name} (${call.contact_type})` : 'Kayıtlı değil'} />
      <Info label="Telefon" value={call.customer_phone} />
      <Info label="Yön" value={call.direction === 'inbound' ? 'Gelen' : 'Giden'} />
      <Info label={call.direction === 'inbound' ? 'Aranan numara' : 'Gösterilen numara'} value={call.dialed_label ? `${call.dialed_label} · ${call.dialed_number}` : call.dialed_number ?? '—'} />
      {call.user_name && <Info label="Danışman" value={call.user_name} />}
      <Info label="Tarih" value={formatDate(call.started_at)} />
      <Info label="Durum" value={STATUS[call.status]} />
      <Info label="Süre" value={formatDuration(call.duration_sec)} />
      {call.recording_ref && <Recording callId={call.id} />}
      <View style={{ flexDirection: 'row', padding: 24 }}>
        <Button
          title="Geri Ara"
          onPress={() => startMaskedCall({ contactId: call.contact_id ?? undefined, phone: call.customer_phone, name: call.contact_name ?? call.customer_phone })}
        />
      </View>
    </ScrollView>
  );
}

function Recording({ callId }: { callId: number }) {
  const player = useAudioPlayer({ uri: recordingUrl(callId), headers: authHeaders() });
  const status = useAudioPlayerStatus(player);
  return (
    <View style={[styles.section, { flexDirection: 'row', alignItems: 'center' }]}>
      <Text style={[styles.text, { flex: 1 }]}>
        Ses kaydı {status.duration ? `${formatDuration(Math.floor(status.currentTime))} / ${formatDuration(Math.floor(status.duration))}` : ''}
      </Text>
      <View style={{ width: 120, flexDirection: 'row' }}>
        <Button title={status.playing ? 'Duraklat' : 'Dinle'} onPress={() => (status.playing ? player.pause() : player.play())} />
      </View>
    </View>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={[styles.row, { flexDirection: 'row' }]}>
      <Text style={[styles.muted, { width: 140 }]}>{label}</Text>
      <Text style={[styles.text, { flex: 1 }]}>{value}</Text>
    </View>
  );
}
