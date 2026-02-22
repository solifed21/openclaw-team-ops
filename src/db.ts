import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentEvent, Run, Task } from "./types.js";

const ROLE_SKILLS: Record<string, string[]> = {
  orchestrator: ["sessions_spawn", "sessions_send", "github"],
  planner: ["summarize", "github"],
  researcher: ["web_search", "web_fetch", "summarize"],
  executor: ["github", "coding-agent"],
  reviewer: ["github", "summarize"],
  qa: ["github", "summarize"],
  approver: ["github"],
  ops: ["healthcheck", "github"],
  analyst: ["web_search", "summarize"],
  scribe: ["summarize", "obsidian"],
  commander: ["sessions_spawn", "github", "summarize"],
};

export class OpsDb {
  private db: DatabaseSync;

  constructor(path = "./data/ops.db") {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        team_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_skills (
        agent_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'role',
        PRIMARY KEY (agent_id, skill_name),
        FOREIGN KEY(agent_id) REFERENCES agents(agent_id)
      );

      CREATE TABLE IF NOT EXISTS team_agents (
        team_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        PRIMARY KEY (team_id, agent_id),
        FOREIGN KEY(team_id) REFERENCES teams(team_id),
        FOREIGN KEY(agent_id) REFERENCES agents(agent_id)
      );

      CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        name TEXT NOT NULL,
        goal TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(team_id) REFERENCES teams(team_id)
      );

      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        assignee TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(run_id) REFERENCES runs(run_id)
      );

      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        task_id TEXT,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        from_agent TEXT,
        to_agent TEXT,
        correlation_id TEXT NOT NULL,
        causation_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL
      );
    `);
  }

  createTeam(teamId: string, name: string, description?: string) {
    this.db
      .prepare(`INSERT INTO teams (team_id, name, description, created_at) VALUES (?, ?, ?, ?)`)
      .run(teamId, name, description ?? null, new Date().toISOString());
  }

  listTeams() {
    return this.db
      .prepare(
        `SELECT t.*, 
          (SELECT COUNT(*) FROM team_agents ta WHERE ta.team_id = t.team_id) AS agent_count,
          (SELECT COUNT(*) FROM projects p WHERE p.team_id = t.team_id) AS project_count
         FROM teams t
         ORDER BY t.created_at DESC`
      )
      .all();
  }

  getTeam(teamId: string) {
    return this.db.prepare(`SELECT * FROM teams WHERE team_id = ?`).get(teamId);
  }

  createAgent(agentId: string, name: string, role: string, status = "idle") {
    this.db
      .prepare(`INSERT INTO agents (agent_id, name, role, status, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(agentId, name, role, status, new Date().toISOString());
    this.rebuildRoleSkills(agentId, role);
  }

  ensureAgent(agentId: string, name: string, role: string, status = "online") {
    this.db
      .prepare(
        `INSERT INTO agents (agent_id, name, role, status, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET name=excluded.name, role=excluded.role, status=excluded.status`
      )
      .run(agentId, name, role, status, new Date().toISOString());
    this.rebuildRoleSkills(agentId, role);
  }

  private rebuildRoleSkills(agentId: string, role: string) {
    this.db.prepare(`DELETE FROM agent_skills WHERE agent_id = ? AND source = 'role'`).run(agentId);
    const skills = ROLE_SKILLS[role] ?? [];
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO agent_skills (agent_id, skill_name, source) VALUES (?, ?, 'role')`
    );
    for (const skill of skills) stmt.run(agentId, skill);
  }

  getAgentSkills(agentId: string) {
    return this.db
      .prepare(`SELECT skill_name, source FROM agent_skills WHERE agent_id = ? ORDER BY skill_name ASC`)
      .all(agentId);
  }

  listAgents(teamId?: string) {
    const rows = !teamId
      ? this.db.prepare(`SELECT * FROM agents ORDER BY created_at DESC`).all()
      : this.db
          .prepare(
            `SELECT a.*
             FROM agents a
             JOIN team_agents ta ON ta.agent_id = a.agent_id
             WHERE ta.team_id = ?
             ORDER BY a.created_at DESC`
          )
          .all(teamId);

    return rows.map((r: any) => ({ ...r, skills: this.getAgentSkills(r.agent_id).map((s: any) => s.skill_name) }));
  }

  assignAgentToTeam(teamId: string, agentId: string) {
    this.db
      .prepare(`INSERT OR IGNORE INTO team_agents (team_id, agent_id, assigned_at) VALUES (?, ?, ?)`)
      .run(teamId, agentId, new Date().toISOString());
  }

  createProject(projectId: string, teamId: string, name: string, goal?: string) {
    this.db
      .prepare(
        `INSERT INTO projects (project_id, team_id, name, goal, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`
      )
      .run(projectId, teamId, name, goal ?? null, new Date().toISOString());
  }

  listProjects(teamId?: string) {
    if (teamId) {
      return this.db
        .prepare(`SELECT * FROM projects WHERE team_id = ? ORDER BY created_at DESC`)
        .all(teamId);
    }
    return this.db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`).all();
  }

  upsertRun(run: Run) {
    this.db
      .prepare(
        `INSERT INTO runs (run_id, team_id, workflow_id, status, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET status=excluded.status`
      )
      .run(run.runId, run.teamId, run.workflowId, run.status, run.createdAt);

    for (const t of run.tasks) this.upsertTask(run.runId, t);
  }

  upsertTask(runId: string, task: Task) {
    this.db
      .prepare(
        `INSERT INTO tasks (task_id, run_id, title, status, assignee, attempts)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET status=excluded.status, assignee=excluded.assignee, attempts=excluded.attempts`
      )
      .run(task.taskId, runId, task.title, task.status, task.assignee ?? null, task.attempts);
  }

  insertEvent(event: AgentEvent) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO events
        (event_id, run_id, task_id, event_type, occurred_at, from_agent, to_agent, correlation_id, causation_id, idempotency_key, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.eventId,
        event.runId,
        event.taskId ?? null,
        event.eventType,
        event.occurredAt,
        event.fromAgent ?? null,
        event.toAgent ?? null,
        event.correlationId,
        event.causationId ?? null,
        event.idempotencyKey,
        JSON.stringify(event.payload)
      );
  }

  listRuns(teamId?: string) {
    if (teamId) {
      return this.db.prepare(`SELECT * FROM runs WHERE team_id = ? ORDER BY created_at DESC`).all(teamId);
    }
    return this.db.prepare(`SELECT * FROM runs ORDER BY created_at DESC`).all();
  }

  listEvents(runId?: string, teamId?: string) {
    if (runId) {
      return this.db
        .prepare(`SELECT * FROM events WHERE run_id = ? ORDER BY occurred_at ASC`)
        .all(runId);
    }
    if (teamId) {
      return this.db
        .prepare(
          `SELECT e.* FROM events e
           JOIN runs r ON r.run_id = e.run_id
           WHERE r.team_id = ?
           ORDER BY e.occurred_at DESC LIMIT 500`
        )
        .all(teamId);
    }
    return this.db.prepare(`SELECT * FROM events ORDER BY occurred_at DESC LIMIT 500`).all();
  }
}
