import { z } from "zod";
import { protectedProcedure } from "../../../index";
import { createProjectForge } from "../../utils/project-forge";

const getThreadsInputSchema = z.object({
	projectId: z.string(),
	prNumber: z.number().int().positive(),
	provider: z.enum(["github", "gitlab"]).optional(),
	instance: z.string().optional(),
	repoPath: z.string().optional(),
});

export const getThreads = protectedProcedure
	.input(getThreadsInputSchema)
	.query(async ({ ctx, input }) =>
		createProjectForge(ctx, input).getThreads(input),
	);
