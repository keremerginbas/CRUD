import {postJson} from './api';

// İlan5 eklentisinin dışa aktarımları: JSON yedeği ({records:[...]}) veya CSV (; ayraçlı, BOM'lu).
// Dosya tarayıcıda okunur; sunucuya yalnızca kayıt nesneleri gider, kişisel alanları sunucu atar.
export function parseCsv(text:string):Record<string,string>[]{
 text=text.replace(/^﻿/,'');
 const firstLine=text.slice(0,text.indexOf('\n')>0?text.indexOf('\n'):text.length);
 const delim=(firstLine.match(/;/g)||[]).length>=(firstLine.match(/,/g)||[]).length?';':',';
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else quoted=false}else cell+=c;continue}
  if(c==='"')quoted=true;
  else if(c===delim){row.push(cell);cell=''}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}
  else cell+=c;
 }
 if(cell||row.length){row.push(cell);rows.push(row)}
 const [header,...body]=rows.filter(r=>r.some(v=>v.trim()));
 if(!header)return [];
 // Excel formül korumasıyla başına eklenen ' kaldırılır.
 return body.map(r=>Object.fromEntries(header.map((h,i)=>[h.trim(),(r[i]??'').replace(/^'(?=[\s]*[=+@-])/,'')])));
}

export async function readListingFile(file:File):Promise<unknown[]>{
 if(file.size>50*1024*1024)throw Error('Dosya en fazla 50 MB olabilir.');
 const name=file.name.toLowerCase();
 if(name.endsWith('.json')){
  const data=JSON.parse(await file.text());
  const rows=Array.isArray(data)?data:Array.isArray(data?.records)?data.records:null;
  if(!rows)throw Error('JSON içinde ilan kaydı bulunamadı. İlan5 panelinden "Yedek (JSON)" alın.');
  return rows;
 }
 if(name.endsWith('.csv'))return parseCsv(await file.text());
 throw Error('İlan5 panelinden JSON yedeği veya CSV dışa aktarın (XLSX yerine).');
}

export async function importListings(rows:unknown[],onProgress?:(done:number,total:number)=>void){
 let saved=0,skipped=0;
 for(let i=0;i<rows.length;i+=1000){
  const r=await postJson<{saved:number;skipped:number}>('/api/comparables/import',{records:rows.slice(i,i+1000)});
  saved+=r.saved;skipped+=r.skipped;onProgress?.(Math.min(i+1000,rows.length),rows.length);
 }
 return {saved,skipped};
}
