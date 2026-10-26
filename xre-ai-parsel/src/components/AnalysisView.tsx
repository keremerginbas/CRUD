import * as React from 'react';
import {motion} from 'motion/react';
import {BarChart3, Landmark, ListChecks, TrendingUp, CheckCircle2, ClipboardList, Globe, Link2, Database, FileSearch, Lightbulb, MapPin, ScrollText, ShieldAlert, Sparkles, type LucideIcon} from 'lucide-react';
import {cn} from '@/lib/utils';

type Section={title:string;lines:string[]};
const hostOf=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'')}catch{return ''}};

// AI raporu Markdown gelir; HTML olarak basmadan (XSS yok) başlık/madde/kalın biçimine çeviriyoruz.
function parse(text:string):Section[]{
 const sections:Section[]=[];
 let current:Section={title:'',lines:[]};
 for(const raw of text.split('\n')){
  const line=raw.trim();
  const heading=line.match(/^#{1,6}\s+(.*)$/);
  if(heading){if(current.title||current.lines.length)sections.push(current);current={title:heading[1].replace(/\*\*/g,''),lines:[]};continue}
  if(line)current.lines.push(line);else if(current.lines.length&&current.lines.at(-1)!=='')current.lines.push('');
 }
 if(current.title||current.lines.length)sections.push(current);
 return sections;
}

const SECTION_STYLES:{match:RegExp;icon:LucideIcon;tone:string}[]=[
 {match:/veri durumu|sınır/i,icon:Database,tone:'text-sky-500 bg-sky-500/10'},
 {match:/resmî|resmi|kaynak bulgu/i,icon:Landmark,tone:'text-violet-500 bg-violet-500/10'},
 {match:/değer aralığı|fiyat/i,icon:TrendingUp,tone:'text-emerald-500 bg-emerald-500/10'},
 {match:/emsal|piyasa/i,icon:BarChart3,tone:'text-sky-500 bg-sky-500/10'},
 {match:/özet/i,icon:Sparkles,tone:'text-primary bg-primary/10'},
 {match:/adım/i,icon:ListChecks,tone:'text-amber-500 bg-amber-500/10'},
 {match:/doğrulan|analiz/i,icon:FileSearch,tone:'text-emerald-500 bg-emerald-500/10'},
 {match:/kaynak|belge/i,icon:ClipboardList,tone:'text-violet-500 bg-violet-500/10'},
 {match:/sonuç|öneri|özet/i,icon:Lightbulb,tone:'text-amber-500 bg-amber-500/10'},
 {match:/risk|uyarı|dikkat/i,icon:ShieldAlert,tone:'text-rose-500 bg-rose-500/10'}
];
const styleFor=(title:string)=>SECTION_STYLES.find(s=>s.match.test(title))??{icon:ScrollText,tone:'text-primary bg-primary/10'};

function Inline({text}:{text:string}){
 // **kalın** ve `kod` parçaları
 const parts=text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
 return <>{parts.map((p,i)=>p.startsWith('**')?<strong key={i} className="font-semibold text-foreground">{p.slice(2,-2)}</strong>
  :p.startsWith('`')?<code key={i} className="rounded bg-muted px-1 font-mono text-[12px]">{p.slice(1,-1)}</code>:<React.Fragment key={i}>{p}</React.Fragment>)}</>;
}

// "Alan: 489 m²" gibi maddeleri etiket/değer satırı olarak göster.
function Bullet({text}:{text:string}){
 const kv=text.match(/^([^:]{2,26}):\s+(.+)$/);
 if(kv)return <li className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
  <span className="text-muted-foreground"><Inline text={kv[1]}/></span><span className="text-right font-medium text-foreground"><Inline text={kv[2]}/></span>
 </li>;
 return <li className="flex gap-2 py-1"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-primary"/><span><Inline text={text}/></span></li>;
}

function Body({lines}:{lines:string[]}){
 const blocks:React.ReactNode[]=[];
 let list:string[]=[];
 const flush=()=>{if(list.length){blocks.push(<ul key={blocks.length} className="text-[13px]">{list.map((l,i)=><Bullet key={i} text={l}/>)}</ul>);list=[]}};
 for(const line of lines){
  const item=line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
  if(item){list.push(item[1]);continue}
  flush();
  if(line)blocks.push(<p key={blocks.length} className="text-[13px] leading-relaxed text-foreground/85"><Inline text={line}/></p>);
 }
 flush();
 return <div className="space-y-2">{blocks}</div>;
}

export function AnalysisView({text,lat,lng,citations=[],webSearch,note}:{text:string;lat?:number;lng?:number;citations?:{url:string;title:string}[];webSearch?:boolean;note?:string|null}){
 const sections=parse(text);
 return <div className="space-y-3">
  <div className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary/15 to-transparent px-3 py-2 text-xs font-semibold text-primary">
   <Sparkles size={14}/>AI raporu{webSearch&&<span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-px text-[10px]"><Globe size={10}/>web araştırmalı</span>}
   {lat!=null&&lng!=null&&<span className="ml-auto inline-flex items-center gap-1 font-mono font-normal text-muted-foreground"><MapPin size={12}/>{lat.toFixed(5)}, {lng.toFixed(5)}</span>}
  </div>
  {sections.map((s,i)=>{
   const {icon:Icon,tone}=styleFor(s.title);
   return <motion.section key={i} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:i*.06}}
    className="rounded-lg border border-border bg-card p-3">
    {s.title&&<h4 className="mb-2 flex items-center gap-2 text-[13px] font-bold text-foreground">
     <span className={cn('grid size-7 place-items-center rounded-md',tone)}><Icon size={15}/></span>{s.title}</h4>}
    <Body lines={s.lines}/>
   </motion.section>;
  })}
  {note&&<p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">{note}</p>}
  {citations.length>0&&<section className="rounded-lg border border-border bg-card p-3">
   <h4 className="mb-2 flex items-center gap-2 text-[13px] font-bold"><span className="grid size-7 place-items-center rounded-md bg-primary/10 text-primary"><Link2 size={15}/></span>Kaynaklar ({citations.length})</h4>
   <ol className="space-y-1 text-xs">{citations.map((c,i)=><li key={c.url} className="flex gap-2"><span className="w-4 shrink-0 text-muted-foreground">{i+1}.</span>
    <a href={c.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline" title={c.url}>{c.title}<span className="ml-1 text-muted-foreground">· {hostOf(c.url)}</span></a></li>)}</ol>
  </section>}
  <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground"><ShieldAlert size={13} className="mt-px shrink-0"/>AI çıktısıdır; tapu, imar ve değer bilgisi için resmî kaynaklardan doğrulayın.</p>
 </div>;
}
