export function resolveInitialView(path: string): string {
  const initialViewMap: Record<string, string> = {
    "/": "team-status",
    "/teams": "teams",
    "/team-status": "team-status",
    "/agents": "agents",
    "/settings": "settings",
    "/projects": "projects",
    "/runs": "runs",
  };

  return initialViewMap[path] ?? "team-status";
}
