import { z } from "zod";
import {
	assertGitLabIdentity,
	getGitLabMergeRequestContent,
} from "../../../../source-control/gitlab/merge-requests";
import { protectedProcedure } from "../../../index";
import {
	resolveGithubRepo,
	resolveGitLabRepo,
} from "../../workspace-creation/shared/project-helpers";
import { fetchPullRequestContent } from "../shared/fetch-pull-request-content";

const getContentInputSchema = z.object({
	projectId: z.string(),
	prNumber: z.number().int().positive(),
	provider: z.enum(["github", "gitlab"]).optional(),
	instance: z.string().optional(),
	repoPath: z.string().optional(),
});

export const getContent = protectedProcedure
	.input(getContentInputSchema)
	.query(async ({ ctx, input }) => {
		if (input.provider === "gitlab") {
			const identity = await resolveGitLabRepo(ctx, input.projectId);
			assertGitLabIdentity(identity, input);
			return getGitLabMergeRequestContent(ctx.gitlab, identity, input.prNumber);
		}
		const repo = await resolveGithubRepo(ctx, input.projectId);
		return fetchPullRequestContent(repo, input.prNumber);
	});
