// Web önizlemesinde WebView yerine iframe
export default function RouteMap({ url }) {
  return <iframe src={url} title="Güzergâh haritası" style={{ border: 0, width: '100%', height: '100%' }} />;
}
