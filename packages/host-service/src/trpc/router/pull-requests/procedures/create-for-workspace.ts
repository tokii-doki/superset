import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { workspaces } from "../../../../db/schema";
import { createGitEnvResolver } from "../../../../runtime/git";
import { getHostWorkerPool } from "../../../../workers/host-worker-pool";
import { gitPrHeadBaseTask } from "../../../../workers/tasks/git";
import { protectedProcedure } from "../../../index";
import { resolveWorktreePath } from "../../git/utils/resolve-worktree";
import { createProjectForge } from "../../utils/project-forge";

const createInputSchema = z.object({
	workspaceId: z.string(),
	title: z.string().trim().min(1),
	body: z.string().optional(),
	draft: z.boolean().default(false),
	provider: z.enum(["github", "gitlab"]).optional(),
});

/**
 * Creates a PR or MR from the workspace's current branch. The base is the
 * branch's configured `branch.<name>.base` (what the Changes panel's base
 * selector writes) falling back to the repo default branch. After creation
 * the workspace's PR link is refreshed immediately so the UI doesn't wait
 * out the next background sync tick.
 */
export const createForWorkspace = protectedProcedure
	.input(createInputSchema)
	.mutation(async ({ ctx, input }) => {
		const workspace = ctx.db.query.workspaces
			.findFirst({ where: eq(workspaces.id, input.workspaceId) })
			.sync();
		if (!workspace?.projectId) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					"Workspace has no linked project, so there is no repository to open a pull request on",
			});
		}
		const worktreePath = resolveWorktreePath(ctx, input.workspaceId);
		const gitEnv = await createGitEnvResolver(ctx.credentials)(worktreePath);
		const refs = await getHostWorkerPool().run(
			gitPrHeadBaseTask,
			{ worktreePath, gitEnv },
			{ timeoutMs: 15_000 },
		);
		const head = refs.head;
		if (!head) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Cannot create a pull request from a detached HEAD",
			});
		}

		const base = (refs.configuredBase || refs.defaultBranch || "")
			.replace(/^origin\//, "")
			.trim();
		if (!base) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Could not determine a base branch for the pull request",
			});
		}
		if (base === head) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Branch ${head} is the base branch — nothing to open a pull request from`,
			});
		}

		const created = await createProjectForge(
			ctx,
			{ projectId: workspace.projectId, provider: input.provider },
			"repository",
		).create({ ...input, head, base });
		try {
			await ctx.runtime.pullRequests.refreshPullRequestsByWorkspaces([
				input.workspaceId,
			]);
		} catch (error) {
			console.warn(
				"[pull-requests:create-for-workspace] created request but failed to refresh workspace link",
				{ workspaceId: input.workspaceId, prNumber: created.number, error },
			);
		}
		return created;
	});
