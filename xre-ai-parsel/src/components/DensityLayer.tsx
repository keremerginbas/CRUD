import {useEffect} from 'react';
import {useMap} from 'react-leaflet';
import L from 'leaflet';
import '@/lib/leaflet-global';
import 'leaflet.heat';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import type {DensityPoint} from '@/lib/api';

export type DensityMode='heat'|'cluster';
// TKGM lejantı gibi mavi → kırmızı.
const GRADIENT={0.15:'#1d3cff',0.35:'#00c8ff',0.55:'#2ee86b',0.75:'#ffe600',1:'#ff1f1f'};

type CountMarker=L.Marker&{options:L.MarkerOptions&{count:number}};
const sizeFor=(n:number)=>n<10?30:n<100?38:n<1000?46:54;

export function DensityLayer({points,mode,fitKey}:{points:DensityPoint[];mode:DensityMode;fitKey:string}){
 const map=useMap();
 useEffect(()=>{
  if(!points.length)return;
  const max=Math.max(...points.map(p=>p.count));
  let layer:L.Layer;
  if(mode==='heat'){
   layer=L.heatLayer(points.map(p=>[p.lat,p.lng,p.count]),{radius:22,blur:16,max,minOpacity:.35,maxZoom:15,gradient:GRADIENT});
  }else{
   // Küme rozetinde nokta sayısı değil toplam işlem adedi gösterilir.
   const group=L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:55,
    iconCreateFunction:c=>{const n=(c.getAllChildMarkers() as CountMarker[]).reduce((s,m)=>s+(m.options.count||0),0),size=sizeFor(n);
     return L.divIcon({className:'xre-cluster',html:`<span>${n.toLocaleString('tr-TR')}</span>`,iconSize:[size,size]})}});
   for(const p of points){
    const m=L.marker([p.lat,p.lng],{icon:L.divIcon({className:'xre-density-dot',html:`<span>${p.count}</span>`,iconSize:[22,22]})}) as CountMarker;
    m.options.count=p.count;
    m.bindPopup(`<b>${p.count} işlem</b><br><span style="font-family:monospace;font-size:11px">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span><br><span style="font-size:11px;color:#64748b">TKGM parsel no: ${p.parcelRef}</span>`);
    group.addLayer(m);
   }
   layer=group;
  }
  layer.addTo(map);
  return()=>{map.removeLayer(layer)};
 },[points,mode,map]);
 useEffect(()=>{
  if(!points.length)return;
  const b=L.latLngBounds(points.map(p=>[p.lat,p.lng] as [number,number]));
  if(b.isValid())map.fitBounds(b,{padding:[40,40],maxZoom:13,animate:false});
 },[fitKey,map]);
 return null;
}

export function DensityLegend({max}:{max:number}){
 return <div className="pointer-events-none absolute bottom-10 left-2 z-[1000] rounded-md border border-border bg-card/90 px-2 py-1.5 text-[10px] font-semibold shadow-sm backdrop-blur">
  <div className="mb-1 text-muted-foreground">Alım satım (işlem)</div>
  <div className="flex items-center gap-1.5"><span>1</span>
   <span className="h-2 w-28 rounded-full" style={{background:'linear-gradient(90deg,#1d3cff,#00c8ff,#2ee86b,#ffe600,#ff1f1f)'}}/><span>{max}</span></div>
 </div>;
}
