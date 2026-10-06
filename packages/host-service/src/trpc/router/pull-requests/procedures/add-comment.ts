import { z } from "zod";
import { protectedProcedure } from "../../../index";
import { createProjectForge } from "../../utils/project-forge";

const addCommentInputSchema = z.object({
	projectId: z.string(),
	prNumber: z.number().int().positive(),
	provider: z.enum(["github", "gitlab"]).optional(),
	instance: z.string().optional(),
	repoPath: z.string().optional(),
	body: z.string().trim().min(1),
	position: z
		.object({
			path: z.string().min(1),
			oldPath: z.string().min(1).optional(),
			line: z.number().int().positive(),
			side: z.enum(["LEFT", "RIGHT"]),
			headSha: z.string().regex(/^[a-f\d]{40,64}$/i),
		})
		.optional(),
});

export const addComment = protectedProcedure
	.input(addCommentInputSchema)
	.mutation(async ({ ctx, input }) =>
		createProjectForge(ctx, input).addComment(input),
	);
