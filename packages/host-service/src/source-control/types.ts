import type { PullRequestDiff } from "@superset/shared/pull-request-diff";
import type { RepositoryIdentity } from "@superset/shared/source-control";
import type { PullRequestReviewThread } from "../trpc/router/git/types";

export interface RequestTarget {
	prNumber: number;
}

export interface CommentInput extends RequestTarget {
	body: string;
	position?: {
		path: string;
		oldPath?: string;
		line: number;
		side: "LEFT" | "RIGHT";
		headSha: string;
	};
}

export interface ReplyInput extends RequestTarget {
	body: string;
	discussionId?: string;
	commentId?: number;
}

export interface ThreadResolutionInput {
	threadId: string;
	resolved: boolean;
	projectId?: string;
	prNumber?: number;
}

export interface MergeInput extends RequestTarget {
	headSha?: string;
	mergeMethod: "merge" | "squash" | "rebase";
	commitMessage?: string;
}

export interface IssueContent {
	number: number;
	title: string;
	body: string;
	url: string;
	state: string;
	author: string | null;
	createdAt: string | undefined;
	updatedAt: string | undefined;
}

export interface ChangeRequestContent extends IssueContent {
	branch: string;
	baseBranch: string;
	headRepositoryOwner: string | null;
	isCrossRepository: boolean;
	isDraft: boolean;
	checks: Array<{ name: string; status: string; url: string | null }>;
	checksStatus: string;
	capabilities?: ChangeRequestCapabilities;
}

export interface ChangeRequestCapabilities {
	canMerge: boolean;
	mergeMethods: Array<MergeInput["mergeMethod"]>;
	canClose: boolean;
	canMarkReady: boolean;
	canReply: boolean;
	canResolve: boolean;
}

export interface CreateRequestInput {
	title: string;
	body?: string;
	draft: boolean;
	head: string;
	base: string;
}

export interface SourceControlProviderClient {
	create(input: CreateRequestInput): Promise<{ number: number; url: string }>;
	getRepository(): Promise<RepositoryIdentity>;
	getContent(input: RequestTarget): Promise<ChangeRequestContent>;
	getIssueContent(input: { issueNumber: number }): Promise<IssueContent>;
	getDiff(input: RequestTarget): Promise<PullRequestDiff>;
	getThreads(input: RequestTarget): Promise<{
		reviewThreads: PullRequestReviewThread[];
		fetchFailed: boolean;
	}>;
	addComment(input: CommentInput): Promise<{ id: string; url: string }>;
	replyToThread(input: ReplyInput): Promise<unknown>;
	setThreadResolution(input: ThreadResolutionInput): Promise<{
		threadId: string;
		isResolved: boolean;
	}>;
	markReady(input: RequestTarget): Promise<{ ok: boolean }>;
	setState(
		input: RequestTarget & { state: "open" | "closed" },
	): Promise<{ ok: boolean }>;
	merge(input: MergeInput): Promise<unknown>;
}
