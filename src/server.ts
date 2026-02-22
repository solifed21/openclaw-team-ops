import http from "node:http";
import { randomUUID } from "node:crypto";
import { TeamOrchestrator } from "./orchestrator.js";
import { OpsDb } from "./db.js";
import { resolveInitialView } from "./view-routing.js";

const db = new OpsDb();
const orchestrator = new TeamOrchestrator((event) => db.insertEvent(event));

// Register this running assistant as a system agent so agent list is never empty.
db.ensureAgent("agent_cc", "cc", "orchestrator", "online");

const html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Agent Team Ops Dashboard</title><style>
*{box-sizing:border-box} body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;background:#0b1020;color:#e8eefc}
.layout{display:grid;grid-template-columns:250px 1fr;min-height:100vh}.sidebar{background:#0f1730;border-right:1px solid #22335a;padding:16px}
.brand{font-weight:700;margin-bottom:14px}.menu h4{font-size:12px;color:#9fb0d8;margin:16px 0 8px}
.menu button,.menu a{display:block;width:100%;background:#162447;color:#e8eefc;border:1px solid #294275;border-radius:8px;padding:10px;text-align:left;margin-bottom:8px;cursor:pointer;text-decoration:none}
.main{padding:20px}.card{background:#121a31;border:1px solid #233156;border-radius:12px;padding:14px}.grid{display:grid;grid-template-columns:repeat(3,minmax(220px,1fr));gap:12px}
.list{display:grid;gap:10px}.muted{color:#9fb0d8;font-size:12px}.badge{padding:2px 8px;border-radius:999px;background:#203462;font-size:12px} code{color:#9ad1ff}
</style></head><body>
<div class="layout"><aside class="sidebar"><div class="brand">Agent Team Ops</div><div class="menu">
<h4>TEAM</h4><a href="/teams">팀 만들기/목록</a><a href="/team-status">팀별 작업현황</a><a href="/agents">에이전트 관리</a><a href="/settings">팀 설정</a>
<h4>PROJECT</h4><a href="/projects">프로젝트 관리</a><a href="/runs">런/이벤트 추적</a></div></aside>
<main class="main"><h2 id="title">팀별 작업현황</h2><div class="muted" id="subtitle">Team cards -> detail -> agent status + logs</div><div id="content" style="margin-top:14px"></div></main></div>
<script>
let current = "__INITIAL_VIEW__";
let selectedTeamId = new URLSearchParams(location.search).get('teamId');
function showView(v){
  current=v;
  if(v!=='team-detail') selectedTeamId=null;
  const q = new URLSearchParams(location.search);
  if(selectedTeamId) q.set('teamId', selectedTeamId); else q.delete('teamId');
  const viewPath = {
    'teams':'/teams','team-status':'/team-status','agents':'/agents','settings':'/settings','projects':'/projects','runs':'/runs','team-detail':'/team-status'
  }[v] || '/team-status';
  const qs = q.toString();
  history.replaceState(null,'', viewPath + (qs ? ('?'+qs) : ''));
  render();
}
async function api(path,opt){return (await fetch(path,opt)).json();}
function esc(v){return String(v ?? '');}

async function render(){
  selectedTeamId = new URLSearchParams(location.search).get('teamId');
  const content=document.getElementById('content'); const title=document.getElementById('title');

  if(current==='teams'){
    title.textContent='팀 만들기/목록';
    const teams=await api('/api/teams');
    content.innerHTML='<div class="card"><h3>새 팀</h3><input id="teamName" placeholder="팀 이름" style="width:100%;padding:8px;background:#0f1730;border:1px solid #294275;color:#fff;border-radius:8px"/><button onclick="createTeam()" style="margin-top:8px">팀 생성</button></div>'+
      '<div class="card" style="margin-top:12px"><h3>팀 목록</h3><div class="list">'+teams.map(t=>'<div><code>'+esc(t.team_id)+'</code> - '+esc(t.name)+'</div>').join('')+'</div></div>';
    return;
  }

  if(current==='agents'){
    title.textContent='에이전트 관리';
    const [agents, teams]=await Promise.all([api('/api/agents'), api('/api/teams')]);
    content.innerHTML='<div class="card"><h3>새 에이전트</h3><input id="agentName" placeholder="에이전트 이름" style="width:100%;padding:8px;background:#0f1730;border:1px solid #294275;color:#fff;border-radius:8px"/>'+
      '<select id="agentRole" style="width:100%;padding:8px;margin-top:8px;background:#0f1730;border:1px solid #294275;color:#fff;border-radius:8px">'+
      '<option>orchestrator</option><option>planner</option><option>researcher</option><option>executor</option><option>reviewer</option><option>qa</option><option>approver</option><option>ops</option><option>analyst</option><option>scribe</option><option>commander</option></select>'+
      '<button onclick="createAgent()" style="margin-top:8px">에이전트 생성</button></div>'+
      '<div class="card" style="margin-top:12px"><h3>팀별 에이전트 할당</h3><div id="teamAgentAccordion" class="list"></div></div>'+
      '<div class="card" style="margin-top:12px"><h3>전체 에이전트 목록</h3><div class="list">'+agents.map(a=>'<div><b>'+esc(a.name)+'</b> <span class="badge">'+esc(a.role)+'</span> <span class="muted">'+esc(a.status)+'</span><div class="muted">skills: '+esc((a.skills||[]).join(', ')||'-')+'</div></div>').join('')+'</div></div>';

    const container = document.getElementById('teamAgentAccordion');
    container.innerHTML = teams.map(function(t){
      return '<details class="card" style="padding:10px;background:#0f1730;border-color:#294275">'+
        '<summary style="cursor:pointer"><b>'+esc(t.name)+'</b> <span class="muted">('+t.team_id+')</span></summary>'+
        '<div style="margin-top:10px" id="team_block_'+t.team_id+'">로딩중...</div>'+
      '</details>';
    }).join('');

    for (const t of teams) {
      const [teamAgents] = await Promise.all([api('/api/teams/'+t.team_id+'/agents')]);
      const block = document.getElementById('team_block_'+t.team_id);
      const cards = (teamAgents && teamAgents.length)
        ? '<div class="grid" style="grid-template-columns:repeat(2,minmax(180px,1fr))">'+teamAgents.map(function(a){
            return '<div class="card" style="padding:10px"><b>'+esc(a.name)+'</b><div><span class="badge">'+esc(a.role)+'</span></div><div class="muted">'+esc(a.status)+'</div><div class="muted">skills: '+esc((a.skills||[]).join(', ')||'-')+'</div></div>';
          }).join('')+'</div>'
        : '<div class="muted">할당된 agent 없음</div>';

      const addUi = '<div style="margin-top:10px;display:flex;gap:8px">'+
        '<select id="assignAgent_'+t.team_id+'" style="flex:1;padding:8px;background:#0b1020;border:1px solid #294275;color:#fff;border-radius:8px">'+
          agents.map(a=>'<option value="'+a.agent_id+'">'+esc(a.name)+' ('+esc(a.role)+')</option>').join('')+
        '</select>'+
        '<button onclick="assignAgentToTeam(\''+t.team_id+'\')" title="에이전트 할당">＋</button>'+
      '</div>';

      block.innerHTML = cards + addUi;
    }
    return;
  }

  if(current==='team-status'){
    title.textContent='팀별 작업현황';
    const teams=await api('/api/teams');
    content.innerHTML='<div class="grid">'+teams.map(t=>'<div class="card team-card" data-team-id="'+t.team_id+'" style="cursor:pointer"><h3>'+esc(t.name)+'</h3><div class="muted">Agents: '+t.agent_count+' · Projects: '+t.project_count+'</div><div style="margin-top:10px"><span class="badge">팀 상세 보기</span></div></div>').join('')+'</div>';
    document.querySelectorAll('.team-card').forEach(function(el){
      el.addEventListener('click', function(){
        openTeam(el.getAttribute('data-team-id'));
      });
    });
    return;
  }

  if(current==='team-detail' && selectedTeamId){
    title.textContent='팀 상세';
    const [team, agents, runs, events]=await Promise.all([
      api('/api/teams/'+selectedTeamId),
      api('/api/teams/'+selectedTeamId+'/agents'),
      api('/api/runs?teamId='+selectedTeamId),
      api('/api/events?teamId='+selectedTeamId)
    ]);

    content.innerHTML='<div class="card"><h3>'+esc(team.name)+'</h3><div class="muted">'+esc(team.description || '설명 없음')+'</div></div>'+
      '<div class="card" style="margin-top:12px"><h3>팀 내부 Agent 작업현황</h3><div class="list">'+(agents.length?agents.map(a=>'<div><b>'+esc(a.name)+'</b> <span class="badge">'+esc(a.role)+'</span> <span class="muted">status: '+esc(a.status)+'</span></div>').join(''):'<div class="muted">할당된 agent 없음</div>')+'</div></div>'+
      '<div class="card" style="margin-top:12px"><h3>Runs</h3><div class="list">'+(runs.length?runs.map(r=>'<div><code>'+r.run_id+'</code> <span class="badge">'+r.status+'</span></div>').join(''):'<div class="muted">run 없음</div>')+'</div></div>'+
      '<div class="card" style="margin-top:12px"><h3>Logs (Events)</h3><div class="list">'+(events.length?events.slice(0,50).map(e=>'<div><code>'+e.event_type+'</code> <span class="muted">'+new Date(e.occurred_at).toLocaleTimeString()+'</span></div>').join(''):'<div class="muted">로그 없음</div>')+'</div></div>';
    return;
  }

  if(current==='projects'){
    title.textContent='프로젝트 관리';
    const teams=await api('/api/teams');
    const projects=await api('/api/projects');
    const options=teams.map(t=>'<option value="'+t.team_id+'">'+esc(t.name)+'</option>').join('');
    content.innerHTML='<div class="card"><h3>새 프로젝트</h3><input id="projectName" placeholder="프로젝트 이름" style="width:100%;padding:8px;background:#0f1730;border:1px solid #294275;color:#fff;border-radius:8px"/><select id="projectTeam" style="width:100%;padding:8px;margin-top:8px;background:#0f1730;border:1px solid #294275;color:#fff;border-radius:8px">'+options+'</select><button onclick="createProject()" style="margin-top:8px">프로젝트 생성</button></div>'+
      '<div class="card" style="margin-top:12px"><h3>프로젝트 목록</h3><div class="list">'+projects.map(p=>'<div>'+esc(p.name)+' <span class="badge">'+esc(p.status)+'</span></div>').join('')+'</div></div>';
    return;
  }

  if(current==='runs'){
    title.textContent='런/이벤트 추적';
    const [runs,events]=await Promise.all([api('/api/runs'),api('/api/events')]);
    content.innerHTML='<div class="card"><h3>Runs</h3><div class="list">'+(runs.length?runs.map(r=>'<div><code>'+r.run_id+'</code> <span class="badge">'+r.status+'</span></div>').join(''):'<div class="muted">run 없음</div>')+'</div></div>'+
      '<div class="card" style="margin-top:12px"><h3>전체 이벤트 로그</h3><div class="list">'+(events.length?events.slice(0,100).map(e=>'<div><code>'+e.event_type+'</code> <span class="muted">'+new Date(e.occurred_at).toLocaleTimeString()+'</span></div>').join(''):'<div class="muted">로그 없음</div>')+'</div></div>';
    return;
  }

  if(current==='settings'){
    title.textContent='팀 설정';
    content.innerHTML='<div class="card"><h3>팀 설정 (다음 단계)</h3><div class="muted">역할 정책, 승인 정책, 기본 워크플로우를 여기서 설정합니다.</div></div>';
    return;
  }

  content.innerHTML='<div class="card"><div class="muted">메뉴를 선택해줘.</div></div>';
}

function openTeam(teamId){
  selectedTeamId=teamId;
  current='team-detail';
  const q = new URLSearchParams(location.search);
  q.set('teamId', teamId);
  history.replaceState(null,'','/team-status?'+q.toString());
  render();
}
async function createTeam(){ const name=document.getElementById('teamName').value; if(!name) return; await api('/api/teams',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}); render(); }
async function createAgent(){ const name=document.getElementById('agentName').value; const role=document.getElementById('agentRole').value; if(!name) return; await api('/api/agents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,role})}); render(); }
async function assignAgentToTeam(teamId){ const sel=document.getElementById('assignAgent_'+teamId); const agentId=sel && sel.value; if(!agentId) return; await api('/api/teams/'+teamId+'/agents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agentId})}); render(); }
async function createProject(){ const name=document.getElementById('projectName').value; const teamId=document.getElementById('projectTeam').value; if(!name||!teamId) return; await api('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,teamId})}); render(); }
window.showView = showView;
render();
</script></body></html>`;

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/teams") return json(res, db.listTeams());
  if (req.method === "POST" && path === "/api/teams") {
    const body = await readBody(req);
    const teamId = `team_${randomUUID().slice(0, 8)}`;
    db.createTeam(teamId, body.name ?? "새 팀", body.description);
    return json(res, { teamId });
  }

  if (req.method === "GET" && path.startsWith("/api/teams/") && !path.endsWith("/agents")) {
    const teamId = path.split("/")[3];
    return json(res, db.getTeam(teamId));
  }

  if (req.method === "GET" && path === "/api/agents") return json(res, db.listAgents());
  if (req.method === "POST" && path === "/api/agents") {
    const body = await readBody(req);
    const agentId = `agent_${randomUUID().slice(0, 8)}`;
    db.createAgent(agentId, body.name ?? "새 에이전트", body.role ?? "executor", "idle");
    return json(res, { agentId });
  }

  if (req.method === "GET" && path.endsWith("/agents") && path.startsWith("/api/teams/")) {
    const teamId = path.split("/")[3];
    return json(res, db.listAgents(teamId));
  }

  if (req.method === "POST" && path.endsWith("/agents") && path.startsWith("/api/teams/")) {
    const teamId = path.split("/")[3];
    const body = await readBody(req);
    db.assignAgentToTeam(teamId, body.agentId);
    return json(res, { ok: true });
  }

  if (req.method === "GET" && path === "/api/projects") return json(res, db.listProjects());
  if (req.method === "POST" && path === "/api/projects") {
    const body = await readBody(req);
    const projectId = `proj_${randomUUID().slice(0, 8)}`;
    db.createProject(projectId, body.teamId, body.name ?? "새 프로젝트", body.goal);
    return json(res, { projectId });
  }

  if (req.method === "GET" && path === "/api/runs") return json(res, db.listRuns(url.searchParams.get("teamId") ?? undefined));
  if (req.method === "GET" && path === "/api/events") {
    const runId = url.searchParams.get("runId") ?? undefined;
    const teamId = url.searchParams.get("teamId") ?? undefined;
    return json(res, db.listEvents(runId, teamId));
  }

  if (["/", "/teams", "/team-status", "/agents", "/settings", "/projects", "/runs"].includes(path)) {
    const initialView = resolveInitialView(path);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html.replace("__INITIAL_VIEW__", initialView));
    return;
  }

  res.statusCode = 404;
  res.end("Not Found");
});

function json(res: http.ServerResponse, payload: unknown) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Dashboard running at http://localhost:${port}`);
});
