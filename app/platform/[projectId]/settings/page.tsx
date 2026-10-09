"use client";
import { useEffect,useState } from "react";
import { Check,Eye,EyeOff,Plus,Save,Trash2,ShieldCheck,Settings2,Upload,Image as ImageIcon,X } from "lucide-react";
import { useParams } from "next/navigation";
import { ProjectShell,UserRole } from "@/components/project-shell";
import { supabase } from "@/lib/supabase";
const providers=[["chatgpt","ChatGPT"],["gemini","Gemini"],["perplexity","Perplexity"],["google_ai_overview","Google AI Overview"],["claude","Claude"]] as const;
export default function SettingsPage(){
 const {projectId}=useParams<{projectId:string}>();const [role,setRole]=useState<UserRole>("viewer"),[brand,setBrand]=useState({brand_name:"",brand_description:"",brand_domains:"",brand_terms:"",brand_logo_url:""}),[topics,setTopics]=useState<string[]>([]),[newTopic,setNewTopic]=useState(""),[llms,setLlms]=useState<Record<string,{enabled:boolean;last4:string|null;key_updated_at:string|null}>>({}),[keys,setKeys]=useState<Record<string,string>>({}),[show,setShow]=useState<Record<string,boolean>>({}),[password,setPassword]=useState(""),[preferences,setPreferences]=useState({theme:"light",text_size:100,scale:100}),[message,setMessage]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[logoUploading,setLogoUploading]=useState(false),[logoPreviewError,setLogoPreviewError]=useState("");
 async function load(){const {data:{user}}=await supabase.auth.getUser();if(!user)return;const [{data:p},{data:profile},{data:m},{data:configs}]=await Promise.all([supabase.from("projects").select("brand_name,brand_description,brand_domains,brand_terms,brand_logo_url,topics").eq("id",projectId).single(),supabase.from("profiles").select("role").eq("id",user.id).single(),supabase.from("project_members").select("role").eq("project_id",projectId).eq("user_id",user.id).maybeSingle(),supabase.from("llm_configs").select("provider,enabled,api_key_last4,key_updated_at").eq("project_id",projectId)]);setRole(profile?.role==="superadmin"?"superadmin":m?.role??profile?.role??"viewer");if(p){setBrand({brand_name:p.brand_name,brand_description:p.brand_description||"",brand_domains:(p.brand_domains||[]).join("\n"),brand_terms:(p.brand_terms||[]).join("\n"),brand_logo_url:p.brand_logo_url||""});setTopics(p.topics||[])}const map:Record<string,{enabled:boolean;last4:string|null;key_updated_at:string|null}>={};for(const c of configs??[])map[c.provider]={enabled:c.enabled,last4:c.api_key_last4,key_updated_at:c.key_updated_at};setLlms(map)}
 useEffect(()=>{load()},[projectId]);
 const canEdit=role==="admin"||role==="superadmin";
 useEffect(()=>{supabase.auth.getUser().then(async({data:{user}})=>{if(!user)return;const {data}=await supabase.from("profiles").select("ui_preferences").eq("id",user.id).single();if(data?.ui_preferences)setPreferences({...preferences,...data.ui_preferences});})},[]);
 useEffect(()=>{document.documentElement.style.fontSize=preferences.text_size+"%";document.body.style.zoom=String(preferences.scale/100);document.documentElement.classList.toggle("dark",preferences.theme==="dark");document.documentElement.dataset.theme=preferences.theme},[preferences]);
 async function saveBrand(){setBusy(true);setMessage("");setError("");const {error}=await supabase.from("projects").update({brand_name:brand.brand_name.trim(),brand_description:brand.brand_description.trim()||null,brand_domains:brand.brand_domains.split("\n").map(x=>x.trim()).filter(Boolean),brand_terms:brand.brand_terms.split("\n").map(x=>x.trim()).filter(Boolean),brand_logo_url:brand.brand_logo_url.trim()||null,topics}).eq("id",projectId);if(error)setError(error.message);else setMessage("Brand settings saved.");setBusy(false)}
 const allowedLogoTypes=["image/png","image/jpeg","image/webp","image/gif","image/svg+xml","image/avif"];
 async function uploadLogo(file?:File){
  if(!file)return;
  setMessage("");setError("");setLogoPreviewError("");
  if(!canEdit){setError("Only project Admins and Superadmins can upload a logo.");return;}
  if(!allowedLogoTypes.includes(file.type)){setError("Unsupported image format. Use PNG, JPEG, WebP, GIF, SVG or AVIF.");return;}
  if(file.size>5*1024*1024){setError("Logo file must be 5 MB or smaller.");return;}
  const extensionByType:Record<string,string>={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif","image/svg+xml":"svg","image/avif":"avif"};
  const path=projectId+"/logo."+extensionByType[file.type];
  setLogoUploading(true);
  const {error:uploadError}=await supabase.storage.from("project-brand-logos").upload(path,file,{upsert:true,contentType:file.type,cacheControl:"3600"});
  if(uploadError){setError("Logo upload failed: "+uploadError.message);setLogoUploading(false);return;}
  const {data}=supabase.storage.from("project-brand-logos").getPublicUrl(path);
  const url=data.publicUrl+(data.publicUrl.includes("?")?"&":"?")+"v="+Date.now();
  const {error:updateError}=await supabase.from("projects").update({brand_logo_url:url}).eq("id",projectId);
  if(updateError){setError("The file uploaded, but the project logo could not be saved: "+updateError.message);setLogoUploading(false);return;}
  setBrand(v=>({...v,brand_logo_url:url}));setMessage("Brand logo uploaded and saved.");setLogoUploading(false);
 }
 async function removeLogo(){
  if(!canEdit||!brand.brand_logo_url)return;
  setBusy(true);setMessage("");setError("");
  const match=brand.brand_logo_url.split("?")[0].toLowerCase().match(/\.(png|jpe?g|webp|gif|svg|avif)$/);
  const path=projectId+"/logo."+(match?.[1]||"png");
  const {error:storageError}=await supabase.storage.from("project-brand-logos").remove([path]);
  if(storageError){setError("Unable to remove the previous logo file: "+storageError.message);setBusy(false);return;}
  const {error:updateError}=await supabase.from("projects").update({brand_logo_url:null}).eq("id",projectId);
  if(updateError)setError(updateError.message);else{setBrand(v=>({...v,brand_logo_url:""}));setMessage("Brand logo removed.");}
  setBusy(false);
 }
 async function functionErrorMessage(error:any){
  if(error?.context instanceof Response){try{const body=await error.context.clone().json();if(body?.error)return body.error;}catch{}}
  return error?.message||"Failed to contact the Edge Function.";
 }
 async function saveKey(provider:string){const key=keys[provider]?.trim();if(!key)return;setBusy(true);setMessage("");setError("");const {error}=await supabase.functions.invoke("llm-key-management",{body:{action:"set",project_id:projectId,provider,api_key:key}});if(error)setError(await functionErrorMessage(error));else{setKeys(v=>({...v,[provider]:""}));setMessage(provider+" API key updated. Only the last four characters are shown.");await load()}setBusy(false)}
 async function removeKey(provider:string){if(!confirm("Remove this API key configuration?"))return;setBusy(true);setMessage("");setError("");const {error}=await supabase.functions.invoke("llm-key-management",{body:{action:"remove",project_id:projectId,provider}});if(error)setError(await functionErrorMessage(error));else{setMessage("API key removed.");await load()}setBusy(false)}
 async function savePreferences(){setBusy(true);setMessage("");setError("");const {data:{user}}=await supabase.auth.getUser();if(!user){setError("Please sign in again to save your preferences.");setBusy(false);return;}const {error}=await supabase.rpc("save_my_ui_preferences",{p_preferences:preferences});if(error)setError(error.message);else setMessage("Platform preferences saved.");setBusy(false);}
 async function changePassword(){if(password.length<8){setError("Password must be at least 8 characters.");return}setBusy(true);const {error}=await supabase.auth.updateUser({password});if(error)setError(error.message);else{setPassword("");setMessage("Password updated.");}setBusy(false)}
 return (
  <ProjectShell>
    <div className="ops-page">
      <header className="page-heading">
        <p className="page-eyebrow">System</p>
        <h1 className="page-title mt-1">Settings</h1>
        <p className="page-description mt-2">Control the project, your account and the AI Visibility platform experience.</p>
      </header>

      <div className="mt-8 space-y-8 pb-8">
        {message && (
          <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <Check size={16}/>{message}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section>
          <div className="mb-4 flex items-end gap-3 border-b border-[var(--line)] pb-3">
            <div className="platform-icon"><Settings2 size={17}/></div>
            <div>
              <h2 className="text-xl font-semibold">Project Settings</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Client information, visibility configuration and answer-engine connections.</p>
            </div>
          </div>

          <div className="platform-card overflow-hidden">
            <div className="platform-card-header">
              <h3 className="text-lg font-semibold">Brand details &amp; visibility configuration</h3>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Keep the client identity and AI tracking inputs together in one workspace.</p>
            </div>
            <div className="p-5 sm:p-6">
              <div className="grid gap-5 lg:grid-cols-2">
                <label className="text-sm font-semibold">
                  Brand name
                  <input disabled={!canEdit} value={brand.brand_name} onChange={e=>setBrand({...brand,brand_name:e.target.value})} className="mt-2 w-full platform-input disabled:bg-[var(--paper)]"/>
                </label>
                <div className="text-sm font-semibold">
                  Brand logo
                  <p className="mt-1 text-xs font-normal text-[var(--muted-foreground)]">Upload an image file for the workspace header. PNG, JPEG, WebP, GIF, SVG or AVIF · Max 5 MB.</p>
                  <div className="mt-3 flex flex-wrap items-center gap-4 rounded-xl border border-[var(--line)] p-3">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--line)] bg-white">
                      {brand.brand_logo_url ? <img src={brand.brand_logo_url} alt="Brand logo preview" onError={()=>setLogoPreviewError("The saved logo preview could not be loaded.")} onLoad={()=>setLogoPreviewError("")} className="h-full w-full object-contain p-1.5"/> : <ImageIcon size={22} className="text-slate-400"/>}
                    </div>
                    <div className="min-w-0 flex-1">
                      {brand.brand_logo_url ? <p className="break-all text-xs font-normal text-[var(--muted-foreground)]">Logo uploaded</p> : <p className="text-xs font-normal text-[var(--muted-foreground)]">No logo uploaded. The header will show the default AI mark.</p>}
                      {logoPreviewError&&<p className="mt-1 text-xs font-normal text-red-600">{logoPreviewError}</p>}
                      {canEdit&&<div className="mt-2 flex flex-wrap gap-2">
                        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-xs font-semibold ${logoUploading?"pointer-events-none opacity-50":"hover:bg-[var(--soft)]"}`}>
                          <Upload size={14}/>{logoUploading?"Uploading…":brand.brand_logo_url?"Replace logo":"Upload logo"}
                          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif" disabled={logoUploading||busy} onChange={e=>{const file=e.target.files?.[0];void uploadLogo(file);e.currentTarget.value="";}} className="sr-only"/>
                        </label>
                        {brand.brand_logo_url&&<button type="button" disabled={busy||logoUploading} onClick={()=>void removeLogo()} className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"><X size={14}/>Remove logo</button>}
                      </div>}
                    </div>
                  </div>
                </div>
                <label className="text-sm font-semibold lg:col-span-2">
                  Description
                  <textarea disabled={!canEdit} rows={4} value={brand.brand_description} onChange={e=>setBrand({...brand,brand_description:e.target.value})} className="mt-2 w-full resize-none platform-input disabled:bg-[var(--paper)]"/>
                </label>
                <label className="text-sm font-semibold">
                  Brand domains <span className="ml-1 font-normal text-[#66736c]">(one per line)</span>
                  <textarea disabled={!canEdit} rows={4} value={brand.brand_domains} onChange={e=>setBrand({...brand,brand_domains:e.target.value})} className="mt-2 w-full platform-input disabled:bg-[var(--paper)]"/>
                </label>
                <label className="text-sm font-semibold">
                  Brand mention terms <span className="ml-1 font-normal text-[#66736c]">(one per line)</span>
                  <textarea disabled={!canEdit} rows={4} value={brand.brand_terms} onChange={e=>setBrand({...brand,brand_terms:e.target.value})} className="mt-2 w-full platform-input disabled:bg-[var(--paper)]"/>
                </label>
              </div>

              <div className="mt-5">
                <div className="text-sm font-semibold">Topics</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {topics.map(t=>(
                    <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[var(--soft)] px-3 py-1.5 text-xs font-semibold text-[var(--green)]">
                      {t}
                      {canEdit && <button onClick={()=>setTopics(v=>v.filter(x=>x!==t))}>×</button>}
                    </span>
                  ))}
                </div>
                {canEdit && (
                  <div className="mt-3 flex gap-2">
                    <input value={newTopic} onChange={e=>setNewTopic(e.target.value)} placeholder="Add topic" className="platform-input text-sm"/>
                    <button onClick={()=>{if(newTopic.trim()&&!topics.includes(newTopic.trim())){setTopics([...topics,newTopic.trim()]);setNewTopic("")}}} className="inline-flex items-center gap-2 platform-btn text-sm font-semibold">
                      <Plus size={15}/> Add
                    </button>
                  </div>
                )}
              </div>

              {canEdit && (
                <button disabled={busy} onClick={saveBrand} className="mt-6 inline-flex items-center gap-2 platform-btn platform-btn-primary">
                  <Save size={16}/> Save brand settings
                </button>
              )}
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end gap-3 border-b border-[var(--line)] pb-3">
            <div className="platform-icon"><Eye size={17}/></div>
            <div>
              <h2 className="text-xl font-semibold">AI Answer Engine Connections</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Configure the providers used for daily visibility collection.</p>
            </div>
          </div>

          <div className="platform-card overflow-hidden">
            <div className="platform-card-header">
              <h3 className="text-lg font-semibold">LLM API Keys</h3>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Keys are never displayed after entry. Only the last four characters are shown.</p>
            </div>
            <div className="p-5 sm:p-6">
              <div className="grid gap-4 lg:grid-cols-2">
                {providers.map(([id,label])=>{
                  const c=llms[id];
                  return (
                    <div key={id} className="ops-card p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-semibold">{label}</h4>
                          <p className="mt-1 text-xs text-[#66736c]">{c?.enabled&&c.last4?"Configured · ••••"+c.last4:"Not configured"}</p>
                        </div>
                        {c?.enabled && <span className="rounded-full bg-[#eaf5ef] px-2.5 py-1 text-xs font-bold text-[var(--green)]">Active</span>}
                      </div>

                      {canEdit && (
                        <div className="mt-4 flex gap-2">
                          <div className="relative flex-1">
                            <input type={show[id]?"text":"password"} value={keys[id]||""} onChange={e=>setKeys({...keys,[id]:e.target.value})} placeholder={c?.last4?"Enter a replacement key":"Paste API key"} className="w-full platform-input pr-10 text-sm"/>
                            <button onClick={()=>setShow({...show,[id]:!show[id]})} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#66736c]">
                              {show[id]?<EyeOff size={16}/>:<Eye size={16}/>}
                            </button>
                          </div>
                          <button onClick={()=>saveKey(id)} disabled={!keys[id]?.trim()||busy} className="rounded-xl bg-[#0d5b3a] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Save</button>
                          {c?.enabled && <button onClick={()=>removeKey(id)} className="rounded-xl border border-red-200 px-3 py-2.5 text-[#a13f35]"><Trash2 size={16}/></button>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end gap-3 border-b border-[var(--line)] pb-3">
            <div className="platform-icon"><Settings2 size={17}/></div>
            <div>
              <h2 className="text-xl font-semibold">Platform Settings</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Control how the platform looks and feels while you work.</p>
            </div>
          </div>

          <div className="platform-card overflow-hidden">
            <div className="platform-card-header">
              <h3 className="text-lg font-semibold">Appearance &amp; Preferences</h3>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Display preferences apply only to your current account.</p>
            </div>
            <div className="p-5 sm:p-6">
              <div className="grid gap-5 md:grid-cols-3">
                <label className="text-sm font-semibold">
                  Theme
                  <select value={preferences.theme} onChange={e=>setPreferences({...preferences,theme:e.target.value})} className="mt-2 w-full platform-input">
                    <option value="light">Light</option><option value="dark">Dark</option>
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Text size
                  <select value={preferences.text_size} onChange={e=>setPreferences({...preferences,text_size:Number(e.target.value)})} className="mt-2 w-full platform-input">
                    {[75,90,100,110,125].map(v=><option key={v} value={v}>{v}%</option>)}
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Platform scale
                  <select value={preferences.scale} onChange={e=>setPreferences({...preferences,scale:Number(e.target.value)})} className="mt-2 w-full platform-input">
                    {[75,90,100,110,125].map(v=><option key={v} value={v}>{v}%</option>)}
                  </select>
                </label>
              </div>
              <button onClick={savePreferences} disabled={busy} className="mt-6 inline-flex items-center gap-2 platform-btn disabled:opacity-50">
                <Save size={16}/> Save platform settings
              </button>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end gap-3 border-b border-[var(--line)] pb-3">
            <div className="platform-icon"><ShieldCheck size={17}/></div>
            <div>
              <h2 className="text-xl font-semibold">Account Settings</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Your account credentials and access to this project.</p>
            </div>
          </div>

          <div className="platform-card overflow-hidden">
            <div className="platform-card-header">
              <h3 className="text-lg font-semibold">Account</h3>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Update your password and review your registered account.</p>
            </div>
            <div className="p-5 sm:p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <AccountField label="Registered name"/>
                <AccountField label="Registered email"/>
              </div>
              <div className="mt-5 max-w-xl">
                <label className="text-sm font-semibold">
                  New password
                  <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minimum 8 characters" className="mt-2 w-full platform-input"/>
                </label>
                <button onClick={changePassword} disabled={busy||!password} className="mt-3 platform-btn">Change password</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </ProjectShell>
 );
}
function AccountField({label}:{label:string}){
 const [value,setValue]=useState("Loading…");
 useEffect(()=>{
   supabase.auth.getUser().then(async({data:{user}})=>{
     if(label==="Registered email") setValue(user?.email||"—");
     else if(user){
       const {data}=await supabase.from("profiles").select("full_name").eq("id",user.id).single();
       setValue(data?.full_name||"—");
     }
   });
 },[label]);
 return (
   <label className="text-sm font-semibold">
     {label}
     <input readOnly value={value} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3"/>
   </label>
 );
}
