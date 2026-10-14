"use client";
import { useEffect,useMemo,useState } from "react";
import { useParams } from "next/navigation";
import { ProjectShell } from "@/components/project-shell";
import { MetricChart } from "@/components/metric-chart";
import { supabase } from "@/lib/supabase";
type Row={metric_date:string;topic:string;llm_provider:string;visibility_score:number|null;visibility_rank:number|null;share_of_voice_score:number|null;share_of_voice_rank:number|null;average_position:number|null;average_position_rank:number|null};
function localDateString(date = new Date()) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"); }
const LLMS=["chatgpt","gemini","perplexity","google_ai_overview","claude"],labels:Record<string,string>={chatgpt:"ChatGPT",gemini:"Gemini",perplexity:"Perplexity",google_ai_overview:"Google AI Overview",claude:"Claude"};
export default function AnalyticsPage(){
 const {projectId}=useParams<{projectId:string}>();const [rows,setRows]=useState<Row[]>([]),[topics,setTopics]=useState<string[]>([]),[selectedTopics,setSelectedTopics]=useState<string[]>([]),[selectedLlms,setSelectedLlms]=useState<string[]>(LLMS),[period,setPeriod]=useState("Last 7 Days"),[customStart,setCustomStart]=useState(""),[customEnd,setCustomEnd]=useState(localDateString()),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const start=useMemo(()=>{if(period==="Custom")return customStart||localDateString();const now=new Date();const d=new Date(now.getFullYear(),now.getMonth(),now.getDate());const days=period==="Today"?0:period==="Last 2 days"?1:period==="Last 14 Days"?13:period==="Last 30 Days"?29:period==="Last 90 Days"?89:period==="All Time"?36500:6;d.setDate(d.getDate()-days);return localDateString(d)},[period,customStart]);
 const end=period==="Custom"?customEnd:localDateString();
 useEffect(()=>{(async()=>{setLoading(true);const {data:p}=await supabase.from("projects").select("topics").eq("id",projectId).single();const t=p?.topics??[];setTopics(t);setSelectedTopics(v=>v.length?v:t);const {data,error}=await supabase.from("visibility_daily").select("metric_date,topic,llm_provider,visibility_score,visibility_rank,share_of_voice_score,share_of_voice_rank,average_position,average_position_rank").eq("project_id",projectId).neq("llm_provider","Overall").gte("metric_date",start).lte("metric_date",end).order("metric_date");if(error)setError(error.message);setRows(data??[]);setLoading(false)})()},[projectId,start,end]);
 const chartDateRange={start:period==="All Time"?(rows.map(r=>r.metric_date).sort()[0]??start):start,end};
 const filtered=rows.filter(r=>(selectedTopics.length===0||selectedTopics.includes(r.topic))&&(selectedLlms.length===0||selectedLlms.includes(r.llm_provider)));
 function aggregate(key:keyof Row){const map=new Map<string,number[]>();for(const r of filtered){const v=r[key];if(typeof v==="number"){const a=map.get(r.metric_date)||[];a.push(v);map.set(r.metric_date,a)}}return [...map.entries()].sort().map(([date,vals])=>({label:date,value:vals.reduce((a,b)=>a+b,0)/vals.length}))}
 return <ProjectShell>
  <div className="ops-page">
    <header className="page-heading">
      <p className="page-eyebrow">Analytics</p>
      <h1 className="page-title mt-1">Detailed analytics</h1>
      <p className="page-description mt-2">Compare visibility, share of voice and average position by answer engine.</p>
    </header>

    <section className="mt-8 ops-filter-panel">
      <div className="ops-filter-row">
        <span className="ops-filter-label">Period</span>
        {["Today","Last 2 Days","Last 7 Days","Last 14 Days","Last 30 Days","Last 90 Days","All Time","Custom"].map(p=>{
          const normalized=p==="Last 2 Days"?"Last 2 days":p;
          return <button key={p} onClick={()=>setPeriod(normalized)} className={`ops-filter-btn ${period===normalized?"is-active":""}`}>{p}</button>
        })}
        {period==="Custom"&&<><label className="sr-only" htmlFor="analytics-start">Start date</label><input id="analytics-start" type="date" value={customStart} max={customEnd} onChange={e=>setCustomStart(e.target.value)} className="platform-input max-w-[180px] text-xs"/><span className="text-xs font-semibold text-[var(--muted-foreground)]">to</span><label className="sr-only" htmlFor="analytics-end">End date</label><input id="analytics-end" type="date" value={customEnd} min={customStart||undefined} onChange={e=>setCustomEnd(e.target.value)} className="platform-input max-w-[180px] text-xs"/></>}
      </div>
      <div className="ops-filter-row">
        <span className="ops-filter-label">Topics</span>
        {topics.length ? topics.map(t=>
          <button key={t} onClick={()=>setSelectedTopics(v=>v.includes(t)?v.filter(x=>x!==t):[...v,t])} className={`ops-filter-pill ${selectedTopics.includes(t)?"is-active":""}`}>{t}</button>
        ) : <span className="text-xs text-[var(--muted-foreground)]">No topics configured.</span>}
      </div>
      <div className="ops-filter-row">
        <span className="ops-filter-label">Engines</span>
        {LLMS.map(l=>
          <button key={l} onClick={()=>setSelectedLlms(v=>v.includes(l)?v.filter(x=>x!==l):[...v,l])} className={`ops-filter-pill ${selectedLlms.includes(l)?"is-active":""}`}>{labels[l]}</button>
        )}
      </div>
    </section>

    {error&&<div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    {loading
      ? <div className="mt-6 grid gap-5 md:grid-cols-2">{[1,2,3,4,5,6].map(x=><div key={x} className="h-72 animate-pulse rounded-2xl bg-white"/>)}</div>
      : <div className="mt-6 grid gap-5 md:grid-cols-2">
          <MetricChart data={aggregate("visibility_score")} title="Visibility Score" format="percent" dateRange={chartDateRange}/>
          <MetricChart data={aggregate("visibility_rank")} title="Visibility Rank" invert dateRange={chartDateRange}/>
          <MetricChart data={aggregate("share_of_voice_score")} title="Share of Voice" description="Your brand mentions divided by all identifiable brand mentions across the selected responses." format="percent" dateRange={chartDateRange}/>
          <MetricChart data={aggregate("share_of_voice_rank")} title="Share of Voice Rank" description="Your rank against the other identifiable brands by share of voice; rank 1 is best." invert dateRange={chartDateRange}/>
          <MetricChart data={aggregate("average_position")} title="Average Position" description="The average order in which your brand is first mentioned relative to other identifiable brands in each response where it appears. Lower is better." invert dateRange={chartDateRange}/>
          <MetricChart data={aggregate("average_position_rank")} title="Average Position Rank" description="Your rank compared with identifiable competitors by average mention position; rank 1 is best." invert dateRange={chartDateRange}/>
        </div>
    }

    <section className="mt-8 platform-card overflow-hidden">
      <div className="platform-card-header">
        <h3 className="text-lg font-semibold">Answer Engine Snapshot</h3>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Latest visibility score for each selected provider.</p>
      </div>
      <div className="p-5">
        <h3 className="text-sm font-semibold">LLM latest values</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {LLMS.filter(l=>selectedLlms.includes(l)).map(l=>{
            const rs=filtered.filter(r=>r.llm_provider===l).sort((a,b)=>b.metric_date.localeCompare(a.metric_date));
            const r=rs[0];
            return <div key={l} className="rounded-xl border border-[var(--line)] bg-[var(--muted)] p-4">
              <div className="text-xs font-bold text-[#66736c]">{labels[l]}</div>
              <div className="mt-2 text-2xl font-semibold">{r?.visibility_score!=null?r.visibility_score.toFixed(1)+"%":"—"}</div>
              <div className="text-xs text-[#66736c]">visibility score</div>
            </div>
          })}
        </div>
      </div>
    </section>
  </div>
 </ProjectShell>}
