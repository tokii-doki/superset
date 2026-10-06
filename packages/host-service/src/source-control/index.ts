import type { Octokit } from "@octokit/rest";
import type {
	RepositoryIdentity,
	SourceControlProvider,
} from "@superset/shared/source-control";
import { TRPCError } from "@trpc/server";
import type { ExecGh } from "../trpc/router/workspace-creation/utils/exec-gh";
import { createGitHubProvider } from "./github/github";
import type { GitLabClient } from "./gitlab/gitlab";
import { createGitLabProvider } from "./gitlab/provider";
import type { SourceControlProviderClient } from "./types";

export function resolveSourceControlProvider(
	provider: SourceControlProvider,
	options: {
		resolveRepository: () => Promise<RepositoryIdentity>;
		github: () => Promise<Octokit>;
		execGh: ExecGh;
		gitlab: GitLabClient;
	},
) {
	const providers = {
		github: () => createGitHubProvider(options),
		gitlab: () => createGitLabProvider(options),
	} satisfies Record<SourceControlProvider, () => SourceControlProviderClient>;
	if (!Object.hasOwn(providers, provider)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Unsupported source control provider: ${provider}`,
		});
	}
	return providers[provider]();
}
