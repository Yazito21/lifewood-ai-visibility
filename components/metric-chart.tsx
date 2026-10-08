"use client";

export type ChartPoint={label:string;value:number|null};

export function MetricChart({data,title,format="number"}:{data:ChartPoint[];title:string;format?:"number"|"percent"}) {
  const valid=data.filter(p=>p.value!==null) as {label:string;value:number}[];
  if(!valid.length)return <div className="flex h-64 items-center justify-center platform-card border-dashed text-sm text-[#66736c]">No data for this period.</div>;
  const values=valid.map(p=>p.value),min=Math.min(...values),max=Math.max(...values),range=max-min||1;
  const w=760,h=230,padX=26,padY=24;
  const points=valid.map((p,i)=>{const x=padX+(i/(Math.max(valid.length-1,1)))*(w-padX*2);const y=padY+(1-(p.value-min)/range)*(h-padY*2);return {x,y,...p}});
  const path=points.map((p,i)=>(i?"L":"M")+p.x.toFixed(1)+" "+p.y.toFixed(1)).join(" ");
  const display=(v:number)=>format==="percent"?v.toFixed(1)+"%":Number.isInteger(v)?String(v):v.toFixed(1);
  return <div className="platform-card p-5">
    <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">{title}</h3><span className="text-xs text-[#66736c]">{display(valid[valid.length-1].value)} latest</span></div>
    <svg viewBox={`0 0 ${w} ${h}`} className="h-56 w-full" role="img" aria-label={title}>
      <line x1={padX} y1={h-padY} x2={w-padX} y2={h-padY} stroke="#d9ded9"/><line x1={padX} y1={padY} x2={padX} y2={h-padY} stroke="#d9ded9"/>
      <path d={path} fill="none" stroke="#0d5b3a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      {points.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="4" fill="#f5b64c" stroke="#0d5b3a" strokeWidth="2"><title>{p.label}: {display(p.value)}</title></circle>)}
    </svg>
    <div className="flex justify-between text-[11px] text-[#8a958e]"><span>{valid[0].label}</span><span>{valid[valid.length-1].label}</span></div>
  </div>;
}
