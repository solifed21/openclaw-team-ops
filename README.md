# agent-team-ops

OpenClaw 단일 인스턴스에서 멀티에이전트 팀 워크플로우를 실행/추적하기 위한 MVP 레포.

## What is included

- In-process Team Orchestrator
- Role-based handoff model (planner/executor/reviewer)
- Event schema + idempotency key handling
- Minimal runnable simulation
- Architecture notes for dashboard expansion

## Quick start

```bash
npm install
npm run dev
```

## Example output

실행 후 `RUN` 상태와 `EVENTS` 타임라인이 출력된다.

## Project structure

```text
src/
  index.ts
  orchestrator.ts
  types.ts
docs/
  ARCHITECTURE.md
```

## Next milestones

1. SQLite persistence
2. REST + WebSocket API
3. Dashboard (runs/trace/approvals)
4. OpenClaw session hooks (`sessions_spawn`, `sessions_send`)
