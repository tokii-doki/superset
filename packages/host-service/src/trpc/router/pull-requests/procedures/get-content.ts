import { z } from "zod";
import { protectedProcedure } from "../../../index";
import { createProjectForge } from "../../utils/project-forge";

const getContentInputSchema = z.object({
	projectId: z.string(),
	prNumber: z.number().int().positive(),
	provider: z.enum(["github", "gitlab"]).optional(),
	instance: z.string().optional(),
	repoPath: z.string().optional(),
});

export const getContent = protectedProcedure
	.input(getContentInputSchema)
	.query(async ({ ctx, input }) =>
		createProjectForge(ctx, input).getContent(input),
	);
