import { z } from "zod";
import { protectedProcedure } from "../../../index";
import { createProjectForge } from "../../utils/project-forge";

export const markReady = protectedProcedure
	.input(
		z.object({
			projectId: z.string(),
			prNumber: z.number().int().positive(),
			provider: z.enum(["github", "gitlab"]).optional(),
			instance: z.string().optional(),
			repoPath: z.string().optional(),
		}),
	)
	.mutation(async ({ ctx, input }) =>
		createProjectForge(ctx, input).markReady(input),
	);
