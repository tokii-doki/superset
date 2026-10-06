import { z } from "zod";
import { protectedProcedure } from "../../../index";
import { createProjectForge } from "../../utils/project-forge";

const setStateInputSchema = z.object({
	projectId: z.string(),
	prNumber: z.number().int().positive(),
	provider: z.enum(["github", "gitlab"]).optional(),
	instance: z.string().optional(),
	repoPath: z.string().optional(),
	// Only open/closed — GitHub has no CLI verb to un-merge a PR, so a
	// merged state isn't reachable through this mutation.
	state: z.enum(["open", "closed"]),
});

export const setState = protectedProcedure
	.input(setStateInputSchema)
	.mutation(async ({ ctx, input }) =>
		createProjectForge(ctx, input).setState(input),
	);
