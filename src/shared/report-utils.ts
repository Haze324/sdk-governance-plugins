/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                    公共模块 — GitHub Issue 管理 + 报告页面生成                  ║
║                                                                              ║
║     功能：两个插件共用的 GitHub API 操作和报告页面生成逻辑                        ║
║                                                                              ║
║       · createIssue — 创建 Issue，打标签                                      ║
║       · commentOnIssue — 在 Issue 下评论（指令触发回复）                        ║
║       · closePreviousIssue — 关闭上次还开着的同类型 Issue                       ║
║       · closeIssueIfNoProblems — 无问题时关闭旧的 Issue                        ║
║       · buildPagesReport — 生成 HTML 报告页面，部署到 GitHub Pages             ║
║                                                                              ║
║     输出规则（V3.0）：                                                          ║
║       · Action Summary — 每次都有                                              ║
║       · Report Page    — 每次都有                                              ║
║       · Issue          — 只在有兼容性问题或安全漏洞时创建                         ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============================================================
//  鉴权方法：优先用 GITHUB_TOKEN env var 调 REST API
//  ts-node 运行的 Node.js 20+ 内置 fetch，不需要额外依赖
// ============================================================
function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { 'Accept': 'application/vnd.github.v3+json' };
  return {
    'Authorization': `token ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github.v3+json',
  };
}

function repoName(): string {
  return process.env.REPO_NAME || process.env.GITHUB_REPOSITORY || '';
}

// ============================================================
//  [对外接口] createIssue — 在 GitHub 仓库创建 Issue
// ============================================================
export async function createIssue(
  title: string,
  body: string,
  labels: string[]
): Promise<string> {
  const repo = repoName();
  if (!repo) { console.warn('[Issue] 缺少 REPO_NAME，跳过'); return ''; }

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ title, body, labels }),
    });
    const data = await res.json() as { html_url?: string; message?: string };
    if (res.ok && data.html_url) {
      console.log(`[Issue] 创建成功: ${data.html_url}`);
      return data.html_url;
    }
    console.error(`[Issue] 创建失败 (${res.status}): ${data.message || JSON.stringify(data)}`);
    return '';
  } catch (err: any) {
    console.error('[Issue] 创建异常:', err.message);
    return '';
  }
}

// ============================================================
//  [对外接口] commentOnIssue — 在指定 Issue 下评论
// ============================================================
export async function commentOnIssue(issueUrl: string, commentBody: string): Promise<void> {
  if (!issueUrl) return;
  const repo = repoName();
  if (!repo) return;
  const m = issueUrl.match(/github\.com\/(.+?)\/(.+?)\/issues\/(\d+)/);
  if (!m) { console.warn('[Issue] 无法解析 URL:', issueUrl); return; }
  const issueNum = m[3];

  try {
    await fetch(`https://api.github.com/repos/${repo}/issues/${issueNum}/comments`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ body: commentBody }),
    });
    console.log(`[Issue] 已在 #${issueNum} 回复`);
  } catch (err: any) {
    console.error('[Issue] 评论异常:', err.message);
  }
}

// ============================================================
//  [对外接口] closePreviousIssue — 关闭上次同类型还开着的 Issue
// ============================================================
export async function closePreviousIssue(issuePrefix: string, label?: string): Promise<void> {
  const repo = repoName();
  if (!repo) return;
  const labelFilter = label || (issuePrefix === '三方库完整性' ? 'sdk-completeness' : 'sdk-update');
  await closeIssuesByLabel(repo, labelFilter, issuePrefix);

  // 同时清理 V1 旧标签
  const legacyLabel = issuePrefix === '三方库更新' ? 'sdk-inspect' : 'sdk-consistency';
  await closeIssuesByLabel(repo, legacyLabel, issuePrefix, /* isLegacy */ true);
}

// ============================================================
//  [对外接口] closeIssueIfNoProblems — 无问题时关闭旧 Issue
// ============================================================
export async function closeIssueIfNoProblems(
  issuePrefix: string,
  label: string,
  hasCompatibilityIssue: boolean,
  hasSecurityVulnerability: boolean
): Promise<void> {
  if (hasCompatibilityIssue || hasSecurityVulnerability) return; // 有问题时不关

  console.log('[Issue] 未发现问题，检查旧 Issue...');
  const repo = repoName();
  if (!repo) return;

  await closeIssuesByLabel(repo, label, issuePrefix, /* isLegacy */ false, /* addComment */ true);

  // 同时清理 V1 旧标签
  const legacyLabel = issuePrefix === '三方库更新' ? 'sdk-inspect' : 'sdk-consistency';
  await closeIssuesByLabel(repo, legacyLabel, issuePrefix, /* isLegacy */ true);
}

