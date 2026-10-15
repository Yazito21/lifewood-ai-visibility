"use client";
import { useEffect,useState } from "react";
import { Check,Eye,EyeOff,Plus,Save,Trash2,Settings2,Upload,Image as ImageIcon,X,LogOut,Mail,UserRound } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { ProjectShell,UserRole } from "@/components/project-shell";
import { supabase } from "@/lib/supabase";
const providers=[["chatgpt","ChatGPT"],["gemini","Gemini"],["perplexity","Perplexity"],["google_ai_overview","Google AI Overview"],["claude","Claude"]] as const;

const marketOptions = [
  { value: "GLOBAL", label: "Global" },
  { value: "MY", label: "Malaysia" }, { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" }, { value: "SG", label: "Singapore" },
  { value: "AU", label: "Australia" }, { value: "CA", label: "Canada" },
  { value: "IN", label: "India" }, { value: "ID", label: "Indonesia" },
  { value: "TH", label: "Thailand" }, { value: "PH", label: "Philippines" },
  { value: "VN", label: "Vietnam" }, { value: "BN", label: "Brunei" },
  { value: "MM", label: "Myanmar" }, { value: "KH", label: "Cambodia" },
  { value: "LA", label: "Laos" }, { value: "TL", label: "Timor-Leste" },
  { value: "CN", label: "China" }, { value: "JP", label: "Japan" },
  { value: "KR", label: "South Korea" }, { value: "NZ", label: "New Zealand" },
  { value: "DE", label: "Germany" }, { value: "FR", label: "France" },
  { value: "ES", label: "Spain" }, { value: "IT", label: "Italy" },
  { value: "NL", label: "Netherlands" }, { value: "AE", label: "United Arab Emirates" },
  { value: "SA", label: "Saudi Arabia" }, { value: "ZA", label: "South Africa" },
  { value: "BR", label: "Brazil" }, { value: "MX", label: "Mexico" },
  { value: "TR", label: "Türkiye" }, { value: "PK", label: "Pakistan" },
  { value: "BD", label: "Bangladesh" }, { value: "NG", label: "Nigeria" },
  { value: "EG", label: "Egypt" }, { value: "IE", label: "Ireland" },
  { value: "CH", label: "Switzerland" }, { value: "SE", label: "Sweden" },
  { value: "NO", label: "Norway" }, { value: "DK", label: "Denmark" },
  { value: "PL", label: "Poland" }, { value: "PT", label: "Portugal" },
  { value: "AR", label: "Argentina" }, { value: "CL", label: "Chile" },
] as const;

export default function SettingsPage(){
 const {projectId}=useParams<{projectId:string}>();const router=useRouter();const [role,setRole]=useState<UserRole>("viewer"),[brand,setBrand]=useState({brand_name:"",brand_description:"",brand_domains:"",brand_terms:"",brand_logo_url:""}),[trackingMarket,setTrackingMarket]=useState("MY"),[topics,setTopics]=useState<string[]>([]),[newTopic,setNewTopic]=useState(""),[llms,setLlms]=useState<Record<string,{enabled:boolean;last4:string|null;key_updated_at:string|null}>>({}),[keys,setKeys]=useState<Record<string,string>>({}),[show,setShow]=useState<Record<string,boolean>>({}),[password,setPassword]=useState(""),[confirmPassword,setConfirmPassword]=useState(""),[accountName,setAccountName]=useState(""),[accountEmail,setAccountEmail]=useState(""),[accountSaving,setAccountSaving]=useState(false),[accountMessage,setAccountMessage]=useState(""),[accountError,setAccountError]=useState(""),[loggingOut,setLoggingOut]=useState(false),[logoutError,setLogoutError]=useState(""),[preferences,setPreferences]=useState({theme:"light",text_size:100,scale:100}),[message,setMessage]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[logoUploading,setLogoUploading]=useState(false),[logoPreviewError,setLogoPreviewError]=useState("");
 async function load(){const {data:{user}}=await supabase.auth.getUser();if(!user)return;const [{data:p},{data:profile},{data:m},{data:configs}]=await Promise.all([supabase.from("projects").select("brand_name,brand_description,brand_domains,brand_terms,brand_logo_url,topics,tracking_market").eq("id",projectId).single(),supabase.from("profiles").select("*").eq("id",user.id).single(),supabase.from("project_members").select("role").eq("project_id",projectId).eq("user_id",user.id).maybeSingle(),supabase.from("llm_configs").select("provider,enabled,api_key_last4,key_updated_at").eq("project_id",projectId)]);setRole(profile?.role==="superadmin"?"superadmin":m?.role??profile?.role??"viewer");setAccountEmail(user.email||"");setAccountName(profile?.display_name||profile?.full_name||user.user_metadata?.display_name||user.user_metadata?.full_name||"");if(p){setBrand({brand_name:p.brand_name,brand_description:p.brand_description||"",brand_domains:(p.brand_domains||[]).join("\n"),brand_terms:(p.brand_terms||[]).join("\n"),brand_logo_url:p.brand_logo_url||""});setTopics(p.topics||[]);setTrackingMarket(p.tracking_market||"MY")}const map:Record<string,{enabled:boolean;last4:string|null;key_updated_at:string|null}>={};for(const c of configs??[])map[c.provider]={enabled:c.enabled,last4:c.api_key_last4,key_updated_at:c.key_updated_at};setLlms(map)}
 useEffect(()=>{load()},[projectId]);
 const canEdit=role==="admin"||role==="superadmin";
 useEffect(()=>{supabase.auth.getUser().then(async({data:{user}})=>{if(!user)return;const {data}=await supabase.from("profiles").select("ui_preferences").eq("id",user.id).single();if(data?.ui_preferences)setPreferences({...preferences,...data.ui_preferences});})},[]);
 useEffect(()=>{document.documentElement.style.fontSize=preferences.text_size+"%";document.body.style.zoom=String(preferences.scale/100);document.documentElement.classList.toggle("dark",preferences.theme==="dark");document.documentElement.dataset.theme=preferences.theme},[preferences]);
 async function saveProjectDetails(){setBusy(true);setMessage("");setError("");const {error}=await supabase.from("projects").update({brand_name:brand.brand_name.trim(),brand_description:brand.brand_description.trim()||null}).eq("id",projectId);if(error)setError(error.message);else setMessage("Project details saved.");setBusy(false)}
 async function saveTrackingMarket(){setBusy(true);setMessage("");setError("");const {error}=await supabase.from("projects").update({tracking_market:trackingMarket}).eq("id",projectId);if(error)setError(error.message);else setMessage("Tracking market saved. Future tracking runs will use "+(marketOptions.find(o=>o.value===trackingMarket)?.label||trackingMarket)+".");setBusy(false)}
 async function saveBrand(){setBusy(true);setMessage("");setError("");const {error}=await supabase.from("projects").update({brand_domains:brand.brand_domains.split("\n").map(x=>x.trim()).filter(Boolean),brand_terms:brand.brand_terms.split("\n").map(x=>x.trim()).filter(Boolean),topics}).eq("id",projectId);if(error)setError(error.message);else setMessage("Visibility configuration saved.");setBusy(false)}
 async function saveBranding(){setBusy(true);setMessage("");setError("");const {error}=await supabase.from("projects").update({brand_logo_url:brand.brand_logo_url||null}).eq("id",projectId);if(error)setError(error.message);else setMessage("Branding saved.");setBusy(false)}
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
  if(updateError){setError(updateError.message);setBusy(false);return;}
  setBrand(v=>({...v,brand_logo_url:""}));setMessage("Brand logo removed.");setBusy(false);
 }
 async function functionErrorMessage(error:any){
  if(error?.context instanceof Response){try{const body=await error.context.clone().json();if(body?.error)return body.error;}catch{}}
  return error?.message||"Failed to contact the Edge Function.";
 }
 async function saveKey(provider:string){const key=keys[provider]?.trim();if(!key)return;setBusy(true);setMessage("");setError("");const {error}=await supabase.functions.invoke("llm-key-management",{body:{action:"set",project_id:projectId,provider,api_key:key}});if(error)setError(await functionErrorMessage(error));else{setKeys(v=>({...v,[provider]:""}));setMessage(provider+" API key updated. Only the last four characters are shown.");await load()}setBusy(false)}
 async function removeKey(provider:string){if(!confirm("Remove this API key configuration?"))return;setBusy(true);setMessage("");setError("");const {error}=await supabase.functions.invoke("llm-key-management",{body:{action:"remove",project_id:projectId,provider}});if(error)setError(await functionErrorMessage(error));else{setMessage("API key removed.");await load()}setBusy(false)}
 async function savePreferences(){setBusy(true);setMessage("");setError("");const {data:{user}}=await supabase.auth.getUser();if(!user){setError("Please sign in again to save your preferences.");setBusy(false);return;}const {error}=await supabase.rpc("save_my_ui_preferences",{p_preferences:preferences});if(error)setError(error.message);else setMessage("Platform preferences saved.");setBusy(false);}
 async function saveAccount(){setAccountSaving(true);setAccountError("");setAccountMessage("");const {data:{user},error:userError}=await supabase.auth.getUser();if(userError||!user){setAccountError(userError?.message||"Unable to load your account.");setAccountSaving(false);return;}const name=accountName.trim(),email=accountEmail.trim().toLowerCase();if(!name){setAccountError("Name is required.");setAccountSaving(false);return;}if(!email.includes("@")){setAccountError("Enter a valid email address.");setAccountSaving(false);return;}if(password&&password.length<8){setAccountError("Password must be at least 8 characters.");setAccountSaving(false);return;}if(password&&password!==confirmPassword){setAccountError("Passwords do not match.");setAccountSaving(false);return;}const emailChanged=email!==(user.email||"").toLowerCase();const authUpdate:{email?:string;password?:string;data:Record<string,string>}={data:{display_name:name,full_name:name}};if(emailChanged)authUpdate.email=email;if(password)authUpdate.password=password;const {error:authError}=await supabase.auth.updateUser(authUpdate);if(authError){setAccountError(authError.message);setAccountSaving(false);return;}const {error:profileError}=await supabase.from("profiles").upsert({id:user.id,display_name:name,full_name:name},{onConflict:"id"});if(profileError){setAccountError(profileError.message);setAccountSaving(false);return;}setPassword("");setConfirmPassword("");setAccountMessage(emailChanged?"Account details saved. Check your email to confirm the new email address.":"Account details saved.");setAccountSaving(false);}
 async function logOut(){setLoggingOut(true);setLogoutError("");const {error}=await supabase.auth.signOut();if(error){setLogoutError(error.message);setLoggingOut(false);return;}router.push("/login");}
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
            <div><h2 className="text-xl font-semibold">Project Settings</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Client information and branding for this project.</p></div>
          </div>
          <div className="platform-card overflow-hidden">
            <div className="platform-card-header"><div className="flex items-start gap-3"><div className="platform-icon"><Settings2 size={17}/></div><div><h3 className="text-lg font-semibold">Project Details &amp; Branding</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">Keep the client identity and visual branding together in one compact workspace.</p></div></div></div>
            <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-2">
              <div className="space-y-5">
                <label className="block text-sm font-semibold">Client Company Name<input disabled={!canEdit} value={brand.brand_name} onChange={e=>setBrand({...brand,brand_name:e.target.value})} className="mt-2 w-full platform-input disabled:bg-[var(--paper)]"/></label>
                <label className="block text-sm font-semibold">Client Company Summary <span className="font-normal text-[var(--muted-foreground)]">(optional)</span><span className="mt-1 block text-xs font-normal text-[var(--muted-foreground)]">Describe the client and the services relevant to this workspace.</span><textarea disabled={!canEdit} rows={4} value={brand.brand_description} onChange={e=>setBrand({...brand,brand_description:e.target.value})} className="mt-2 w-full resize-y platform-input disabled:bg-[var(--paper)]"/></label>
                {canEdit&&<button disabled={busy} onClick={()=>void saveProjectDetails()} className="inline-flex items-center gap-2 platform-btn platform-btn-primary disabled:opacity-50"><Check size={15}/>Save Project Details</button>}
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--soft)] p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Client Company Logo</h3><p className="mt-1 text-xs text-[var(--muted-foreground)]">Shown across this project.</p></div><ImageIcon size={18} className="shrink-0 text-[var(--green)]"/></div>
                <div className="mt-4 flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--green)] bg-[var(--paper)] p-5 text-center">
                  {brand.brand_logo_url?<img src={brand.brand_logo_url} alt="Client company logo preview" onError={()=>setLogoPreviewError("The saved logo preview could not be loaded.")} onLoad={()=>setLogoPreviewError("")} className="max-h-20 max-w-full object-contain"/>:<Upload size={24} className="text-[var(--muted-foreground)]"/>}
                  <p className="mt-2 text-sm font-medium">{brand.brand_logo_url?"Logo uploaded":"Upload Logo"}</p>
                  <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">PNG, JPG, WEBP, GIF, SVG or AVIF · Max 5 MB</p>
                  {logoPreviewError&&<p className="mt-2 text-xs text-red-600">{logoPreviewError}</p>}
                  {canEdit&&<label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-xs font-semibold hover:bg-[var(--soft)]"><Upload size={14}/>{logoUploading?"Uploading…":brand.brand_logo_url?"Replace Logo":"Choose Logo"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif" disabled={logoUploading||busy} onChange={e=>{const file=e.target.files?.[0];void uploadLogo(file);e.currentTarget.value="";}} className="sr-only"/></label>}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">{canEdit&&<button disabled={busy||logoUploading} onClick={()=>void saveBranding()} className="inline-flex items-center gap-2 platform-btn platform-btn-primary disabled:opacity-50"><Check size={15}/>Save Branding</button>}{canEdit&&brand.brand_logo_url&&<button disabled={busy||logoUploading} onClick={()=>void removeLogo()} className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"><X size={14}/>Remove Logo</button>}</div>
              </div>
            </div>
            <div className="border-t border-[var(--line)] p-5 sm:p-6">
              <div className="mb-4"><h3 className="text-sm font-semibold">AI Visibility Configuration</h3><p className="mt-1 text-xs text-[var(--muted-foreground)]">Manage the domains, brand mentions and topics used to track visibility.</p></div>
              <div className="grid gap-5 lg:grid-cols-2">
                <label className="block text-sm font-semibold">Brand domains <span className="font-normal text-[var(--muted-foreground)]">(one per line)</span><textarea disabled={!canEdit} rows={4} value={brand.brand_domains} onChange={e=>setBrand({...brand,brand_domains:e.target.value})} className="mt-2 w-full platform-input disabled:bg-[var(--paper)]"/></label>
                <label className="block text-sm font-semibold">Brand mention terms <span className="font-normal text-[var(--muted-foreground)]">(one per line)</span><textarea disabled={!canEdit} rows={4} value={brand.brand_terms} onChange={e=>setBrand({...brand,brand_terms:e.target.value})} className="mt-2 w-full platform-input disabled:bg-[var(--paper)]"/></label>
              </div>
              <div className="mt-5"><div className="text-sm font-semibold">Topics</div><div className="mt-2 flex flex-wrap gap-2">{topics.map(t=><span key={t} className="inline-flex items-center gap-1 rounded-full bg-[var(--soft)] px-3 py-1.5 text-xs font-semibold text-[var(--green)]">{t}{canEdit&&<button aria-label={t} onClick={()=>setTopics(v=>v.filter(x=>x!==t))}>×</button>}</span>)}</div>{canEdit&&<div className="mt-3 flex gap-2"><input value={newTopic} onChange={e=>setNewTopic(e.target.value)} placeholder="Add topic" className="platform-input text-sm"/><button onClick={()=>{if(newTopic.trim()&&!topics.includes(newTopic.trim())){setTopics([...topics,newTopic.trim()]);setNewTopic("")}}} className="inline-flex items-center gap-2 platform-btn text-sm font-semibold"><Plus size={15}/>Add</button></div>}</div>
              {canEdit&&<button disabled={busy} onClick={()=>void saveBrand()} className="mt-5 inline-flex items-center gap-2 platform-btn platform-btn-primary disabled:opacity-50"><Save size={16}/>Save Visibility Configuration</button>}
              {message&&<p className="mt-3 text-xs text-[var(--muted-foreground)]">{message}</p>}{error&&<p className="mt-3 text-xs text-red-600">{error}</p>}
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end gap-3 border-b border-[var(--line)] pb-3">
            <div className="platform-icon"><Settings2 size={17}/></div>
            <div><h2 className="text-xl font-semibold">Tracking Market</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Choose the market whose AI search results should be measured for this brand.</p></div>
          </div>
          <div className="platform-card p-5 sm:p-6">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="block text-sm font-semibold">AI visibility market
                <select disabled={!canEdit} value={trackingMarket} onChange={e=>setTrackingMarket(e.target.value)} className="mt-2 w-full platform-input disabled:bg-[var(--paper)]">
                  {marketOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <span className="mt-2 block text-xs font-normal text-[var(--muted-foreground)]">Country markets use that country as the search location. Global leaves the search location unspecified and does not substitute a country.</span>
              </label>
              {canEdit&&<button disabled={busy} onClick={()=>void saveTrackingMarket()} className="inline-flex items-center justify-center gap-2 platform-btn platform-btn-primary disabled:opacity-50"><Save size={15}/>Save Tracking Market</button>}
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
          <div className="mb-4 flex items-end gap-3 border-b border-[var(--line)] pb-3"><div className="platform-icon"><UserRound size={17}/></div><div><h2 className="text-xl font-semibold">Account Settings</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Your personal account details and sign-in credentials.</p></div></div>
          <div className="platform-card overflow-hidden">
            <div className="platform-card-header"><div className="flex items-start gap-3"><div className="platform-icon"><UserRound size={17}/></div><div><h3 className="text-lg font-semibold">Account</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">Update your name, email address and password.</p></div></div></div>
            <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-2">
              <div><label className="text-sm font-semibold" htmlFor="account-name">Name</label><p className="mt-1 text-xs text-[var(--muted-foreground)]">The name shown across your workspace.</p><input id="account-name" value={accountName} onChange={e=>setAccountName(e.target.value)} disabled={accountSaving} className="mt-2 w-full platform-input" placeholder="Your Name"/></div>
              <div><label className="text-sm font-semibold" htmlFor="account-email">Email</label><p className="mt-1 text-xs text-[var(--muted-foreground)]">Changing your email may require confirmation.</p><div className="relative mt-2"><Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"/><input id="account-email" type="email" value={accountEmail} onChange={e=>setAccountEmail(e.target.value)} disabled={accountSaving} className="w-full platform-input pl-10" placeholder="you@company.com"/></div></div>
              <div><label className="text-sm font-semibold" htmlFor="account-password">New Password</label><p className="mt-1 text-xs text-[var(--muted-foreground)]">Leave blank to keep your current password. Minimum 8 characters.</p><input id="account-password" type="password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} disabled={accountSaving} className="mt-2 w-full platform-input" placeholder="New Password"/></div>
              <div><label className="text-sm font-semibold" htmlFor="account-password-confirm">Confirm New Password</label><p className="mt-1 text-xs text-[var(--muted-foreground)]">Re-enter the new password when changing it.</p><input id="account-password-confirm" type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} disabled={accountSaving} className="mt-2 w-full platform-input" placeholder="Confirm New Password"/></div>
              <div className="flex flex-wrap items-center gap-3 lg:col-span-2"><button type="button" onClick={()=>void saveAccount()} disabled={accountSaving} className="inline-flex items-center gap-2 platform-btn platform-btn-primary"><Check size={15}/>{accountSaving?"Saving…":"Save Account Details"}</button>{accountMessage&&<span className="text-xs text-[var(--muted-foreground)]">{accountMessage}</span>}{accountError&&<span className="text-xs text-red-600">{accountError}</span>}</div>
            </div>
          </div>
        </section>
        <section>
          <div className="mb-4 flex items-end gap-3 border-b border-[var(--line)] pb-3"><div className="platform-icon"><LogOut size={17}/></div><div><h2 className="text-xl font-semibold">Log Out</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Sign out of this account on the current device.</p></div></div>
          <div className="platform-card"><div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6"><div><p className="text-sm font-semibold">Log Out</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">You can sign in again from the login page.</p></div><button type="button" onClick={()=>void logOut()} disabled={loggingOut} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold hover:bg-[var(--soft)] disabled:opacity-50"><LogOut size={15}/>{loggingOut?"Logging Out…":"Log Out"}</button>{logoutError&&<p className="w-full text-xs text-red-600">{logoutError}</p>}</div></div>
        </section>
      </div>
    </div>
  </ProjectShell>
 );
}
