import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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

function toRuntimeAgentId(agent: any, used: Set<string>): string {
  const rawName = String(agent?.name || "").trim().toLowerCase();
  const slug = rawName
    .replace(/[^a-z0-9\-_\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  let id = slug || String(agent?.agent_id || "agent").replace(/^agent_/, "") || "agent";
  if (id === "agent") id = `agent-${Math.random().toString(36).slice(2, 6)}`;

  let candidate = id;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${id}-${n++}`;
  }
  used.add(candidate);
  return candidate;
}

function loadRegisteredModels(): { provider: string; name: string }[] {
  try {
    const cfgPath = join(homedir(), ".openclaw", "openclaw.json");
    const raw = readFileSync(cfgPath, "utf8");
    const cfg = JSON.parse(raw);

    const out: { provider: string; name: string }[] = [];
    const pushModelRef = (modelRef: string) => {
      const ref = String(modelRef || "").trim();
      if (!ref) return;
      const [provider, ...rest] = ref.split("/");
      const name = rest.length ? `${provider}/${rest.join("/")}` : provider;
      const p = rest.length ? provider : "openclaw";
      out.push({ provider: p, name });
    };

    // Legacy shapes
    const models = Array.isArray(cfg?.models) ? cfg.models : [];
    for (const m of models) {
      const ref = String(m?.name || m?.model || m?.id || "");
      if (ref.includes("/")) pushModelRef(ref);
      else out.push({ provider: String(m?.provider || m?.modelProvider || "openclaw"), name: ref });
    }

    const legacyAgents = Array.isArray(cfg?.agents) ? cfg.agents : [];
    for (const a of legacyAgents) pushModelRef(String(a?.model || a?.modelName || ""));

    // Current openclaw schema: agents.defaults.models + agents.defaults.model.primary + agents.list[].model
    const defaults = cfg?.agents?.defaults;
    if (defaults?.model?.primary) pushModelRef(String(defaults.model.primary));
    if (defaults?.models && typeof defaults.models === "object") {
      for (const key of Object.keys(defaults.models)) pushModelRef(key);
    }
    const list = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : [];
    for (const a of list) pushModelRef(String(a?.model || ""));

    const uniq = new Map<string, { provider: string; name: string }>();
    for (const m of out) uniq.set(`${m.provider}::${m.name}`, m);
    return [...uniq.values()];
  } catch {
    return [];
  }
}

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

  if (req.method === "POST" && path.startsWith("/teams/") && path.endsWith("/delete")) {
    const teamId = path.split("/")[2];
    db.deleteTeam(teamId);
    return redirect(res, "/teams");
  }

  if (req.method === "POST" && path === "/agents") {
    const f = await readForm(req);
    db.createAgent(`agent_${randomUUID().slice(0, 8)}`, f.name || "새 에이전트", f.role || "executor", "idle");
    return redirect(res, "/agents");
  }

  if (req.method === "POST" && path.startsWith("/agents/") && path.endsWith("/update")) {
    const agentId = path.split("/")[2];
    const f = await readForm(req);
    if (f.role) db.updateAgentProfile(agentId, f.role, f.name);
    const [provider, modelName] = String(f.modelRef || "openclaw::").split("::");
    db.setAgentModel(agentId, provider || "openclaw", modelName || "");
    if (Object.prototype.hasOwnProperty.call(f, "discordBotToken")) {
      db.setAgentDiscordToken(agentId, f.discordBotToken || "");
    }
    return redirect(res, "/agents");
  }

  if (req.method === "POST" && path.startsWith("/agents/") && path.endsWith("/delete")) {
    const agentId = path.split("/")[2];
    db.deleteAgent(agentId);
    return redirect(res, "/agents");
  }

  if (req.method === "POST" && path.startsWith("/teams/") && path.endsWith("/assign")) {
    const teamId = path.split("/")[2];
    const f = await readForm(req);
    if (f.agentId) db.assignAgentToTeam(teamId, f.agentId);
    return redirect(res, "/agents");
  }

  if (req.method === "POST" && path.startsWith("/teams/") && path.endsWith("/unassign")) {
    const teamId = path.split("/")[2];
    const f = await readForm(req);
    if (f.agentId) db.unassignAgentFromTeam(teamId, f.agentId);
    return redirect(res, "/agents");
  }

  if (req.method === "POST" && path.startsWith("/teams/") && path.endsWith("/discord-target")) {
    const teamId = path.split("/")[2];
    const f = await readForm(req);
    if (f.guildId && f.channelId) db.upsertTeamDiscordTarget(teamId, f.guildId, f.channelId);
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

  if (req.method === "POST" && path === "/sync/openclaw-config") {
    try {
      const cfgPath = join(homedir(), ".openclaw", "openclaw.json");
      const raw = readFileSync(cfgPath, "utf8");
      const cfg = JSON.parse(raw);
      const agents = db.listAgents() as any[];
      const channelBindings = db.listChannelBindings() as any[];
      const teamTargets = db.listAllTeamDiscordTargets() as any[];

      cfg.agents = cfg.agents || {};
      cfg.agents.list = Array.isArray(cfg.agents.list) ? cfg.agents.list : [];

      // Merge/Upsert team-ops agents into OpenClaw agent list using nickname-style runtime ids
      const existingById = new Map((cfg.agents.list || []).map((a: any) => [a.id, a]));
      const usedRuntimeIds = new Set<string>([...existingById.keys()]);
      const runtimeIdByDbAgentId = new Map<string, string>();

      for (const a of agents) {
        const dbAgentId = String(a.agent_id || "");
        if (!dbAgentId) continue;

        // preserve cc and any existing explicit id match first
        let runtimeId = dbAgentId === "agent_cc" ? "cc" : "";
        if (!runtimeId) {
          const existingByName = [...existingById.keys()].find((id) => id === String(a.name || "").toLowerCase());
          runtimeId = existingByName || toRuntimeAgentId(a, usedRuntimeIds);
        }
        runtimeIdByDbAgentId.set(dbAgentId, runtimeId);

        const prev = existingById.get(runtimeId) || { id: runtimeId };
        const modelRef = a.model?.model_name || prev.model || cfg?.agents?.defaults?.model?.primary;
        existingById.set(runtimeId, {
          ...prev,
          id: runtimeId,
          model: modelRef,
        });
      }
      cfg.agents.list = [...existingById.values()];

      // Ensure discord channel tree exists
      cfg.channels = cfg.channels || {};
      cfg.channels.discord = cfg.channels.discord || { enabled: true, guilds: {}, accounts: {} };
      cfg.channels.discord.guilds = cfg.channels.discord.guilds || {};
      cfg.channels.discord.accounts = cfg.channels.discord.accounts || {};

      // Agent token -> channels.discord.accounts.{agentId}.token (OpenClaw-native)
      for (const a of agents) {
        const dbAgentId = String(a.agent_id || "");
        const agentId = runtimeIdByDbAgentId.get(dbAgentId) || "";
        if (!agentId) continue;
        const token = a.integrations?.discord_bot_token || "";

        cfg.channels.discord.accounts[agentId] = {
          ...(cfg.channels.discord.accounts[agentId] || {}),
          ...(token ? { token } : {}),
          enabled: true,
        };
      }

      // Team channel bindings -> guild/channel allow + bindings[]
      cfg.bindings = Array.isArray(cfg.bindings) ? cfg.bindings : [];
      const bindingKey = (b: any) => `${b?.agentId}|${b?.match?.guildId}|${b?.match?.peer?.id}`;
      const existingBindingKeys = new Set(cfg.bindings.map((b: any) => bindingKey(b)));

      // Direct per-agent bindings from DB
      for (const b of channelBindings) {
        const dbAgentId = String(b.agent_id || "");
        const agentId = runtimeIdByDbAgentId.get(dbAgentId) || "";
        const guildId = String(b.guild_id || "");
        const channelId = String(b.channel_id || "");
        if (!agentId || !guildId || !channelId) continue;

        cfg.channels.discord.guilds[guildId] = cfg.channels.discord.guilds[guildId] || { channels: {} };
        cfg.channels.discord.guilds[guildId].channels = cfg.channels.discord.guilds[guildId].channels || {};
        cfg.channels.discord.guilds[guildId].channels[channelId] = {
          ...(cfg.channels.discord.guilds[guildId].channels[channelId] || {}),
          allow: true,
          requireMention: true,
        };

        const binding = {
          agentId,
          match: {
            channel: "discord",
            accountId: agentId,
            guildId,
            peer: { kind: "channel", id: channelId },
          },
        };
        const key = bindingKey(binding);
        if (!existingBindingKeys.has(key)) {
          cfg.bindings.push(binding);
          existingBindingKeys.add(key);
        }
      }

      // Team target bindings: bind ALL team agents to each team channel target
      for (const t of teamTargets) {
        const teamId = String(t.team_id || "");
        const guildId = String(t.guild_id || "");
        const channelId = String(t.channel_id || "");
        if (!teamId || !guildId || !channelId) continue;

        cfg.channels.discord.guilds[guildId] = cfg.channels.discord.guilds[guildId] || { channels: {} };
        cfg.channels.discord.guilds[guildId].channels = cfg.channels.discord.guilds[guildId].channels || {};
        cfg.channels.discord.guilds[guildId].channels[channelId] = {
          ...(cfg.channels.discord.guilds[guildId].channels[channelId] || {}),
          allow: true,
          requireMention: true,
        };

        const teamAgents = db.listAgents(teamId) as any[];
        for (const a of teamAgents) {
          const dbAgentId = String(a.agent_id || "");
          const agentId = runtimeIdByDbAgentId.get(dbAgentId) || "";
          if (!agentId) continue;
          const binding = {
            agentId,
            match: {
              channel: "discord",
              accountId: agentId,
              guildId,
              peer: { kind: "channel", id: channelId },
            },
          };
          const key = bindingKey(binding);
          if (!existingBindingKeys.has(key)) {
            cfg.bindings.push(binding);
            existingBindingKeys.add(key);
          }
        }
      }

      cfg.meta = cfg.meta || {};
      cfg.meta.lastTouchedAt = new Date().toISOString();

      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      return redirect(res, "/settings?sync=ok");
    } catch {
      return redirect(res, "/settings?sync=fail");
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
       <div class="card"><div class="list">${teams.map((t: any) => `<div style="display:flex;gap:8px;align-items:center"><span><code>${t.team_id}</code> - ${esc(t.name)}</span><form method="post" action="/teams/${t.team_id}/delete" onsubmit="return confirm('팀 삭제?')"><button type="submit">삭제</button></form></div>`).join('') || '<div class="muted">없음</div>'}</div></div>`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  }

  if (path === "/agents") {
    const agents: any[] = db.listAgents() as any[];
    const teams: any[] = db.listTeams() as any[];
    const models = loadRegisteredModels();
    const modelOptions = models.map((m) => `${m.provider}::${m.name}`);

    const teamBlocks = teams.map(t => {
      const targets = db.listTeamDiscordTargets(t.team_id) as any[];
      return `<details class="card"><summary><b>${esc(t.name)}</b> <span class="muted">(${t.team_id})</span></summary>
      <div class="list" style="margin-top:10px">${(db.listAgents(t.team_id) as any[]).map(a => `<div style="display:flex;gap:8px;align-items:center"><span><b>${esc(a.name)}</b> <span class="badge">${esc(a.role)}</span></span><form method="post" action="/teams/${t.team_id}/unassign"><input type="hidden" name="agentId" value="${a.agent_id}"/><button type="submit">제거</button></form></div>`).join('') || '<div class="muted">없음</div>'}</div>
      <form method="post" action="/teams/${t.team_id}/assign" style="margin-top:10px;display:flex;gap:8px;align-items:center"><label class="muted">에이전트 선택</label><select name="agentId">${agents.map(a => `<option value="${a.agent_id}">${esc(a.name)} (${esc(a.role)})</option>`).join('')}</select> <button type="submit">＋ 할당</button></form>
      <div style="margin-top:10px" class="muted">팀 Discord 서버/채널 (팀 에이전트 전원 바인딩)</div>
      <form method="post" action="/teams/${t.team_id}/discord-target" style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input name="guildId" placeholder="guild id" required/><input name="channelId" placeholder="channel id" required/><button type="submit">채널 추가</button></form>
      <div class="list" style="margin-top:8px">${targets.map(x => `<div><code>${x.guild_id}</code> / <code>${x.channel_id}</code></div>`).join('') || '<div class="muted">설정된 채널 없음</div>'}</div>
    </details>`;
    }).join('');

    const html = layout("에이전트 관리",
      `<div class="card"><form method="post" action="/agents" style="display:grid;gap:8px;max-width:520px"><label class="muted">에이전트 이름</label><input name="name" placeholder="예: qa-bot" required/> <label class="muted">직책(Role)</label><select name="role">
      ${["orchestrator","planner","researcher","executor-backend","executor-frontend","executor-mobile","executor-data","executor-devops","reviewer","qa","approver","ops","analyst","scribe","commander"].map(r => `<option>${r}</option>`).join('')}
      </select> <button type="submit">에이전트 생성</button></form></div>
      ${teamBlocks}
      <div class="card"><h3>전체 에이전트 목록</h3><div class="list">${agents.map(a => {
        const current = `${a.model?.model_provider || 'openclaw'}::${a.model?.model_name || ''}`;
        return `<div style="border:1px solid #294275;border-radius:10px;padding:10px"><b>${esc(a.name)}</b> <span class="badge">${esc(a.role)}</span> <span class="muted">${esc(a.status)}</span><div class="muted">model: ${esc(a.model?.model_provider || '-')} / ${esc(a.model?.model_name || '-')}</div><div class="muted">discord token: ${a.integrations?.discord_bot_token ? '연결됨(숨김)' : '미설정'}</div><div class="muted">skills: ${esc((a.skills||[]).join(', '))}</div><form method="post" action="/agents/${a.agent_id}/update" style="margin-top:8px;display:grid;gap:6px;max-width:560px"><label class="muted">에이전트 이름</label><input name="name" value="${esc(a.name)}"/><label class="muted">직책(Role)</label><select name="role">${["orchestrator","planner","researcher","executor-backend","executor-frontend","executor-mobile","executor-data","executor-devops","reviewer","qa","approver","ops","analyst","scribe","commander"].map(r=>`<option ${a.role===r?'selected':''}>${r}</option>`).join('')}</select><label class="muted">모델(등록된 openclaw.json 모델)</label><select name="modelRef">${modelOptions.length?modelOptions.map(v=>`<option value="${v}" ${v===current?'selected':''}>${v}</option>`).join(''):`<option value="${current}">${current}</option>`}</select>${a.integrations?.discord_bot_token ? '<div class="muted">Discord Bot Token은 등록 후 보안상 숨김 처리됨</div>' : '<label class="muted">Discord Bot Token (에이전트 전용)</label><input name="discordBotToken" value="" placeholder="Bot token"/>'}<button type="submit">이름/직책/모델 변경</button></form><form method="post" action="/agents/${a.agent_id}/delete" onsubmit="return confirm('에이전트 삭제?')" style="margin-top:6px"><button type="submit">에이전트 삭제</button></form></div>`;
      }).join('') || '<div class="muted">없음</div>'}</div></div>`);
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
    const syncState = url.searchParams.get("sync");
    const noteImport = importState === "ok" ? "<div class=\"muted\">openclaw.json import 성공</div>" : importState === "fail" ? "<div class=\"muted\">openclaw.json import 실패</div>" : "";
    const noteSync = syncState === "ok" ? "<div class=\"muted\">openclaw.json 반영(sync) 성공</div>" : syncState === "fail" ? "<div class=\"muted\">openclaw.json 반영(sync) 실패</div>" : "";
    const html = layout("팀 설정", `<div class="card">${noteImport}${noteSync}<div class="muted">역할 정책/승인 정책/워크플로우 기본값 설정</div><form method="post" action="/import/openclaw-config" style="margin-top:10px"><button type="submit">openclaw.json 가져오기(import)</button></form><form method="post" action="/sync/openclaw-config" style="margin-top:10px"><button type="submit">openclaw.json 반영(sync)</button></form></div>`);
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