// ============================================================
//  [内部] closeIssuesByLabel — 按标签关闭匹配前缀的 Issue
// ============================================================
async function closeIssuesByLabel(
  repo: string,
  label: string,
  prefix: string,
  isLegacy = false,
  addComment = false
): Promise<void> {
  try {
    const listRes = await fetch(
      `https://api.github.com/repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`,
      { headers: authHeaders() }
    );
    if (!listRes.ok) {
      const txt = await listRes.text();
      console.error(`[Issue] 查询失败 (${listRes.status}): ${txt.slice(0, 200)}`);
      return;
    }

    const issues = await listRes.json() as Array<{ number: number; title: string }>;
    console.log(`[Issue] 标签 "${label}" 下找到 ${issues.length} 个 open Issue`);

    // 匹配前缀：新版 [三方库更新] / 旧版 [SDK巡检] 等
    const prefixVariants = isLegacy
      ? [`[SDK${prefix === '三方库更新' ? '巡检' : '一致性'}]`, `[${prefix}]`]
      : [`[${prefix}]`];

    for (const issue of issues) {
      const match = prefixVariants.some(p => issue.title.startsWith(p));
      if (!match) { console.log(`[Issue] #${issue.number} 标题 "${issue.title}" 不匹配前缀，跳过`); continue; }

      if (addComment) {
        const msg = `✅ 本次扫描（${new Date().toISOString().slice(0, 10)}）未发现问题，自动关闭。`;
        await fetch(`https://api.github.com/repos/${repo}/issues/${issue.number}/comments`, {
          method: 'POST', headers: authHeaders(), body: JSON.stringify({ body: msg }),
        });
      } else if (isLegacy) {
        const cmd = prefix === '三方库更新' ? 'update' : 'completeness';
        const msg = `🔄 新版插件已上线，自动关闭旧格式 Issue。回复 \`/sdk-${cmd}\` 触发新检测。`;
        await fetch(`https://api.github.com/repos/${repo}/issues/${issue.number}/comments`, {
          method: 'POST', headers: authHeaders(), body: JSON.stringify({ body: msg }),
        });
      }

      const closeRes = await fetch(`https://api.github.com/repos/${repo}/issues/${issue.number}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
      });
      if (closeRes.ok) {
        console.log(`[Issue] 已关闭 #${issue.number}`);
      } else {
        console.error(`[Issue] 关闭 #${issue.number} 失败 (${closeRes.status})`);
      }
    }
  } catch (err: any) {
    console.error('[Issue] 关闭流程异常:', err.message);
  }
}

// ============================================================
//  [对外接口] buildPagesReport — 生成 HTML 报告页面
// ============================================================
export async function buildPagesReport(
  data: Record<string, unknown>,
  findings: unknown[],
  issueUrl: string,
  filename: string
): Promise<string> {
  const outputDir = join(process.cwd(), 'docs', 'reports');
  mkdirSync(outputDir, { recursive: true });
  const plugin = filename.includes('-update-') ? 'update' : 'completeness';
  const html = generateReportHTML(data, findings, issueUrl, plugin);
  writeFileSync(join(outputDir, filename), html, 'utf-8');
  console.log(`[页面] docs/reports/${filename}`);
  return filename;
}

// ============================================================
//  [对外接口] getPagesHost
// ============================================================
export function getPagesHost(): string {
  const repo = repoName() || 'Haze324/sdk-governance-plugins';
  const [owner, name] = repo.split('/');
  return `${owner}.github.io/${name}`;
}

