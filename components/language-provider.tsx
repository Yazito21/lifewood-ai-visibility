"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type PlatformLanguage = "en" | "zh";
type LanguageContextValue = { language: PlatformLanguage; setLanguage: (language: PlatformLanguage) => void };
const LanguageContext = createContext<LanguageContextValue | null>(null);
const STORAGE_KEY = "lifewood-platform-language";

// UI-only translations. Brand names, user-entered content, prompts, URLs and tracking data are deliberately untouched.
const zh: Record<string, string> = {
  "Dashboard":"仪表板","Analytics":"分析","Citations":"引用","Leaderboards":"排行榜","Prompts":"提示词","Responses":"回答","Samples":"样本","Reports":"报告","Settings":"设置","Accounts":"账户",
  "All projects":"所有项目","Project workspace":"项目工作区","AI Visibility Intelligence Platform":"AI 可见度智能平台","AI Visibility Project Platform":"AI 可见度项目平台","Cross-project workspace":"跨项目工作区","Project navigation":"项目导航",
  "Back to projects":"返回项目列表","Home":"首页","Workspace":"工作区","Workspaces":"工作区","Projects":"项目","New project":"新建项目","Create project":"创建项目","Open workspace":"打开工作区","Open project":"打开项目",
  "Welcome back. This page lists every brand project you can open. Pick a project card to jump into its dashboard, analytics, citations, leaderboards and more. If you manage projects, you can also create a new one from here.":"欢迎回来。此页面列出您可以访问的所有品牌项目。选择项目卡片即可进入其仪表板、分析、引用、排行榜等页面。如果您负责管理项目，也可以在此创建新项目。",
  "Loading workspaces…":"正在加载工作区…","No projects available":"暂无可用项目","Create the first brand project to begin tracking AI visibility.":"创建第一个品牌项目以开始追踪 AI 可见度。","No projects have been assigned to your account yet.":"您的账户尚未分配任何项目。","Select a project to open its AI visibility workspace.":"选择一个项目以打开其 AI 可见度工作区。",
  "Brand Projects":"品牌项目","Tracked Projects":"已追踪项目","Accessible workspaces":"可访问的工作区","With daily visibility data":"包含每日可见度数据","Execution-ready engines":"可执行引擎","ChatGPT runner available; additional engines are planned":"ChatGPT 执行器已启用；其他引擎正在规划中","Prompt Limit":"提示词上限","Per project, at least 5 per category":"每个项目最多 50 条，每个类别至少 5 条",
  "Tracked":"已追踪","Active":"活跃","All":"全部","Overall":"总体","Previous":"上一个","Next":"下一个","Search":"搜索","Search…":"搜索…","Filter":"筛选","Filters":"筛选条件","Clear":"清除","Clear all":"全部清除","Apply":"应用","Cancel":"取消","Save":"保存","Save changes":"保存更改","Edit":"编辑","Delete":"删除","Remove":"移除","Add":"添加","Update":"更新","Close":"关闭","Confirm":"确认","Back":"返回","Refresh":"刷新","Export":"导出","Download":"下载","Upload":"上传","Import":"导入","View":"查看","View all":"查看全部","Open":"打开","Actions":"操作","Status":"状态","Date":"日期","Category":"类别","Categories":"类别","Brand":"品牌","Competitor":"竞争对手","Name":"名称","Description":"描述","Website":"网站","URL":"网址","Type":"类型","Role":"角色","Email":"电子邮件","Password":"密码","Optional":"可选","Required":"必填",
  "Rank":"排名","Score":"得分","Visibility":"可见度","Visibility Score":"可见度得分","Visibility Rank":"可见度排名","Share of Voice":"声量份额","Average Position":"平均位置","Sources":"来源","Competitors":"竞争对手","Tracked brands":"已追踪品牌","Tracking date":"追踪日期","Tracking period":"追踪周期","Last 7 Days":"最近 7 天","Last 14 Days":"最近 14 天","Last 30 Days":"最近 30 天","Last 90 Days":"最近 90 天","Custom":"自定义","From":"开始日期","To":"结束日期","No change":"无变化","Previous rank":"上一次排名","Previous score":"上一次得分",
  "Project Settings":"项目设置","Client information and branding for this project.":"此项目的客户信息与品牌资料。","Project Details & Branding":"项目详情与品牌形象","Keep the client identity and visual branding together in one compact workspace.":"在同一工作区中集中管理客户身份与视觉品牌资料。","Client Company Name":"客户公司名称","Client Company Summary":"客户公司简介","Describe the client and the services relevant to this workspace.":"描述客户及与此工作区相关的服务。","Tracked brand name":"追踪品牌名称","Tracked brand primary website":"追踪品牌主网站","Company summary":"公司简介","Tracking categories":"追踪类别","Competitor registry workbook":"竞争对手名录工作簿","Download Excel template":"下载 Excel 模板","Upload completed workbook":"上传已填写的工作簿","Create the project":"创建项目",
  "Run":"运行","Run tracking":"运行追踪","Run category":"运行类别","Select categories to run":"选择要运行的类别","Select all":"全选","Run selected":"运行所选项目","Tracking":"追踪中","Tracking completed successfully":"追踪已成功完成","Loading…":"加载中…","Saving…":"保存中…","Creating…":"创建中…","Deleting…":"删除中…","Processing…":"处理中…","No data available":"暂无数据","No results found":"未找到结果","No data for this period":"此时间段暂无数据","Select a date range":"选择日期范围","Start date":"开始日期","End date":"结束日期",
  "Login":"登录","Log in":"登录","Log out":"退出登录","Sign out":"退出登录","Forgot password?":"忘记密码？","Reset password":"重置密码","Welcome":"欢迎","Welcome back":"欢迎回来","Continue":"继续","Submit":"提交",
  "Current standing":"当前情况","Review action items":"检查行动事项","Other updates":"其他更新","Closing":"结束","Daily operations and updates":"日常运营与更新","Monthly Report":"月度报告","Simple Report":"简易报告","Introductory Report":"介绍报告","Technical Audit Report":"技术审计报告","Competitor Comparison Report":"竞争对手对比报告",
  "This project is not available to your account.":"您的账户无法访问此项目。","Your account profile could not be loaded.":"无法加载您的账户资料。","Select at least one category to run tracking.":"请至少选择一个类别以运行追踪。",
  "Project Details":"项目详情","General":"常规","Branding":"品牌形象","Team":"团队","Members":"成员","Access":"访问权限","Limited Access":"有限访问权限","Full Access":"完整访问权限","Superadmin":"超级管理员","Admin":"管理员","Viewer":"查看者",
  "Prompt Library":"提示词库","Add prompt":"添加提示词","Delete selected":"删除所选项目","Select all prompts":"选择所有提示词","Prompt":"提示词","AI Provider":"AI 服务提供商","Model":"模型","Response":"回答","Tracking location":"追踪地区","Market":"市场","Country":"国家","Language":"语言",
  "Visibility over time":"可见度变化趋势","Daily Visibility Score":"每日可见度得分","Daily Visibility Rank":"每日可见度排名","Overall Daily Visibility Rank":"总体每日可见度排名","Shows how often your brand appeared in AI answers. Higher is better.":"显示您的品牌在 AI 回答中出现的频率。数值越高越好。","Rank 1 is the best.":"排名第 1 为最佳。",
  "English":"英语","Chinese":"中文",
  "AI Search Intelligence":"AI 搜索智能分析","AEO/GEO Tracking":"AEO/GEO 追踪平台","Sign in to access your AI visibility projects and tracking workspace.":"登录以访问您的 AI 可见度项目和追踪工作区。","Forgot your password?":"忘记密码？","Show password":"显示密码","Hide password":"隐藏密码","Send reset link":"发送重置链接","Sending…":"正在发送…","Reset your password":"重置密码","Enter your registered email. Password recovery is handled by Supabase Auth.":"请输入您注册时使用的电子邮件。密码恢复由 Supabase Auth 处理。","Back to sign in":"返回登录","If the account exists, a password reset email has been sent.":"如果该账户存在，密码重置邮件已发送。",
  "Project":"项目","Overview":"概览","Summary":"摘要","Details":"详情","Performance":"表现","Daily":"每日","Weekly":"每周","Monthly":"每月","Yearly":"每年","Today":"今天","Yesterday":"昨天","This week":"本周","This month":"本月","Last 7 days":"最近 7 天","Last 30 days":"最近 30 天","Last 90 days":"最近 90 天","Date range":"日期范围","Start":"开始","End":"结束","Period":"周期","Compare":"比较","Comparison":"对比","Trend":"趋势","History":"历史记录","Ranking":"排名","Position":"位置","Population":"样本总数","Rank population":"排名样本总数","Total":"总计","Average":"平均值","Count":"数量","Percentage":"百分比","Change":"变化","Previous period":"上一周期","Current period":"当前周期",
  "Visibility rank":"可见度排名","Visibility score":"可见度得分","Daily visibility":"每日可见度","Share of voice":"声量份额","Average position":"平均位置","Citation count":"引用数量","Citation sources":"引用来源","Top citations":"热门引用","Top competitors":"主要竞争对手","Brand visibility":"品牌可见度","Competitor visibility":"竞争对手可见度","Tracked competitors":"已追踪竞争对手","Brand name":"品牌名称","Brand domain":"品牌域名","Brand aliases":"品牌别名","Primary website":"主要网站","Tracking market":"追踪市场",
  "Prompt text":"提示词内容","Prompt category":"提示词类别","Add new prompt":"添加新提示词","Edit prompt":"编辑提示词","Delete prompt":"删除提示词","Bulk delete":"批量删除","Selected":"已选择","Selected items":"已选项目","No prompts found":"未找到提示词","AI responses":"AI 回答","Raw response":"原始回答","Response details":"回答详情","Cited pages":"引用页面","Source URL":"来源网址","Page title":"页面标题","Search engine":"搜索引擎","AI model":"AI 模型","Provider":"服务提供商","Run status":"运行状态","Run date":"运行日期","Started at":"开始时间","Completed at":"完成时间","Duration":"耗时","Success":"成功","Failed":"失败","Pending":"待处理","Running":"运行中","Completed":"已完成","Partial":"部分完成","Cancelled":"已取消",
  "Create a new project":"创建新项目","Project name":"项目名称","Project description":"项目描述","Client company":"客户公司","Company name":"公司名称","Company website":"公司网站","Company description":"公司描述","Save project":"保存项目","Delete project":"删除项目","Delete project?":"删除项目？","This permanently removes the project data.":"此操作将永久删除项目数据。","Type the project name":"输入项目名称","Are you sure?":"确定吗？","Changes saved successfully.":"更改已成功保存。","Unable to save changes.":"无法保存更改。","No changes to save.":"没有需要保存的更改。",
  "User management":"用户管理","Manage accounts":"管理账户","Add user":"添加用户","Create user":"创建用户","Invite user":"邀请用户","User":"用户","Users":"用户","Account":"账户","Access level":"访问级别","Permissions":"权限","Full access":"完整访问权限","Limited access":"有限访问权限","Super administrator":"超级管理员","Administrator":"管理员","Read only":"只读","Active users":"活跃用户","Pending invitation":"待接受邀请",
  "Report type":"报告类型","Generate report":"生成报告","Generate":"生成","Monthly report":"月度报告","Simple report":"简易报告","Introductory report":"介绍报告","Technical audit report":"技术审计报告","Competitor comparison report":"竞争对手对比报告","Report period":"报告周期","Report preview":"报告预览","Download report":"下载报告","Export to Excel":"导出为 Excel","Export to PowerPoint":"导出为 PowerPoint","No reports available":"暂无报告",
  "Loading dashboard…":"正在加载仪表板…","Loading analytics…":"正在加载分析数据…","Loading citations…":"正在加载引用数据…","Loading competitors…":"正在加载竞争对手数据…","Loading prompts…":"正在加载提示词…","Loading reports…":"正在加载报告…","Loading settings…":"正在加载设置…","Unable to load data.":"无法加载数据。","Something went wrong.":"发生错误。","Please try again.":"请重试。","Try again":"重试","No data found":"未找到数据","No matching records":"没有匹配的记录","Showing":"正在显示","of":"共","items":"项","rows":"行","per page":"每页","Page":"页","Previous page":"上一页","Next page":"下一页",
  "All Time":"所有时间","No data":"暂无数据","All Cited Pages":"所有引用页面","All categories":"所有类别","Show first 10":"显示前 10 条","Show all":"显示全部","Research source":"研究来源","Competitor coverage:":"竞争对手覆盖率：","Search website or source type…":"搜索网站或来源类型…","Search prompts…":"搜索提示词…","Search prompts":"搜索提示词","Filter prompts by category":"按类别筛选提示词","Select all filtered prompts":"全选筛选后的提示词","Visibility Score (%)":"可见度得分（%）","Prompt Results":"提示词结果","Page Title":"页面标题","Research Source Title":"研究来源标题","Search results…":"搜索结果…","Search prompt-level results":"搜索提示词结果","Search cited pages…":"搜索引用页面…","Search cited pages":"搜索引用页面","Week 1":"第 1 周","Week 2":"第 2 周","Week 3":"第 3 周","Week 4":"第 4 周","Executive Summary":"执行摘要","Draft saved successfully.":"草稿已成功保存。","Social media":"社交媒体","Describe work completed":"描述已完成的工作","Remove progress item":"移除此进度项目","Preview up to date":"预览已是最新版本","Fixed competitor registry saved.":"竞争对手名录已成功保存。","Logo file must be 5 MB or smaller.":"Logo 文件大小必须为 5 MB 或更小。","Logo upload failed:":"Logo 上传失败：","API key removed.":"API 密钥已移除。","Name is required.":"名称为必填项。","Logo uploaded":"Logo 已上传","Upload Logo":"上传 Logo","Replace Logo":"替换 Logo","Choose Logo":"选择 Logo","Add category":"添加类别","Import Excel registry":"导入 Excel 名录","Paste API key":"粘贴 API 密钥","Log Out":"退出登录","Competitor coverage":"竞争对手覆盖率","Visibility trend":"可见度趋势","Daily Visibility":"每日可见度","Overall Visibility":"总体可见度","Rank trend":"排名趋势","Score trend":"得分趋势","Source type":"来源类型","Search brands…":"搜索品牌…","Search competitors…":"搜索竞争对手…","Search responses…":"搜索回答…","Search samples…":"搜索样本…","Search citations…":"搜索引用…","Select category":"选择类别","Select provider":"选择服务提供商","Select period":"选择周期","No citations found":"未找到引用","No competitors found":"未找到竞争对手","No responses found":"未找到回答","No samples found":"未找到样本","No prompts available":"暂无提示词","No categories available":"暂无类别","No competitors added yet":"尚未添加竞争对手","Add competitor":"添加竞争对手","Add brand":"添加品牌","Save registry":"保存名录","Import registry":"导入名录","Competitor registry":"竞争对手名录","Brand registry":"品牌名录","API Keys":"API 密钥","API key":"API 密钥","Remove API key":"移除 API 密钥","Test connection":"测试连接","Connection successful":"连接成功","Connection failed":"连接失败","Upload failed":"上传失败","Upload successful":"上传成功","Last updated":"最后更新","Created at":"创建时间","Updated at":"更新时间","No records found":"未找到记录","Select all categories":"选择所有类别","Run selected categories":"运行所选类别","Category completed":"类别已完成","Tracking completed":"追踪已完成","Tracking failed":"追踪失败","Resume tracking":"继续追踪","Retry failed":"重试失败项目","Start tracking":"开始追踪","Stop tracking":"停止追踪","Tracking history":"追踪历史","Run history":"运行历史","View details":"查看详情","Hide details":"隐藏详情","Expand":"展开","Collapse":"收起",  "Choose language":"选择语言","Switch to Chinese":"切换为中文","Switch to English":"切换为英语","简体中文":"简体中文"
};
const originalText = new WeakMap<Text, { original: string; translated: string }>();
const originalAttributes = new WeakMap<Element, Map<string, { original: string; translated: string }>>();

