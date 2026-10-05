import { useNavigate } from "@tanstack/react-router";
import { useHostProjects } from "renderer/hooks/host-projects/useHostProjects";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getPullRequestTarget } from "renderer/lib/github/getPullRequestTarget";
import { usePullRequestsSplitViewStore } from "renderer/routes/_authenticated/_dashboard/pull-requests/stores/pullRequestsSplitViewStore";

export function useOpenPullRequestInApp() {
	const navigate = useNavigate();
	const { projects, hostResults } = useHostProjects();
	const openUrl = electronTrpc.external.openUrl.useMutation();
	return (url: string) => {
		const target = getPullRequestTarget(url, [
			...hostResults.flatMap(({ target, rows }) =>
				(rows ?? []).map((row) => ({
					projectKey: row.id,
					hostId: target.machineId,
					repoOwner: row.repoOwner,
					repoName: row.repoName,
					provider: row.provider ?? undefined,
					instance: row.instance,
				})),
			),
			...projects,
		]);
		if (target && (target.ref.provider !== "gitlab" || target.projectId)) {
			usePullRequestsSplitViewStore.getState().expandDetail();
			void navigate({
				to: "/pull-requests/$prNumber",
				params: { prNumber: String(target.ref.number) },
				search: {
					project: target.projectId ?? undefined,
					repo: target.ref.repoFullName,
					host: target.hostId,
					provider: target.ref.provider === "gitlab" ? "gitlab" : undefined,
					instance:
						target.ref.provider === "gitlab" ? target.ref.instance : undefined,
					repoPath:
						target.ref.provider === "gitlab" ? target.ref.repoPath : undefined,
				},
			});
			return;
		}
		openUrl.mutate(url);
	};
}
