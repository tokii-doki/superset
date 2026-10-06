import { z } from "zod";
import { protectedProcedure } from "../../../index";
import { createProjectForge } from "../../utils/project-forge";

const replyToThreadInputSchema = z.object({
	projectId: z.string(),
	prNumber: z.number().int().positive(),
	provider: z.enum(["github", "gitlab"]).optional(),
	instance: z.string().optional(),
	repoPath: z.string().optional(),
	discussionId: z.string().optional(),
	/** REST databaseId of any comment already in the thread — GitHub's
	 *  reply endpoint threads the new comment onto it regardless of which
	 *  comment in the thread you target. */
	commentId: z.number().int().positive().optional(),
	body: z.string().trim().min(1),
});

export const replyToThread = protectedProcedure
	.input(replyToThreadInputSchema)
	.mutation(async ({ ctx, input }) =>
		createProjectForge(ctx, input).replyToThread(input),
	);
