import { WebView } from 'react-native-webview';

// Sunucunun /map sayfasını (Leaflet + OpenStreetMap) gömülü gösterir
export default function RouteMap({ url }) {
  return <WebView source={{ uri: url }} style={{ flex: 1, backgroundColor: 'transparent' }} scrollEnabled={false} originWhitelist={['*']} />;
}
