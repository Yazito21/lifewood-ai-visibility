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
  "Rank":"排名","Score":"得分","Visibility":"可见度","Visibility Score":"可见度得分","Visibility Rank":"可见度排名","Share of Voice":"声量份额","Average Position":"平均位置","Citations":"引用","Sources":"来源","Competitors":"竞争对手","Tracked brands":"已追踪品牌","Tracking date":"追踪日期","Tracking period":"追踪周期","Last 7 Days":"最近 7 天","Last 14 Days":"最近 14 天","Last 30 Days":"最近 30 天","Last 90 Days":"最近 90 天","Custom":"自定义","From":"开始日期","To":"结束日期","No change":"无变化","Previous rank":"上一次排名","Previous score":"上一次得分",
  "Project Settings":"项目设置","Client information and branding for this project.":"此项目的客户信息与品牌资料。","Project Details & Branding":"项目详情与品牌形象","Keep the client identity and visual branding together in one compact workspace.":"在同一工作区中集中管理客户身份与视觉品牌资料。","Client Company Name":"客户公司名称","Client Company Summary":"客户公司简介","Describe the client and the services relevant to this workspace.":"描述客户及与此工作区相关的服务。","Tracked brand name":"追踪品牌名称","Tracked brand primary website":"追踪品牌主网站","Company summary":"公司简介","Tracking categories":"追踪类别","Competitor registry workbook":"竞争对手名录工作簿","Download Excel template":"下载 Excel 模板","Upload completed workbook":"上传已填写的工作簿","Create the project":"创建项目",
  "Run":"运行","Run tracking":"运行追踪","Run category":"运行类别","Select categories to run":"选择要运行的类别","Select all":"全选","Run selected":"运行所选项目","Tracking":"追踪中","Tracking completed successfully":"追踪已成功完成","Loading…":"加载中…","Saving…":"保存中…","Creating…":"创建中…","Deleting…":"删除中…","Processing…":"处理中…","No data available":"暂无数据","No results found":"未找到结果","No data for this period":"此时间段暂无数据","Select a date range":"选择日期范围","Start date":"开始日期","End date":"结束日期",
  "Login":"登录","Log in":"登录","Log out":"退出登录","Sign out":"退出登录","Forgot password?":"忘记密码？","Reset password":"重置密码","Welcome":"欢迎","Welcome back":"欢迎回来","Continue":"继续","Submit":"提交",
  "Current standing":"当前情况","Review action items":"检查行动事项","Other updates":"其他更新","Closing":"结束","Daily operations and updates":"日常运营与更新","Monthly Report":"月度报告","Simple Report":"简易报告","Introductory Report":"介绍报告","Technical Audit Report":"技术审计报告","Competitor Comparison Report":"竞争对手对比报告",
  "This project is not available to your account.":"您的账户无法访问此项目。","Your account profile could not be loaded.":"无法加载您的账户资料。","Select at least one category to run tracking.":"请至少选择一个类别以运行追踪。","No projects have been assigned to your account yet.":"您的账户目前尚未分配项目。",
  "Project Details":"项目详情","General":"常规","Branding":"品牌形象","Team":"团队","Members":"成员","Access":"访问权限","Limited Access":"有限访问权限","Full Access":"完整访问权限","Superadmin":"超级管理员","Admin":"管理员","Viewer":"查看者",
  "Prompt Library":"提示词库","Add prompt":"添加提示词","Delete selected":"删除所选项目","Select all prompts":"选择所有提示词","Prompt":"提示词","AI Provider":"AI 服务提供商","Model":"模型","Response":"回答","Tracking location":"追踪地区","Market":"市场","Country":"国家","Language":"语言",
  "Visibility over time":"可见度变化趋势","Daily Visibility Score":"每日可见度得分","Daily Visibility Rank":"每日可见度排名","Overall Daily Visibility Rank":"总体每日可见度排名","Shows how often your brand appeared in AI answers. Higher is better.":"显示您的品牌在 AI 回答中出现的频率。数值越高越好。","Rank 1 is the best.":"排名第 1 为最佳。",
  "English":"英语","Chinese":"中文","Language":"语言"
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
