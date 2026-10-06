import type {
	RepositoryIdentity,
	SourceControlProvider,
} from "@superset/shared/source-control";
import { TRPCError } from "@trpc/server";
import { resolveSourceControlProvider } from "../../../../source-control";
import { assertGitLabIdentity } from "../../../../source-control/gitlab/merge-requests";
import type {
	MergeInput,
	RequestTarget,
} from "../../../../source-control/types";
import type { HostServiceContext } from "../../../../types";
import { syncPullRequestAfterWrite } from "../../pull-requests/shared/sync-after-write";
import {
	resolveGithubRepo,
	resolveGitLabRepo,
} from "../../workspace-creation/shared/project-helpers";

interface ProjectForgeTarget {
	projectId?: string;
	provider?: SourceControlProvider;
	instance?: string;
	repoPath?: string;
}

export function createProjectForge(
	ctx: HostServiceContext,
	target: ProjectForgeTarget,
	kind: "merge_request" | "issue" | "repository" = "merge_request",
) {
	const provider = target.provider ?? "github";
	let repository: Promise<RepositoryIdentity> | undefined;
	const resolvers = {
		github: async (): Promise<RepositoryIdentity> => {
			const repo = await resolveGithubRepo(ctx, target.projectId ?? "");
			return {
				provider: "github",
				instance: "https://github.com",
				repoPath: `${repo.owner}/${repo.name}`,
				owner: repo.owner,
				name: repo.name,
				url: `https://github.com/${repo.owner}/${repo.name}`,
			};
		},
		gitlab: async (): Promise<RepositoryIdentity> => {
			if (kind === "issue" && (!target.instance || !target.repoPath)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "GitLab issue identity requires an instance and repository.",
				});
			}
			const repo = await resolveGitLabRepo(ctx, target.projectId ?? "");
			if (kind === "issue") {
				if (
					repo.instance.toLowerCase() !== target.instance?.toLowerCase() ||
					repo.repoPath.toLowerCase() !== target.repoPath?.toLowerCase()
				) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message:
							"The GitLab issue does not match the project's current remote.",
					});
				}
			} else if (kind === "merge_request") {
				assertGitLabIdentity(repo, target);
			}
			return repo;
		},
	} satisfies Record<SourceControlProvider, () => Promise<RepositoryIdentity>>;
	const adapter = resolveSourceControlProvider(provider, {
		resolveRepository: () => (repository ??= resolvers[provider]()),
		github: ctx.github,
		execGh: ctx.execGh,
		gitlab: ctx.gitlab,
	});
	return {
		...adapter,
		async setState(input: RequestTarget & { state: "open" | "closed" }) {
			const result = await adapter.setState(input);
			await syncPullRequestAfterWrite(ctx, {
				repo: await adapter.getRepository(),
				prNumber: input.prNumber,
				action: input.state === "closed" ? "close" : "reopen",
			});
			return result;
		},
		async merge(input: MergeInput) {
			const result = await adapter.merge(input);
			await syncPullRequestAfterWrite(ctx, {
				repo: await adapter.getRepository(),
				prNumber: input.prNumber,
				action: "merge",
			});
			return result;
		},
	};
}
