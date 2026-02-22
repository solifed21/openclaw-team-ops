export type Role = "planner" | "executor" | "reviewer" | "approver";

export type RunStatus = "queued" | "running" | "blocked" | "completed" | "failed" | "cancelled";
export type TaskStatus =
  | "created"
  | "assigned"
  | "in_progress"
  | "review_pending"
  | "done"
  | "retrying"
  | "dead_letter";

export type EventType =
  | "run.created"
  | "task.created"
  | "task.assigned"
  | "task.completed"
  | "review.requested"
  | "review.passed"
  | "review.failed"
  | "approval.requested"
  | "approval.granted"
  | "approval.rejected"
  | "run.completed"
  | "run.failed";

export interface AgentEvent<T = Record<string, unknown>> {
  eventId: string;
  eventType: EventType;
  occurredAt: string;
  runId: string;
  taskId?: string;
  fromAgent?: Role;
  toAgent?: Role;
  correlationId: string;
  causationId?: string;
  idempotencyKey: string;
  payload: T;
}

export interface Task {
  taskId: string;
  title: string;
  status: TaskStatus;
  assignee?: Role;
  attempts: number;
}

export interface Run {
  runId: string;
  teamId: string;
  workflowId: string;
  status: RunStatus;
  createdAt: string;
  tasks: Task[];
}
