import type { RepositoryIdentity } from "@superset/shared/source-control";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type {
	CommentInput,
	CreateRequestInput,
	MergeInput,
	ReplyInput,
	RequestTarget,
	SourceControlProviderClient,
	ThreadResolutionInput,
} from "../types";
import { GitLabError } from "./exec-glab";
import type { GitLabClient } from "./gitlab";
import {
	getGitLabMergeRequest,
	getGitLabMergeRequestContent,
	getGitLabMergeRequestThreads,
	gitLabMergeRequestApiPath,
	gitLabProjectApiPath,
} from "./merge-requests";

const gitlabIssueContentSchema = z.object({
	iid: z.number().int().positive(),
	title: z.string(),
	description: z.string().nullable().optional(),
	web_url: z.string().url(),
	state: z.string(),
	author: z.object({ username: z.string() }).nullable().optional(),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
});

export function createGitLabProvider(options: {
	resolveRepository: () => Promise<RepositoryIdentity>;
	gitlab: GitLabClient;
}) {
	const { resolveRepository } = options;
	return {
		getRepository: resolveRepository,
		async create(input: CreateRequestInput) {
			const identity = await resolveRepository();
			const result = await options.gitlab.api<{ iid: number; web_url: string }>(
				identity,
				`${gitLabProjectApiPath(identity)}/merge_requests`,
				{
					method: "POST",
					fields: {
						source_branch: input.head,
						target_branch: input.base,
						title: input.draft ? `Draft: ${input.title}` : input.title,
						...(input.body ? { description: input.body } : {}),
					},
				},
			);
			return { number: result.iid, url: result.web_url };
		},
		async getContent(input: RequestTarget) {
			const identity = await resolveRepository();
			return getGitLabMergeRequestContent(
				options.gitlab,
				identity,
				input.prNumber,
			);
		},
		async getDiff(input: RequestTarget) {
			const identity = await resolveRepository();
			const patch = await options.gitlab.api<string>(
				identity,
				`${gitLabMergeRequestApiPath(identity, input.prNumber)}/raw_diffs`,
				{ raw: true, timeout: 30_000, maxBuffer: 200 * 1024 * 1024 },
			);
			return { patch };
		},
		async getThreads(input: RequestTarget) {
			const identity = await resolveRepository();
			try {
				return {
					reviewThreads: await getGitLabMergeRequestThreads(
						options.gitlab,
						identity,
						input.prNumber,
					),
					fetchFailed: false,
				};
			} catch {
				return { reviewThreads: [], fetchFailed: true };
			}
		},
		async addComment(input: CommentInput) {
			const identity = await resolveRepository();
			const requestPath = gitLabMergeRequestApiPath(identity, input.prNumber);
			if (input.position) {
				const mergeRequest = await getGitLabMergeRequest(
					options.gitlab,
					identity,
					input.prNumber,
				);
				if (mergeRequest.sha !== input.position.headSha) {
					throw new TRPCError({
						code: "CONFLICT",
						message:
							"The merge request changed since it was reviewed. Refresh and try again.",
					});
				}
				const refs = mergeRequest.diff_refs;
				if (
					!refs?.base_sha ||
					!refs.start_sha ||
					!refs.head_sha ||
					refs.head_sha !== input.position.headSha
				) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message:
							"Merge request diff positions are not ready. Refresh and try again.",
					});
				}
				const response = await options.gitlab.api<{
					id: string;
					notes: Array<{ id: number }>;
				}>(identity, `${requestPath}/discussions`, {
					method: "POST",
					fields: {
						body: input.body,
						position: {
							position_type: "text",
							base_sha: refs.base_sha,
							start_sha: refs.start_sha,
							head_sha: refs.head_sha,
							old_path: input.position.oldPath ?? input.position.path,
							new_path: input.position.path,
							...(input.position.side === "LEFT"
								? { old_line: input.position.line }
								: { new_line: input.position.line }),
						},
					},
				});
				return {
					id: response.id,
					url: `${identity.url}/-/merge_requests/${input.prNumber}#note_${response.notes[0]?.id ?? ""}`,
				};
			}
			const response = await options.gitlab.api<{ id: number }>(
				identity,
				`${requestPath}/notes`,
				{ method: "POST", fields: { body: input.body } },
			);
			return {
				id: String(response.id),
				url: `${identity.url}/-/merge_requests/${input.prNumber}#note_${response.id}`,
			};
		},
		async replyToThread(input: ReplyInput) {
			if (!input.discussionId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "GitLab discussion ID is required",
				});
			}
			const identity = await resolveRepository();
			return options.gitlab.api(
				identity,
				`${gitLabMergeRequestApiPath(identity, input.prNumber)}/discussions/${encodeURIComponent(input.discussionId)}/notes`,
				{ method: "POST", fields: { body: input.body } },
			);
		},
		async setThreadResolution(input: ThreadResolutionInput) {
			if (!input.projectId || !input.prNumber) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "GitLab project and merge request are required",
				});
			}
			const identity = await resolveRepository();
			await options.gitlab.api(
				identity,
				`${gitLabMergeRequestApiPath(identity, input.prNumber)}/discussions/${encodeURIComponent(input.threadId)}`,
				{ method: "PUT", fields: { resolved: input.resolved } },
			);
			return { threadId: input.threadId, isResolved: input.resolved };
		},
		async markReady(input: RequestTarget) {
			const identity = await resolveRepository();
			await options.gitlab.api(
				identity,
				`${gitLabMergeRequestApiPath(identity, input.prNumber)}/notes`,
				{ method: "POST", fields: { body: "/ready" } },
			);
			return { ok: true };
		},
		async setState(input: RequestTarget & { state: "open" | "closed" }) {
			const identity = await resolveRepository();
			await options.gitlab.api(
				identity,
				gitLabMergeRequestApiPath(identity, input.prNumber),
				{
					method: "PUT",
					fields: {
						state_event: input.state === "closed" ? "close" : "reopen",
					},
				},
			);
			return { ok: true };
		},
		async merge(input: MergeInput) {
			const identity = await resolveRepository();
			if (!input.headSha) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "A reviewed head SHA is required to merge a GitLab request",
				});
			}
			if (input.mergeMethod === "rebase") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Rebase merge is not available through the GitLab merge request API",
				});
			}
			try {
				return await options.gitlab.api(
					identity,
					`${gitLabMergeRequestApiPath(identity, input.prNumber)}/merge`,
					{
						method: "PUT",
						fields: {
							sha: input.headSha,
							squash: input.mergeMethod === "squash",
							...(input.commitMessage
								? { merge_commit_message: input.commitMessage }
								: {}),
						},
					},
				);
			} catch (error) {
				if (error instanceof GitLabError && error.kind === "CONFLICT") {
					throw new TRPCError({
						code: "CONFLICT",
						message:
							"The merge request changed since it was reviewed. Refresh and try again.",
					});
				}
				throw error;
			}
		},
		async getIssueContent(input: { issueNumber: number }) {
			const repo = await resolveRepository();
			const project = encodeURIComponent(
				String(repo.projectId ?? repo.repoPath),
			);
			const data = gitlabIssueContentSchema.parse(
				await options.gitlab.api<unknown>(
					repo,
					`projects/${project}/issues/${input.issueNumber}`,
				),
			);
			return {
				number: data.iid,
				title: data.title,
				body: data.description ?? "",
				url: data.web_url,
				state: data.state === "opened" ? "open" : "closed",
				author: data.author?.username ?? null,
				createdAt: data.created_at,
				updatedAt: data.updated_at,
				provider: "gitlab" as const,
				instance: repo.instance,
				repoPath: repo.repoPath,
			};
		},
	} satisfies SourceControlProviderClient;
}