function translateDocument(language: PlatformLanguage) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script,style,noscript,textarea,code,pre,[data-no-translate]")) continue;
    const current = node.nodeValue ?? "";
    const record = originalText.get(node);
    if (language === "en") {
      if (record && current === record.translated) node.nodeValue = record.original;
      else if (record && current !== record.translated) originalText.delete(node);
      continue;
    }
    const original = record && current === record.translated ? record.original : current;
    const key = original.trim();
    const translated = zh[key] ? original.replace(key, zh[key]) : original;
    if (translated !== original) {
      originalText.set(node, { original, translated });
      if (current !== translated) node.nodeValue = translated;
    } else if (record) originalText.delete(node);
  }
  const attributes = ["placeholder", "title", "aria-label", "aria-description"];
  document.querySelectorAll<HTMLElement>("body *").forEach((element) => {
    if (element.closest("[data-no-translate]")) return;
    for (const attribute of attributes) {
      const current = element.getAttribute(attribute);
      if (!current) continue;
      const records = originalAttributes.get(element) ?? new Map<string, { original: string; translated: string }>();
      const record = records.get(attribute);
      if (language === "en") {
        if (record && current === record.translated) element.setAttribute(attribute, record.original);
        else if (record && current !== record.translated) records.delete(attribute);
        continue;
      }
      const original = record && current === record.translated ? record.original : current;
      const key = original.trim();
      const translated = zh[key] ? original.replace(key, zh[key]) : original;
      if (translated !== original) {
        records.set(attribute, { original, translated });
        originalAttributes.set(element, records);
        if (current !== translated) element.setAttribute(attribute, translated);
      }
    }
  });
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<PlatformLanguage>("en");
  const setLanguage = (next: PlatformLanguage) => {
    setLanguageState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* storage may be unavailable */ }
  };

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "zh") setLanguageState(stored);
    } catch { /* default to English */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    const apply = () => translateDocument(language);
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "title", "aria-label", "aria-description"] });
    return () => observer.disconnect();
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function usePlatformLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("usePlatformLanguage must be used within LanguageProvider");
  return value;
}

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage } = usePlatformLanguage();
  return (
    <button
      type="button"
      onClick={() => setLanguage(language === "en" ? "zh" : "en")}
      className={compact
        ? "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
        : "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"}
      aria-label={language === "en" ? "切换到中文" : "Switch to English"}
      title={language === "en" ? "Switch language to Chinese" : "将语言切换为英语"}
      data-no-translate="true"
    >
      <span aria-hidden="true">文</span>
      {language === "en" ? "中文" : "English"}
    </button>
  );
}
