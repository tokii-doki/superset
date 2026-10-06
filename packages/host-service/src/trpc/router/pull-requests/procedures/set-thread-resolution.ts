import { z } from "zod";
import { protectedProcedure } from "../../../index";
import { createProjectForge } from "../../utils/project-forge";

const setThreadResolutionInputSchema = z.object({
	threadId: z.string(),
	resolved: z.boolean(),
	provider: z.enum(["github", "gitlab"]).optional(),
	projectId: z.string().optional(),
	prNumber: z.number().int().positive().optional(),
	instance: z.string().optional(),
	repoPath: z.string().optional(),
});

export const setThreadResolution = protectedProcedure
	.input(setThreadResolutionInputSchema)
	.mutation(async ({ ctx, input }) =>
		createProjectForge(ctx, input).setThreadResolution(input),
	);
