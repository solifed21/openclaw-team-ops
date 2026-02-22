import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { TeamOrchestrator } from "./orchestrator.js";
import { OpsDb } from "./db.js";

const db = new OpsDb();
const orchestrator = new TeamOrchestrator((event) => db.insertEvent(event));
db.ensureAgent("agent_cc", "cc", "orchestrator", "online");

function layout(title: string, content: string) {
  return `<!doctype html><html lang="ko"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title}</title>
  <style>
  *{box-sizing:border-box} body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;background:#0b1020;color:#e8eefc}
  .layout{display:grid;grid-template-columns:250px 1fr;min-height:100vh}.sidebar{background:#0f1730;border-right:1px solid #22335a;padding:16px}
  .brand{font-weight:700;margin-bottom:14px}.menu h4{font-size:12px;color:#9fb0d8;margin:16px 0 8px}
  .menu a{display:block;background:#162447;color:#e8eefc;border:1px solid #294275;border-radius:8px;padding:10px;text-decoration:none;margin-bottom:8px}
  .main{padding:20px}.card{background:#121a31;border:1px solid #233156;border-radius:12px;padding:14px;margin-bottom:12px}
  .grid{display:grid;grid-template-columns:repeat(3,minmax(220px,1fr));gap:12px}.list{display:grid;gap:8px}
  .muted{color:#9fb0d8;font-size:12px}.badge{padding:2px 8px;border-radius:999px;background:#203462;font-size:12px} code{color:#9ad1ff}
  input,select,button{padding:8px;border-radius:8px;border:1px solid #294275;background:#0f1730;color:#fff}
  button{cursor:pointer}
  </style></head><body>
  <div class="layout"><aside class="sidebar"><div class="brand">Agent Team Ops</div><div class="menu">
  <h4>TEAM</h4><a href="/teams">팀 만들기/목록</a><a href="/team-status">팀별 작업현황</a><a href="/agents">에이전트 관리</a><a href="/settings">팀 설정</a>
  <h4>PROJECT</h4><a href="/projects">프로젝트 관리</a><a href="/runs">런/이벤트 추적</a>
  </div></aside><main class="main"><h2>${title}</h2>${content}</main></div></body></html>`;
}

function esc(v: unknown) { return String(v ?? ""); }

async function readForm(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = new URLSearchParams(body);
      const out: Record<string, string> = {};
      for (const [k, v] of p.entries()) out[k] = v;
      resolve(out);
    });
  });
}

