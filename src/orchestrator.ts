import { randomUUID } from "node:crypto";
import type { AgentEvent, Role, Run, Task } from "./types.js";

export class TeamOrchestrator {
  private runs = new Map<string, Run>();
  private events: AgentEvent[] = [];
  private idempotency = new Set<string>();

  constructor(private onEvent?: (event: AgentEvent) => void) {}

  createRun(input: { teamId: string; workflowId: string; goal: string }) {
    const runId = `run_${randomUUID().slice(0, 8)}`;
    const run: Run = {
      runId,
      teamId: input.teamId,
      workflowId: input.workflowId,
      status: "queued",
      createdAt: new Date().toISOString(),
      tasks: [],
    };

    this.runs.set(runId, run);
    this.emit({
      eventType: "run.created",
      runId,
      idempotencyKey: `${runId}:run.created`,
      payload: { goal: input.goal },
    });

    return run;
  }

  createTask(runId: string, title: string) {
    const run = this.mustRun(runId);
    const task: Task = {
      taskId: `task_${randomUUID().slice(0, 8)}`,
      title,
      status: "created",
      attempts: 0,
    };

    run.tasks.push(task);
    run.status = "running";

    this.emit({
      eventType: "task.created",
      runId,
      taskId: task.taskId,
      idempotencyKey: `${runId}:${task.taskId}:task.created`,
      payload: { title },
    });

    return task;
  }

  assignTask(runId: string, taskId: string, toAgent: Role, fromAgent: Role = "planner") {
    const task = this.mustTask(runId, taskId);
    task.status = "assigned";
    task.assignee = toAgent;

    this.emit({
      eventType: "task.assigned",
      runId,
      taskId,
      fromAgent,
      toAgent,
      idempotencyKey: `${runId}:${taskId}:task.assigned:${toAgent}`,
      payload: {},
    });
  }

  completeTask(runId: string, taskId: string, fromAgent: Role = "executor") {
    const task = this.mustTask(runId, taskId);
    task.status = "review_pending";

    this.emit({
      eventType: "task.completed",
      runId,
      taskId,
      fromAgent,
      idempotencyKey: `${runId}:${taskId}:task.completed`,
      payload: {},
    });

    this.emit({
      eventType: "review.requested",
      runId,
      taskId,
      fromAgent,
      toAgent: "reviewer",
      idempotencyKey: `${runId}:${taskId}:review.requested`,
      payload: {},
    });
  }

  review(runId: string, taskId: string, passed: boolean, reviewerNotes?: string) {
    const task = this.mustTask(runId, taskId);

    if (passed) {
      task.status = "done";
      this.emit({
        eventType: "review.passed",
        runId,
        taskId,
        fromAgent: "reviewer",
        idempotencyKey: `${runId}:${taskId}:review.passed`,
        payload: { reviewerNotes },
      });

      const run = this.mustRun(runId);
      if (run.tasks.every((t) => t.status === "done")) {
        run.status = "completed";
        this.emit({
          eventType: "run.completed",
          runId,
          idempotencyKey: `${runId}:run.completed`,
          payload: {},
        });
      }
      return;
    }

    task.status = "retrying";
    task.attempts += 1;

    this.emit({
      eventType: "review.failed",
      runId,
      taskId,
      fromAgent: "reviewer",
      toAgent: "planner",
      idempotencyKey: `${runId}:${taskId}:review.failed:${task.attempts}`,
      payload: { reviewerNotes, attempts: task.attempts },
    });
  }

  getRun(runId: string) {
    return this.mustRun(runId);
  }

  getEvents(runId?: string) {
    return runId ? this.events.filter((e) => e.runId === runId) : this.events;
  }

  private emit(params: Omit<AgentEvent, "eventId" | "occurredAt" | "correlationId"> & { correlationId?: string }) {
    if (this.idempotency.has(params.idempotencyKey)) return;
    this.idempotency.add(params.idempotencyKey);

    const event: AgentEvent = {
      eventId: `evt_${randomUUID().slice(0, 10)}`,
      occurredAt: new Date().toISOString(),
      correlationId: params.correlationId ?? params.runId,
      ...params,
    };

    this.events.push(event);
    this.onEvent?.(event);
  }

  private mustRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  private mustTask(runId: string, taskId: string) {
    const run = this.mustRun(runId);
    const task = run.tasks.find((t) => t.taskId === taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }
}
