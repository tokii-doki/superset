import { createFileRoute, Outlet } from "@tanstack/react-router";

export type TasksSearch = {
	tab?:
		| "all"
		| "active"
		| "backlog"
		| "unstarted"
		| "started"
		| "completed"
		| "canceled";
	assignee?: string;
	search?: string;
	type?: "tasks" | "linear" | "prs" | "issues" | "gitlab-issues";
	project?: string;
	host?: string;
	instance?: string;
	repoPath?: string;
	projects?: string;
	state?: "open" | "all";
};

export const Route = createFileRoute("/_authenticated/_dashboard/tasks")({
	component: TasksLayout,
	validateSearch: (search: Record<string, unknown>): TasksSearch => ({
		tab: [
			"all",
			"active",
			"backlog",
			"unstarted",
			"started",
			"completed",
			"canceled",
		].includes(search.tab as string)
			? (search.tab as TasksSearch["tab"])
			: undefined,
		assignee:
			typeof search.assignee === "string" && !search.assignee.startsWith("ext:")
				? search.assignee
				: undefined,
		search: typeof search.search === "string" ? search.search : undefined,
		type: ["tasks", "linear", "prs", "issues", "gitlab-issues"].includes(
			search.type as string,
		)
			? (search.type as TasksSearch["type"])
			: undefined,
		project: typeof search.project === "string" ? search.project : undefined,
		host: typeof search.host === "string" ? search.host : undefined,
		instance: typeof search.instance === "string" ? search.instance : undefined,
		repoPath: typeof search.repoPath === "string" ? search.repoPath : undefined,
		projects: typeof search.projects === "string" ? search.projects : undefined,
		state: ["open", "all"].includes(search.state as string)
			? (search.state as TasksSearch["state"])
			: undefined,
	}),
});

function TasksLayout() {
	return <Outlet />;
}
