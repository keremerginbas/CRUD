// GeoJSON Feature/Polygon/MultiPolygon icin nokta-icinde-mi (ray casting). Koordinatlar [lng,lat].
function inRing(lng,lat,ring){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [xi,yi]=ring[i],[xj,yj]=ring[j];
  if((yi>lat)!==(yj>lat)&&lng<(xj-xi)*(lat-yi)/(yj-yi)+xi)inside=!inside;
 }
 return inside;
}
function inPolygon(lng,lat,rings){
 if(!Array.isArray(rings)||!rings.length||!inRing(lng,lat,rings[0]))return false;
 return !rings.slice(1).some(hole=>inRing(lng,lat,hole));
}
export function containsPoint(geojson,lat,lng){
 const g=geojson?.type==='Feature'?geojson.geometry:geojson;
 if(!g)return false;
 if(g.type==='Polygon')return inPolygon(lng,lat,g.coordinates);
 if(g.type==='MultiPolygon')return g.coordinates.some(rings=>inPolygon(lng,lat,rings));
 if(g.type==='FeatureCollection')return (geojson.features||[]).some(f=>containsPoint(f,lat,lng));
 return false;
}