function redirect(res: http.ServerResponse, location: string) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "POST" && path === "/teams") {
    const f = await readForm(req);
    db.createTeam(`team_${randomUUID().slice(0, 8)}`, f.name || "새 팀", f.description || "");
    return redirect(res, "/teams");
  }

  if (req.method === "POST" && path === "/agents") {
    const f = await readForm(req);
    db.createAgent(`agent_${randomUUID().slice(0, 8)}`, f.name || "새 에이전트", f.role || "executor", "idle");
    return redirect(res, "/agents");
  }

  if (req.method === "POST" && path.startsWith("/teams/") && path.endsWith("/assign")) {
    const teamId = path.split("/")[2];
    const f = await readForm(req);
    if (f.agentId) db.assignAgentToTeam(teamId, f.agentId);
    return redirect(res, "/agents");
  }

  if (req.method === "POST" && path === "/projects") {
    const f = await readForm(req);
    if (f.teamId) db.createProject(`proj_${randomUUID().slice(0, 8)}`, f.teamId, f.name || "새 프로젝트", f.goal || "");
    return redirect(res, "/projects");
  }

  if (req.method === "POST" && path === "/import/openclaw-config") {
    try {
      const cfgPath = join(homedir(), ".openclaw", "openclaw.json");
      const raw = readFileSync(cfgPath, "utf8");
      const cfg = JSON.parse(raw);
      const agents = Array.isArray(cfg?.agents) ? cfg.agents : [];

      const defaultTeamId = "team_imported";
      try { db.createTeam(defaultTeamId, "Imported Team", "openclaw.json 동기화"); } catch {}

      for (const a of agents) {
        const agentId = `agent_${String(a?.id || a?.name || randomUUID().slice(0, 8))}`;
        const role = String(a?.role || "executor");
        const name = String(a?.name || a?.id || "agent");
        db.ensureAgent(agentId, name, role, "online");
        db.assignAgentToTeam(defaultTeamId, agentId);

        const provider = String(a?.modelProvider || a?.provider || "openclaw");
        const modelName = String(a?.model || a?.modelName || "");
        db.setAgentModel(agentId, provider, modelName);

        const guilds = Array.isArray(a?.guilds) ? a.guilds : [];
        for (const g of guilds) {
          const gid = String(g?.id || g?.guildId || "");
          const channels = Array.isArray(g?.channels) ? g.channels : [];
          for (const c of channels) {
            const cid = typeof c === "string" ? c : String(c?.id || c?.channelId || "");
            if (cid) db.setChannelBinding(defaultTeamId, agentId, gid || undefined, cid);
          }
        }
      }

      return redirect(res, "/settings?import=ok");
    } catch {
      return redirect(res, "/settings?import=fail");
    }
  }

  if (path === "/" || path === "/team-status") {
    const teams = db.listTeams();
    const cards = teams.map((t: any) => `<a class="card" href="/team-status/${t.team_id}" style="text-decoration:none;color:inherit"><h3>${esc(t.name)}</h3><div class="muted">Agents: ${t.agent_count} · Projects: ${t.project_count}</div></a>`).join("");
    const html = layout("팀별 작업현황", `<div class="grid">${cards || '<div class="muted">팀이 없어.</div>'}</div>`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  }

  if (path.startsWith("/team-status/")) {
    const teamId = path.split("/")[2];
    const team: any = db.getTeam(teamId);
    const agents: any[] = db.listAgents(teamId) as any[];
    const runs: any[] = db.listRuns(teamId) as any[];
    const events: any[] = db.listEvents(undefined, teamId) as any[];
    const bindings: any[] = db.listChannelBindings(teamId) as any[];
    const html = layout(
      `팀 상세 - ${esc(team?.name || teamId)}`,
      `<div class="card"><h3>${esc(team?.name || teamId)}</h3><div class="muted">${esc(team?.description || '설명 없음')}</div></div>
       <div class="card"><h3>팀 내부 Agent 작업현황</h3><div class="list">${agents.map(a => `<div><b>${esc(a.name)}</b> <span class="badge">${esc(a.role)}</span> <span class="muted">${esc(a.status)}</span><div class="muted">model: ${esc(a.model?.model_provider || '-')} / ${esc(a.model?.model_name || '-')}</div><div class="muted">skills: ${esc((a.skills||[]).join(', '))}</div></div>`).join('') || '<div class="muted">없음</div>'}</div></div>
       <div class="card"><h3>Discord 채널 바인딩</h3><div class="list">${bindings.map(b => `<div><code>${esc(b.channel_id)}</code> <span class="muted">agent: ${esc(b.agent_id)} guild: ${esc(b.guild_id || '-')}</span></div>`).join('') || '<div class="muted">없음</div>'}</div></div>
       <div class="card"><h3>Runs</h3><div class="list">${runs.map(r => `<div><code>${r.run_id}</code> <span class="badge">${r.status}</span></div>`).join('') || '<div class="muted">없음</div>'}</div></div>
       <div class="card"><h3>Logs</h3><div class="list">${events.slice(0,50).map(e => `<div><code>${e.event_type}</code> <span class="muted">${new Date(e.occurred_at).toLocaleTimeString()}</span></div>`).join('') || '<div class="muted">없음</div>'}</div></div>`
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  }

  if (path === "/teams") {
    const teams = db.listTeams();
    const html = layout("팀 만들기/목록",
      `<div class="card"><form method="post" action="/teams"><input name="name" placeholder="팀 이름" required/> <input name="description" placeholder="설명"/> <button type="submit">팀 생성</button></form></div>
       <div class="card"><div class="list">${teams.map((t: any) => `<div><code>${t.team_id}</code> - ${esc(t.name)}</div>`).join('') || '<div class="muted">없음</div>'}</div></div>`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  }

  if (path === "/agents") {
    const agents: any[] = db.listAgents() as any[];
    const teams: any[] = db.listTeams() as any[];
    const teamBlocks = teams.map(t => `<details class="card"><summary><b>${esc(t.name)}</b> <span class="muted">(${t.team_id})</span></summary>
      <div class="list" style="margin-top:10px">${(db.listAgents(t.team_id) as any[]).map(a => `<div><b>${esc(a.name)}</b> <span class="badge">${esc(a.role)}</span></div>`).join('') || '<div class="muted">없음</div>'}</div>
      <form method="post" action="/teams/${t.team_id}/assign" style="margin-top:10px"><select name="agentId">${agents.map(a => `<option value="${a.agent_id}">${esc(a.name)} (${esc(a.role)})</option>`).join('')}</select> <button type="submit">＋ 할당</button></form>
    </details>`).join('');
    const html = layout("에이전트 관리",
      `<div class="card"><form method="post" action="/agents"><input name="name" placeholder="에이전트 이름" required/> <select name="role">
      ${["orchestrator","planner","researcher","executor","reviewer","qa","approver","ops","analyst","scribe","commander"].map(r => `<option>${r}</option>`).join('')}
      </select> <button type="submit">에이전트 생성</button></form></div>
      ${teamBlocks}
      <div class="card"><h3>전체 에이전트 목록</h3><div class="list">${agents.map(a => `<div><b>${esc(a.name)}</b> <span class="badge">${esc(a.role)}</span> <span class="muted">${esc(a.status)}</span><div class="muted">skills: ${esc((a.skills||[]).join(', '))}</div></div>`).join('') || '<div class="muted">없음</div>'}</div></div>`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  }

  if (path === "/projects") {
    const teams: any[] = db.listTeams() as any[];
    const projects: any[] = db.listProjects() as any[];
    const html = layout("프로젝트 관리",
      `<div class="card"><form method="post" action="/projects"><input name="name" placeholder="프로젝트 이름" required/> <select name="teamId">${teams.map(t => `<option value="${t.team_id}">${esc(t.name)}</option>`).join('')}</select> <button type="submit">프로젝트 생성</button></form></div>
      <div class="card"><div class="list">${projects.map(p => `<div>${esc(p.name)} <span class="badge">${esc(p.status)}</span></div>`).join('') || '<div class="muted">없음</div>'}</div></div>`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  }

  if (path === "/runs") {
    const runs: any[] = db.listRuns() as any[];
    const events: any[] = db.listEvents() as any[];
    const html = layout("런/이벤트 추적",
      `<div class="card"><div class="list">${runs.map(r => `<div><code>${r.run_id}</code> <span class="badge">${r.status}</span></div>`).join('') || '<div class="muted">없음</div>'}</div></div>
      <div class="card"><div class="list">${events.slice(0,100).map(e => `<div><code>${e.event_type}</code> <span class="muted">${new Date(e.occurred_at).toLocaleTimeString()}</span></div>`).join('') || '<div class="muted">없음</div>'}</div></div>`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  }

  if (path === "/settings") {
    const importState = url.searchParams.get("import");
    const note = importState === "ok" ? "<div class=\"muted\">openclaw.json import 성공</div>" : importState === "fail" ? "<div class=\"muted\">openclaw.json import 실패</div>" : "";
    const html = layout("팀 설정", `<div class="card">${note}<div class="muted">역할 정책/승인 정책/워크플로우 기본값 설정 예정</div><form method="post" action="/import/openclaw-config" style="margin-top:10px"><button type="submit">openclaw.json 가져오기</button></form></div>`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  }

  res.statusCode = 404;
  res.end("Not Found");
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Dashboard running at http://localhost:${port}`);
});
