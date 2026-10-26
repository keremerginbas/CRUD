import {useEffect, useState} from 'react';
import {MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap, useMapEvents} from 'react-leaflet';
import L from 'leaflet';
import {Crosshair, MapPin, Star} from 'lucide-react';
import type {Pin} from '@/lib/api';

// Damla biçimli SVG pinler (logodaki iğneyle aynı form); ucu tam koordinata oturur.
const STAR='<path d="M12 6.6l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="#fff"/>';
const DOT='<circle cx="12" cy="11" r="3.6" fill="#fff"/>';
const CROSS='<circle cx="12" cy="11" r="4.2" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="12" cy="11" r="1.5" fill="#fff"/>';
function pinIcon(fill:string,inner:string,extra=''){
 return L.divIcon({className:'xre-pin'+extra,iconSize:[34,44],iconAnchor:[17,42],popupAnchor:[0,-38],
  html:`<svg viewBox="0 0 24 31" width="34" height="44"><ellipse cx="12" cy="29.6" rx="4.5" ry="1.3" fill="rgba(0,0,0,.28)"/><path d="M12 29C8 24.6 2.5 18 2.5 11.2a9.5 9.5 0 0 1 19 0C21.5 18 16 24.6 12 29z" fill="${fill}" stroke="#02201f" stroke-width="1.4"/>${inner}</svg>`});
}
const selectionIcon=pinIcon('#e21d35',CROSS,' xre-pin-selection');
const savedIcon=pinIcon('#38b5fe',DOT);
const favoriteIcon=pinIcon('#f4b330',STAR);

// Esri World Imagery kırsal Türkiye'de çoğunlukla 18. seviyeye kadar gerçek görüntü verir;
// 19+ istendiğinde "Map data not yet available" döşemesi döner. 18'den sonra döşemeyi büyütüyoruz.
const ESRI_NATIVE_MAX=18;
const OSM_NATIVE_MAX=19;
export const MAX_ZOOM=21;

export type MapFocus={data:GeoJSON.GeoJsonObject;key:string;maxZoom:number};

function FitFocus({focus}:{focus:MapFocus|null}){
 const map=useMap();
 useEffect(()=>{
  if(!focus)return;
  const bounds=L.geoJSON(focus.data).getBounds();
  // Büyük zoom sıçramalarında animasyon SVG katmanını yarıda kırpabiliyor; V12'deki gibi animasyonsuz.
  if(bounds.isValid())map.fitBounds(bounds,{padding:[48,48],maxZoom:focus.maxZoom,animate:false});
 },[focus?.key,map]);
 return null;
}
function FlyToPin({target}:{target:Pin|null}){
 const map=useMap();
 useEffect(()=>{if(target)map.flyTo([target.lat,target.lng],Math.max(map.getZoom(),16),{duration:.7})},[target,map]);
 return null;
}
// TKGM ekranındaki gibi imleç koordinatı ve zoom göstergesi.
function Readout(){
 const map=useMap();
 const [pos,setPos]=useState(map.getCenter());
 const [zoom,setZoom]=useState(map.getZoom());
 // useMapEvents her render'da dinleyiciyi yeniden bağlar; o arada yapılan fitBounds kaçmasın diye kalıcı bağlıyoruz.
 useEffect(()=>{
  const move=(e:L.LeafletMouseEvent)=>setPos(e.latlng);
  const zoomed=()=>setZoom(map.getZoom());
  map.on('mousemove',move);map.on('zoomend',zoomed);
  return()=>{map.off('mousemove',move);map.off('zoomend',zoomed)};
 },[map]);
 return <div className="pointer-events-none absolute bottom-2 left-2 z-[1000] flex overflow-hidden rounded-md border border-border bg-card/90 font-mono text-[11px] text-foreground shadow-sm backdrop-blur">
  <span className="px-2 py-1">{pos.lat.toFixed(5)} : {pos.lng.toFixed(5)}</span>
  <span className="border-l border-border px-2 py-1" title="Zoom seviyesi">z{zoom}</span>
 </div>;
}
function Clicker({onClick}:{onClick:(lat:number,lng:number)=>void}){
 useMapEvents({click:e=>onClick(e.latlng.lat,e.latlng.lng)});
 return null;
}

function PinCard({title,kind,lat,lng}:{title:string;kind:'selection'|'saved'|'favorite';lat:number;lng:number}){
 const meta={selection:{label:'Seçili',Icon:Crosshair,cls:'bg-rose-500/10 text-rose-600'},saved:{label:'Kayıtlı',Icon:MapPin,cls:'bg-sky-500/10 text-sky-600'},
  favorite:{label:'Favori',Icon:Star,cls:'bg-amber-500/15 text-amber-600'}}[kind];
 return <div className="min-w-44 space-y-1.5">
  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.cls}`}><meta.Icon size={11}/>{meta.label}</span>
  <div className="text-sm font-bold leading-snug text-foreground">{title}</div>
  <div className="font-mono text-[11px] text-muted-foreground">{lat.toFixed(6)}, {lng.toFixed(6)}</div>
 </div>;
}

export function MapView({satellite,labels,boundary,parcel,parcelKey,focus,pin,showSelectionPin,focusPin,markers,onPick,onMarkerClick}:{
 satellite:boolean;labels:boolean;boundary:GeoJSON.Feature|null;parcel:GeoJSON.GeoJsonObject|null;parcelKey:string;
 focus:MapFocus|null;pin:Pin|null;showSelectionPin:boolean;focusPin:Pin|null;markers:Pin[];onPick:(lat:number,lng:number)=>void;onMarkerClick?:(p:Pin)=>void;
}){
 return <MapContainer center={[39,35]} zoom={6} maxZoom={MAX_ZOOM} className="size-full" zoomControl>
  {satellite
   ?<TileLayer key="sat" maxNativeZoom={ESRI_NATIVE_MAX} maxZoom={MAX_ZOOM} attribution="Tiles © Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"/>
   :<TileLayer key="osm" maxNativeZoom={OSM_NATIVE_MAX} maxZoom={MAX_ZOOM} attribution="© OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>}
  {satellite&&labels&&<TileLayer key="lbl" maxNativeZoom={ESRI_NATIVE_MAX} maxZoom={MAX_ZOOM} url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"/>}
  {boundary&&<GeoJSON key={'b-'+String(boundary.properties?.level)+'-'+String(boundary.properties?.id)} data={boundary} interactive={false}
   style={{color:'#e21d35',weight:2.5,opacity:.95,fill:false,lineJoin:'round'}}/>}
  {parcel&&<GeoJSON key={parcelKey} data={parcel}
   style={{color:'#e21d35',weight:4,opacity:1,fillColor:'#ef334c',fillOpacity:.3,lineJoin:'round'}}/>}
  <FitFocus focus={focus}/><FlyToPin target={focusPin}/>
  <Clicker onClick={onPick}/>
  <Readout/>
  {pin&&showSelectionPin&&<Marker position={[pin.lat,pin.lng]} icon={selectionIcon} zIndexOffset={500}>
   <Popup><PinCard title="Seçilen nokta" kind="selection" lat={pin.lat} lng={pin.lng}/></Popup></Marker>}
  {markers.map((p,i)=><Marker key={p.id??i} position={[p.lat,p.lng]} icon={p.favorite?favoriteIcon:savedIcon} eventHandlers={{click:()=>onMarkerClick?.(p)}}>
   <Popup><PinCard title={p.note||'Kayıtlı nokta'} kind={p.favorite?'favorite':'saved'} lat={p.lat} lng={p.lng}/></Popup></Marker>)}
 </MapContainer>;
}
