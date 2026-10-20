"use client";
import { useEffect,useMemo,useRef,useState } from "react";
import { useParams } from "next/navigation";
import { ProjectShell } from "@/components/project-shell";
import { TrackingDataScope } from "@/components/tracking-data-scope";
import { MetricChart } from "@/components/metric-chart";
import { supabase } from "@/lib/supabase";
import { malaysiaDateString, reportingDateRange, REPORTING_PERIODS } from "@/lib/reporting-date";
type Row={metric_date:string;topic:string;llm_provider:string;visibility_score:number|null;visibility_rank:number|null;share_of_voice_score:number|null;share_of_voice_rank:number|null;average_position:number|null;average_position_rank:number|null};
const LLMS=["chatgpt","gemini","perplexity","google_ai_overview","claude"],labels:Record<string,string>={chatgpt:"ChatGPT",gemini:"Gemini",perplexity:"Perplexity",google_ai_overview:"Google AI Overview",claude:"Claude"};
export default function AnalyticsPage(){
 const {projectId}=useParams<{projectId:string}>();
 const topicSelectionInitialized=useRef(false);
 const selectionProjectId=useRef(projectId);
 if(selectionProjectId.current!==projectId){selectionProjectId.current=projectId;topicSelectionInitialized.current=false;}const [rows,setRows]=useState<Row[]>([]),[topics,setTopics]=useState<string[]>([]),[trackingLocation,setTrackingLocation]=useState("MY"),[scope,setScope]=useState<"current"|"legacy">("current"),[selectedTopics,setSelectedTopics]=useState<string[]>([]),[selectedLlms,setSelectedLlms]=useState<string[]>(["chatgpt"]),[period,setPeriod]=useState("Last 7 Days"),[customStart,setCustomStart]=useState(""),[customEnd,setCustomEnd]=useState(malaysiaDateString()),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const {start,end}=useMemo(()=>reportingDateRange(period,customStart,customEnd),[period,customStart,customEnd]);
 useEffect(()=>{(async()=>{setLoading(true);const {data:p}=await supabase.from("projects").select("topics,tracking_market").eq("id",projectId).single();const t=p?.topics??[];const location=p?.tracking_market??"MY";const dataLocation=scope==="legacy"?"LEGACY":location;setTrackingLocation(location);setTopics(t);if(!topicSelectionInitialized.current){setSelectedTopics(t);topicSelectionInitialized.current=true;}else{setSelectedTopics(v=>v.filter(topic=>t.includes(topic)));}const {data,error}=await supabase.from("visibility_daily").select("metric_date,topic,llm_provider,visibility_score,visibility_rank,share_of_voice_score,share_of_voice_rank,average_position,average_position_rank").eq("project_id",projectId).eq("tracking_location",dataLocation).neq("llm_provider","Overall").gte("metric_date",start).lte("metric_date",end).order("metric_date");if(error)setError(error.message);setRows(data??[]);setLoading(false)})()},[projectId,start,end,scope]);
 const chartDateRange=useMemo(()=>{
  const trackedDates=rows.map(r=>r.metric_date).sort();
  const firstTrackedDate=trackedDates[0];
  const requestedStart=period==="All Time"?(firstTrackedDate??start):start;
  return {start:firstTrackedDate&&firstTrackedDate>requestedStart?firstTrackedDate:requestedStart,end};
 },[rows,period,start,end]);
 const filtered=rows.filter(r=>selectedTopics.includes(r.topic)&&selectedLlms.includes(r.llm_provider));
 function aggregate(key:keyof Row){const map=new Map<string,number[]>();for(const r of filtered){const v=r[key];if(typeof v==="number"&&Number.isFinite(v)){const a=map.get(r.metric_date)||[];a.push(v);map.set(r.metric_date,a)}}return [...map.entries()].sort().map(([date,vals])=>({label:date,value:vals.reduce((a,b)=>a+b,0)/vals.length}))}
 return <ProjectShell>
  <div className="ops-page">
    <header className="page-heading">
      <p className="page-eyebrow">Analytics</p>
      <h1 className="page-title mt-1">Detailed analytics</h1>
      <p className="page-description mt-2">Compare visibility, share of voice and average position by answer engine for the selected reporting dataset. Gaps indicate dates without recorded values.</p>
      <TrackingDataScope trackingLocation={trackingLocation} scope={scope} onScopeChange={setScope} />
    </header>

    <section className="mt-8 ops-filter-panel">
      <div className="ops-filter-row">
        <span className="ops-filter-label">Period</span>
        {REPORTING_PERIODS.map((p)=> <button key={p} onClick={()=>setPeriod(p)} className={`ops-filter-btn ${period===p?"is-active":""}`}>{p}</button>)}
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
          <MetricChart data={aggregate("visibility_score")} title="Mean Visibility Score" description="Arithmetic mean across the selected topics and engines." format="percent" dateRange={chartDateRange}/>
          <MetricChart data={aggregate("visibility_rank")} title="Mean Visibility Rank" description="Arithmetic mean of the selected topic/engine ranks; compare dates using the same filters." invert dateRange={chartDateRange}/>
          <MetricChart data={aggregate("share_of_voice_score")} title="Mean Share of Voice" description="Arithmetic mean of the daily share-of-voice values across the selected topics and engines." format="percent" dateRange={chartDateRange}/>
          <MetricChart data={aggregate("share_of_voice_rank")} title="Mean Share of Voice Rank" description="Arithmetic mean of the selected topic/engine ranks; compare dates using the same filters." invert dateRange={chartDateRange}/>
          <MetricChart data={aggregate("average_position")} title="Mean Average Position" description="Arithmetic mean of the selected topic/engine average positions; lower is better." invert dateRange={chartDateRange}/>
          <MetricChart data={aggregate("average_position_rank")} title="Mean Average Position Rank" description="Arithmetic mean of the selected topic/engine ranks; compare dates using the same filters." invert dateRange={chartDateRange}/>
        </div>
    }

    <section className="mt-8 platform-card overflow-hidden">
      <div className="platform-card-header">
        <h3 className="text-lg font-semibold">Answer Engine Snapshot</h3>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Latest overall visibility score for each selected engine, using the dedicated Overall metric.</p>
      </div>
      <div className="p-5">
        <h3 className="text-sm font-semibold">LLM latest values</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {LLMS.filter(l=>selectedLlms.includes(l)).map(l=>{
            const rs=rows.filter(r=>r.llm_provider===l&&r.topic==="Overall"&&r.visibility_score!=null).sort((a,b)=>b.metric_date.localeCompare(a.metric_date));
            const latest=rs[0];
            const latestDate=latest?.metric_date;
            const score=latest?.visibility_score;
            return <div key={l} className="rounded-xl border border-[var(--line)] bg-[var(--muted)] p-4">
              <div className="text-xs font-bold text-[#66736c]">{labels[l]}</div>
              <div className="mt-2 text-2xl font-semibold">{score!=null?score.toFixed(1)+"%":"—"}</div>
              <div className="text-xs text-[#66736c]">overall visibility score</div>
              <div className="mt-1 text-[10px] text-[#66736c]">{latestDate??"No data"}</div>
            </div>
          })}
        </div>
      </div>
    </section>
  </div>
 </ProjectShell>}
