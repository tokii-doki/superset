import type { Octokit } from "@octokit/rest";
import type { RepositoryIdentity } from "@superset/shared/source-control";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	type GraphQLThreadsResult,
	parseGraphQLThreads,
	REVIEW_THREADS_QUERY,
} from "../../trpc/router/git/utils/graphql";
import { replyToReviewComment } from "../../trpc/router/git/utils/reply-to-review-comment";
import { actionRejectionError } from "../../trpc/router/github/github";
import { fetchPullRequestContent } from "../../trpc/router/pull-requests/shared/fetch-pull-request-content";
import { fetchPullRequestDiff } from "../../trpc/router/pull-requests/shared/fetch-pull-request-diff";
import type { ExecGh } from "../../trpc/router/workspace-creation/utils/exec-gh";
import type {
	CommentInput,
	CreateRequestInput,
	MergeInput,
	ReplyInput,
	RequestTarget,
	SourceControlProviderClient,
	ThreadResolutionInput,
} from "../types";

const ghIssueContentSchema = z.object({
	number: z.number(),
	title: z.string(),
	body: z.string().nullable().optional(),
	url: z.string(),
	state: z.string(),
	author: z.object({ login: z.string() }).optional(),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
});

export function createGitHubProvider(options: {
	resolveRepository: () => Promise<RepositoryIdentity>;
	github: () => Promise<Octokit>;
	execGh: ExecGh;
}) {
	const { resolveRepository } = options;
	return {
		getRepository: resolveRepository,
		async create(input: CreateRequestInput) {
			const repo = await resolveRepository();
			const octokit = await options.github();
			try {
				const { data } = await octokit.pulls.create({
					owner: repo.owner,
					repo: repo.name,
					title: input.title,
					head: input.head,
					base: input.base,
					draft: input.draft,
					...(input.body ? { body: input.body } : {}),
				});
				return { number: data.number, url: data.html_url };
			} catch (error) {
				throw actionRejectionError(
					error,
					"GitHub refused to create the pull request.",
				);
			}
		},
		async getContent(input: RequestTarget) {
			const repo = await resolveRepository();
			return fetchPullRequestContent(repo, input.prNumber);
		},
		async getDiff(input: RequestTarget) {
			try {
				const repo = await resolveRepository();
				return await fetchPullRequestDiff(
					`${repo.owner}/${repo.name}`,
					input.prNumber,
				);
			} catch (err) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `Failed to fetch diff for PR #${input.prNumber}: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		},
		async getThreads(input: RequestTarget) {
			const repo = await resolveRepository();
			const octokit = await options.github();

			try {
				const result: GraphQLThreadsResult = await octokit.graphql(
					REVIEW_THREADS_QUERY,
					{ owner: repo.owner, name: repo.name, prNumber: input.prNumber },
				);
				return {
					reviewThreads: parseGraphQLThreads(result),
					fetchFailed: false,
				};
			} catch (error) {
				console.warn(
					`[pullRequests.getThreads] Failed to fetch review threads for PR #${input.prNumber}:`,
					error,
				);
				return { reviewThreads: [], fetchFailed: true };
			}
		},
		async addComment(input: CommentInput) {
			const repo = await resolveRepository();
			const octokit = await options.github();
			if (input.position) {
				const { data } = await octokit.pulls.createReviewComment({
					owner: repo.owner,
					repo: repo.name,
					pull_number: input.prNumber,
					body: input.body,
					commit_id: input.position.headSha,
					path: input.position.path,
					line: input.position.line,
					side: input.position.side,
				});
				return { id: String(data.id), url: data.html_url };
			}
			const { data } = await octokit.issues.createComment({
				owner: repo.owner,
				repo: repo.name,
				issue_number: input.prNumber,
				body: input.body,
			});
			return { id: String(data.id), url: data.html_url };
		},
		async replyToThread(input: ReplyInput) {
			if (!input.commentId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Review comment ID is required",
				});
			}
			const repo = await resolveRepository();
			const octokit = await options.github();
			return replyToReviewComment(octokit, {
				owner: repo.owner,
				repo: repo.name,
				prNumber: input.prNumber,
				commentId: input.commentId,
				body: input.body,
			});
		},
		async setThreadResolution(input: ThreadResolutionInput) {
			const octokit = await options.github();
			const mutation = input.resolved
				? `mutation($threadId: ID!) {
					resolveReviewThread(input: {threadId: $threadId}) {
						thread { id isResolved }
					}
				}`
				: `mutation($threadId: ID!) {
					unresolveReviewThread(input: {threadId: $threadId}) {
						thread { id isResolved }
					}
				}`;

			try {
				await octokit.graphql(mutation, { threadId: input.threadId });
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "GraphQL mutation failed";
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
			}

			return { threadId: input.threadId, isResolved: input.resolved };
		},
		async markReady(input: RequestTarget) {
			const repo = await resolveRepository();
			await options.execGh([
				"pr",
				"ready",
				String(input.prNumber),
				"--repo",
				`${repo.owner}/${repo.name}`,
			]);
			return { ok: true };
		},
		async setState(input: RequestTarget & { state: "open" | "closed" }) {
			const repo = await resolveRepository();
			const verb = input.state === "closed" ? "close" : "reopen";
			try {
				await options.execGh([
					"pr",
					verb,
					String(input.prNumber),
					"--repo",
					`${repo.owner}/${repo.name}`,
				]);
			} catch (err) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `Failed to ${verb} PR #${input.prNumber}: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
			return { ok: true };
		},
		async merge(input: MergeInput) {
			const repo = await resolveRepository();
			const octokit = await options.github();
			let merged: Awaited<ReturnType<typeof octokit.pulls.merge>>["data"];
			try {
				const { data } = await octokit.pulls.merge({
					owner: repo.owner,
					repo: repo.name,
					pull_number: input.prNumber,
					merge_method: input.mergeMethod,
					...(input.commitMessage
						? { commit_message: input.commitMessage }
						: {}),
				});
				merged = data;
			} catch (error) {
				throw actionRejectionError(error, "GitHub refused the merge.");
			}
			return merged;
		},
		async getIssueContent(input: { issueNumber: number }) {
			const repo = await resolveRepository();
			try {
				const raw = await options.execGh([
					"issue",
					"view",
					String(input.issueNumber),
					"--repo",
					`${repo.owner}/${repo.name}`,
					"--json",
					"number,title,body,url,state,author,createdAt,updatedAt",
				]);
				const data = ghIssueContentSchema.parse(raw);
				return {
					number: data.number,
					title: data.title,
					body: data.body ?? "",
					url: data.url,
					state: data.state.toLowerCase(),
					author: data.author?.login ?? null,
					createdAt: data.createdAt,
					updatedAt: data.updatedAt,
				};
			} catch (err) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `Failed to fetch issue #${input.issueNumber}: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		},
	} satisfies SourceControlProviderClient;
}