// ============================================================
//  [对外接口] updateRunName — 根据扫描结果重命名 Actions Run
// ============================================================
export async function updateRunName(runName: string): Promise<void> {
  const runId = process.env.GITHUB_RUN_ID;
  const repo = repoName();
  if (!runId || !repo) {
    console.log(`[RunName] 跳过 (runId=${runId || '无'} repo=${repo || '无'})`);
    return;
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs/${runId}`,
      {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ name: runName }),
      }
    );
    if (res.ok) {
      console.log(`[RunName] ✅ 已重命名为: ${runName}`);
    } else {
      const txt = await res.text();
      console.error(`[RunName] ❌ 失败 (${res.status}): ${txt.slice(0, 300)}`);
    }
  } catch (err: any) {
    console.error('[RunName] 异常:', err.message);
  }
}

// ============================================================
//  [对外接口] writeActionSummary
// ============================================================
export async function writeActionSummary(
  title: string,
  summary: Record<string, unknown>,
  findings: unknown[],
  reportUrl: string,
  issueUrl: string,
  hasCompatibilityIssue: boolean,
  hasSecurityVulnerability: boolean
): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    console.log(`[摘要] ${title} | SDK: ${summary['totalSDKs'] || 'N/A'} | 问题: ${findings.length}`);
    return;
  }
  const mode = process.env.LLM_API_KEY ? 'LLM增强' : '确定性';
  const lines = [
    `## ${title}`, '',
    `**扫描时间**：${summary['timestamp'] || new Date().toISOString()}  `,
    `**运行模式**：${mode}`, '',
    `| 指标 | 数值 |`, `|------|------|`,
  ];
  if (summary['totalSDKs'] !== undefined) {
    lines.push(`| SDK 总数 | ${summary['totalSDKs']} |`);
    if (summary['outdatedCount'] !== undefined) lines.push(`| 版本落后 | ${summary['outdatedCount']} |`);
    if (summary['compatIssueCount'] !== undefined) lines.push(`| 兼容性问题 | ${summary['compatIssueCount']} |`);
    if (summary['securityVulnCount'] !== undefined) lines.push(`| 安全漏洞 | ${summary['securityVulnCount']} |`);
  } else {
    if (summary['missingCount'] !== undefined) lines.push(`| 功能缺失 | ${summary['missingCount']} |`);
    if (summary['bugRiskCount'] !== undefined) lines.push(`| Bug 风险 | ${summary['bugRiskCount']} |`);
  }
  lines.push('');
  if (hasCompatibilityIssue || hasSecurityVulnerability) {
    lines.push(`### ⚠️ 发现问题 → 已创建 Issue`, `- Issue: ${issueUrl}`);
  } else {
    lines.push(`### ✅ 未发现问题`);
  }
  lines.push('', `📋 [完整报告](${reportUrl})`, '');
  writeFileSync(summaryPath, lines.join('\n'), 'utf-8');
  console.log('[摘要] 已写入 GITHUB_STEP_SUMMARY');
}

