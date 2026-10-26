import {useEffect, useState} from 'react';
import {MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap, useMapEvents} from 'react-leaflet';
import L from 'leaflet';
import type {Pin} from '@/lib/api';

const markerIcon=L.divIcon({className:'custom-pin',html:'<div class="pin"></div>',iconSize:[22,22],iconAnchor:[11,11]});
const favoriteMarkerIcon=L.divIcon({className:'custom-pin favorite-pin',html:'<div class="pin"></div>',iconSize:[22,22],iconAnchor:[11,11]});

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

export function MapView({satellite,labels,boundary,parcel,parcelKey,focus,pin,showSelectionPin,focusPin,markers,onPick}:{
 satellite:boolean;labels:boolean;boundary:GeoJSON.Feature|null;parcel:GeoJSON.GeoJsonObject|null;parcelKey:string;
 focus:MapFocus|null;pin:Pin|null;showSelectionPin:boolean;focusPin:Pin|null;markers:Pin[];onPick:(lat:number,lng:number)=>void;
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
  {pin&&showSelectionPin&&<Marker position={[pin.lat,pin.lng]} icon={markerIcon}><Popup>Seçilen nokta: {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</Popup></Marker>}
  {markers.map((p,i)=><Marker key={p.id??i} position={[p.lat,p.lng]} icon={p.favorite?favoriteMarkerIcon:markerIcon}><Popup>{p.note||'Kayıtlı nokta'}</Popup></Marker>)}
 </MapContainer>;
}
