import { z } from "zod";
import { protectedProcedure } from "../../../index";
import { createProjectForge } from "../../utils/project-forge";

const mergeInputSchema = z.object({
	projectId: z.string(),
	prNumber: z.number().int().positive(),
	provider: z.enum(["github", "gitlab"]).optional(),
	instance: z.string().optional(),
	repoPath: z.string().optional(),
	headSha: z
		.string()
		.regex(/^[a-f\d]{40,64}$/i)
		.optional(),
	mergeMethod: z.enum(["merge", "squash", "rebase"]).default("merge"),
	commitMessage: z.string().trim().min(1).optional(),
});

export const mergePR = protectedProcedure
	.input(mergeInputSchema)
	.mutation(async ({ ctx, input }) =>
		createProjectForge(ctx, input).merge(input),
	);