// ============================================================
//  [内部] generateReportHTML
// ============================================================
function generateReportHTML(
  data: Record<string, unknown>,
  findings: unknown[],
  issueUrl: string,
  plugin: string
): string {
  const titleMap: Record<string, string> = {
    'update': '三方库更新检测报告',
    'completeness': '三方库完整性检测报告',
    'inspect': 'SDK 巡检报告',
    'consistency': 'SDK 一致性检测报告',
  };
  const title = titleMap[plugin] || 'SDK 治理报告';
  const summary = data as Record<string, unknown>;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — ${summary['timestamp'] || ''}</title>
  <style>
    :root {
      --bg: #ffffff; --text: #1a1a2e; --text-secondary: #6b7280;
      --border: #e5e7eb; --card-bg: #f9fafb;
      --critical: #dc2626; --critical-bg: #fef2f2;
      --warning: #d97706; --warning-bg: #fffbeb;
      --info: #2563eb; --info-bg: #eff6ff;
      --success: #16a34a; --success-bg: #f0fdf4;
      --radius: 8px;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: var(--text); background: var(--bg); line-height: 1.6;
      max-width: 960px; margin: 0 auto; padding: 32px 24px;
    }
    .header { border-bottom: 2px solid var(--border); padding-bottom: 24px; margin-bottom: 32px; }
    .header h1 { font-size: 24px; font-weight: 600; margin-bottom: 8px; }
    .header .meta { font-size: 14px; color: var(--text-secondary); }
    .cards { display: flex; gap: 16px; margin-bottom: 32px; flex-wrap: wrap; }
    .card { flex: 1; min-width: 100px; background: var(--card-bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; text-align: center; }
    .card .label { font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; }
    .card .value { font-size: 32px; font-weight: 700; }
    .card.critical .value { color: var(--critical); }
    .card.warning .value { color: var(--warning); }
    .card.info .value { color: var(--info); }
    .card.success .value { color: var(--success); }
    .filters { display: flex; gap: 8px; margin-bottom: 24px; align-items: center; }
    .filters input { flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius); font-size: 14px; }
    .filter-btn { padding: 8px 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); font-size: 13px; cursor: pointer; transition: all 0.15s; }
    .filter-btn:hover { background: #f3f4f6; }
    .filter-btn.active { background: var(--text); color: #fff; border-color: var(--text); }
    .section-title { font-size: 16px; font-weight: 600; margin: 24px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
    .finding { border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 8px; overflow: hidden; }
    .finding-header { display: flex; align-items: center; padding: 12px 16px; cursor: pointer; gap: 12px; }
    .finding-header:hover { background: var(--card-bg); }
    .severity-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 12px; white-space: nowrap; }
    .severity-badge.critical { background: var(--critical-bg); color: var(--critical); }
    .severity-badge.warning { background: var(--warning-bg); color: var(--warning); }
    .severity-badge.info { background: var(--info-bg); color: var(--info); }
    .finding-title { flex: 1; font-size: 14px; font-weight: 500; }
    .finding-module { font-size: 12px; color: var(--text-secondary); }
    .finding-body { display: none; padding: 0 16px 16px; font-size: 14px; border-top: 1px solid var(--border); }
    .finding.open .finding-body { display: block; }
    .finding-body .row { margin-top: 8px; }
    .finding-body .row .label { font-size: 12px; color: var(--text-secondary); }
    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 12px; color: var(--text-secondary); }
    .footer a { color: var(--info); }
  </style>
</head>
<body>
  <div class="header">
    <h1>${title}</h1>
    <div class="meta">扫描时间：${summary['timestamp'] || '—'} &nbsp;|&nbsp; 仓库：${summary['repo'] || '—'}</div>
  </div>
  <div class="cards">
    ${Object.entries(summary)
      .filter(([k]) => k !== 'timestamp' && k !== 'repo' && k !== 'totalFindings')
      .map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value">${v}</div></div>`)
      .join('')}
  </div>
  <div class="filters">
    <input type="text" id="searchInput" placeholder="搜索 SDK 或关键词..." oninput="filterFindings()">
    <button class="filter-btn active" onclick="setFilter('all')" id="btn-all">全部</button>
    <button class="filter-btn" onclick="setFilter('critical')" id="btn-critical">严重</button>
    <button class="filter-btn" onclick="setFilter('warning')" id="btn-warning">警告</button>
    <button class="filter-btn" onclick="setFilter('info')" id="btn-info">提示</button>
  </div>
  <div id="findings-container">${renderFindingsHTML(findings)}</div>
  <div class="footer">
    由 SDK 治理插件 v2.0 自动生成 &nbsp;|&nbsp;
    ${issueUrl ? `<a href="${issueUrl}">查看 GitHub Issue</a>` : ''}
  </div>
  <script>
    let activeFilter='all';
    function setFilter(f){activeFilter=f;document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));document.getElementById('btn-'+f).classList.add('active');filterFindings();}
    function filterFindings(){var q=document.getElementById('searchInput').value.toLowerCase();document.querySelectorAll('.finding').forEach(el=>{var t=el.textContent.toLowerCase(),s=el.dataset.severity;el.style.display=(!q||t.includes(q))&&(activeFilter==='all'||s===activeFilter)?'':'none';});}
    document.querySelectorAll('.finding-header').forEach(h=>h.addEventListener('click',()=>h.parentElement.classList.toggle('open')));
  </script>
</body>
</html>`;
}

function renderFindingsHTML(findings: unknown[]): string {
  if (findings.length === 0) return '<p style="text-align:center;color:var(--text-secondary);padding:48px">未发现问题</p>';
  const groups: Record<string, unknown[]> = {
    critical: findings.filter((f: any) => f['severity'] === 'critical' || f['severity'] === 'high'),
    warning: findings.filter((f: any) => f['severity'] === 'warning' || f['severity'] === 'medium' || f['status'] === 'outdated'),
    info: findings.filter((f: any) => f['severity'] === 'info' || f['severity'] === 'low' || f['status'] === 'uptodate' || f['status'] === 'unreachable'),
  };
  const labels: Record<string, string> = { critical: '严重', warning: '警告', info: '提示' };
  let html = '';
  for (const [severity, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    html += `<div class="section-title">${labels[severity]}（${items.length} 项）</div>`;
    for (const item of items) {
      const f = item as any;
      const title = f['title'] || f['item'] || '—';
      html += `<div class="finding" data-severity="${severity}">
        <div class="finding-header">
          <span class="severity-badge ${severity}">${labels[severity]}</span>
          <span class="finding-title">${e(title)}</span>
          <span class="finding-module">${e(String(f['module'] || ''))}</span>
        </div>
        <div class="finding-body">
          <div class="row"><span class="label">详情：</span>${e(String(f['detail'] || ''))}</div>
          ${f['suggestion'] ? `<div class="row"><span class="label">建议：</span>${e(String(f['suggestion']))}</div>` : ''}
        </div>
      </div>`;
    }
  }
  return html;
}
function e(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
