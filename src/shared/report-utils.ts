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
║       · buildPagesReport — 生成 HTML 报告页面，部署到 GitHub Pages             ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
*/

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============================================================
//  [对外接口] createIssue — 在 GitHub 仓库创建 Issue
// ============================================================
export async function createIssue(
  title: string,
  body: string,
  labels: string[]
): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.REPO_NAME || process.env.GITHUB_REPOSITORY;

  if (!token || !repo) {
    console.warn('[Issue管理] 缺少 GITHUB_TOKEN 或 REPO_NAME，跳过 Issue 创建');
    return '';
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
      },
      body: JSON.stringify({ title, body, labels }),
    });

    const data = await response.json() as { html_url: string };
    console.log(`[Issue管理] Issue 创建成功: ${data.html_url}`);
    return data.html_url;
  } catch (err) {
    console.error('[Issue管理] Issue 创建失败:', err);
    return '';
  }
}

// ============================================================
//  [对外接口] commentOnIssue — 在指定 Issue 下评论
//  当通过 Issue 评论触发时，在原 Issue 下回复确认
// ============================================================
export async function commentOnIssue(
  issueUrl: string,
  commentBody: string
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !issueUrl) return;

  // 从 issueUrl 中提取 owner/repo 和 issue number
  // 格式：https://github.com/Haze324/sdk-governance-plugins/issues/1
  const match = issueUrl.match(/github\.com\/(.+?)\/(.+?)\/issues\/(\d+)/);
  if (!match) {
    console.warn('[Issue管理] 无法解析 Issue URL:', issueUrl);
    return;
  }

  const repo = `${match[1]}/${match[2]}`;
  const issueNumber = match[3];

  try {
    await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({ body: commentBody }),
      }
    );
    console.log(`[Issue管理] 已在 #${issueNumber} 下回复`);
  } catch (err) {
    console.error('[Issue管理] 评论失败:', err);
  }
}

// ============================================================
//  [对外接口] closePreviousIssue — 关闭上次同类型还开着的 Issue
//  防止同一类型的问题积累多个 Issue
// ============================================================
export async function closePreviousIssue(issuePrefix: string, label?: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.REPO_NAME || process.env.GITHUB_REPOSITORY;

  if (!token || !repo) return;

  // 根据前缀决定 label：SDK巡检 → sdk-inspect，SDK一致性 → sdk-consistency
  const labelsFilter = label || (issuePrefix === 'SDK一致性' ? 'sdk-consistency' : 'sdk-inspect');

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/issues?state=open&labels=${labelsFilter}&per_page=100`,
      {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    const issues = await response.json() as Array<{ number: number; title: string }>;

    for (const issue of issues) {
      if (issue.title.startsWith(`[${issuePrefix}]`)) {
        await fetch(`https://api.github.com/repos/${repo}/issues/${issue.number}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            state: 'closed',
            state_reason: 'completed',
          }),
        });
        console.log(`[Issue管理] 已关闭上次 ${issuePrefix} Issue: #${issue.number}`);
      }
    }
  } catch (err) {
    console.error('[Issue管理] 关闭旧 Issue 失败:', err);
  }
}

// ============================================================
//  [对外接口] buildPagesReport — 生成 HTML 报告页面
//  输出到 docs/reports/ 目录，由 GitHub Pages 部署
// ============================================================
export async function buildPagesReport(
  data: Record<string, unknown>,
  findings: unknown[],
  issueUrl: string,
  plugin: string
): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${date}-${plugin}.html`;
  const outputDir = join(process.cwd(), 'docs', 'reports');
  mkdirSync(outputDir, { recursive: true });

  const html = generateReportHTML(data, findings, issueUrl, plugin);
  writeFileSync(join(outputDir, filename), html, 'utf-8');

  console.log(`[页面生成] 报告页面: docs/reports/${filename}`);
  return filename;
}

// ============================================================
//  [核心] generateReportHTML — 生成完整 HTML 报告页面
// ============================================================
function generateReportHTML(
  data: Record<string, unknown>,
  findings: unknown[],
  issueUrl: string,
  plugin: string
): string {
  const title = plugin === 'inspect' ? 'SDK 巡检报告' : 'SDK 一致性检测报告';
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
    由 SDK 治理插件 v1.0 自动生成 &nbsp;|&nbsp;
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

  const labels: Record<string, string> = {
    critical: '严重', warning: '警告', info: '提示',
  };

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
          <span class="finding-title">${escapeHtml(String(title))}</span>
          <span class="finding-module">${escapeHtml(String(f['module'] || ''))}</span>
        </div>
        <div class="finding-body">
          <div class="row"><span class="label">详情：</span>${escapeHtml(String(f['detail'] || ''))}</div>
          ${f['suggestion'] ? `<div class="row"><span class="label">建议：</span>${escapeHtml(String(f['suggestion']))}</div>` : ''}
        </div>
      </div>`;
    }
  }
  return html;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
