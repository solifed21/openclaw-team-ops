import { TeamOrchestrator } from "./orchestrator.js";

const orchestrator = new TeamOrchestrator();

const run = orchestrator.createRun({
  teamId: "team_alpha",
  workflowId: "wf_content_pipeline",
  goal: "블로그 초안 생성 → 리뷰 → 완료",
});

const task = orchestrator.createTask(run.runId, "OpenClaw 멀티에이전트 설계 초안 작성");
orchestrator.assignTask(run.runId, task.taskId, "executor");
orchestrator.completeTask(run.runId, task.taskId, "executor");
orchestrator.review(run.runId, task.taskId, true, "근거/구조 양호");

console.log("\n=== RUN ===");
console.dir(orchestrator.getRun(run.runId), { depth: null });

console.log("\n=== EVENTS ===");
console.dir(orchestrator.getEvents(run.runId), { depth: null });
