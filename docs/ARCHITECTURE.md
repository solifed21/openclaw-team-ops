# Agent Team Ops - Single OpenClaw Instance Architecture

## Goal
OpenClaw 단일 인스턴스에서 멀티에이전트 팀 실행을 오케스트레이션하고, 추적 가능한 이벤트 로그를 기반으로 UI에 상태를 노출한다.

## Components

1. **In-process Orchestrator**
   - run/task lifecycle 관리
   - role handoff (`planner -> executor -> reviewer`)
   - 상태머신 전이

2. **Event Log Store**
   - `AgentEvent` append-only 저장
   - `idempotencyKey` 기반 중복 방지

3. **Trace View Source**
   - `correlationId = runId`
   - UI 타임라인/그래프 데이터 소스

4. **Future Adapters**
   - OpenClaw sessions integration
   - MCP bridge (optional)

## Event Types (v1)
- run.created
- task.created
- task.assigned
- task.completed
- review.requested
- review.passed
- review.failed
- approval.requested
- approval.granted
- approval.rejected
- run.completed
- run.failed

## State Machine (v1)

### Run
`queued -> running -> blocked -> completed | failed | cancelled`

### Task
`created -> assigned -> in_progress -> review_pending -> done | retrying | dead_letter`

## Next Step
- SQLite persistence layer
- Express/Fastify API (`/runs`, `/events`, `/actions`)
- WebSocket live updates
- Next.js dashboard
