import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	assertGitLabIdentity,
	gitLabMergeRequestApiPath,
} from "../../../../source-control/gitlab/merge-requests";
import { protectedProcedure } from "../../../index";
import {
	resolveGithubRepo,
	resolveGitLabRepo,
} from "../../workspace-creation/shared/project-helpers";
import { fetchPullRequestDiff } from "../shared/fetch-pull-request-diff";

const getDiffInputSchema = z.object({
	projectId: z.string(),
	prNumber: z.number().int().positive(),
	provider: z.enum(["github", "gitlab"]).optional(),
	instance: z.string().optional(),
	repoPath: z.string().optional(),
});

export const getDiff = protectedProcedure
	.input(getDiffInputSchema)
	.query(async ({ ctx, input }) => {
		if (input.provider === "gitlab") {
			const identity = await resolveGitLabRepo(ctx, input.projectId);
			assertGitLabIdentity(identity, input);
			const patch = await ctx.gitlab.api<string>(
				identity,
				`${gitLabMergeRequestApiPath(identity, input.prNumber)}/raw_diffs`,
				{ raw: true, timeout: 30_000, maxBuffer: 200 * 1024 * 1024 },
			);
			return { patch };
		}
		try {
			const repo = await resolveGithubRepo(ctx, input.projectId);
			return await fetchPullRequestDiff(
				`${repo.owner}/${repo.name}`,
				input.prNumber,
			);
		} catch (err) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Failed to fetch diff for PR #${input.prNumber}: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	});
