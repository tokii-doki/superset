import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { Octokit } from "@octokit/rest";
import type { HostServiceContext } from "../../../../types";
import { createCallerFactory, router } from "../../../index";
import * as projects from "../../workspace-creation/shared/project-helpers";
import {
	pullRequestContentCacheKey,
	readPullRequestContentCache,
	writePullRequestContentCache,
} from "../shared/pull-request-content-cache";
import { addComment } from "./add-comment";

afterEach(() => mock.restore());

function setup() {
	const createComment = mock(async (_input: unknown) => ({
		data: {
			id: 1,
			html_url: "https://github.com/owner/repo/pull/12#issuecomment-1",
		},
	}));
	const caller = createCallerFactory(router({ addComment }))({
		isAuthenticated: true,
		github: async () => ({ issues: { createComment } }) as unknown as Octokit,
	} as HostServiceContext);
	spyOn(projects, "resolveGithubRepo").mockResolvedValue({
		owner: "owner",
		name: "repo",
		repoPath: "/unused",
	});
	return { caller, createComment };
}

test("posts the trimmed body once and evicts stale content while preserving the comment identity", async () => {
	const { caller, createComment } = setup();
	const key = pullRequestContentCacheKey({ owner: "owner", name: "repo" }, 12);
	writePullRequestContentCache(key, Promise.resolve({ state: "open" }));
	expect(
		await caller.addComment({ projectId: "p", prNumber: 12, body: "  LGTM  " }),
	).toEqual({
		ok: true,
		id: "1",
		url: "https://github.com/owner/repo/pull/12#issuecomment-1",
	});
	expect(createComment).toHaveBeenCalledTimes(1);
	expect(createComment).toHaveBeenCalledWith({
		owner: "owner",
		repo: "repo",
		issue_number: 12,
		body: "LGTM",
	});
	expect(readPullRequestContentCache(key)).toBeNull();
});

test("rejects an empty body before calling the provider", async () => {
	const { caller, createComment } = setup();
	await expect(
		caller.addComment({ projectId: "p", prNumber: 12, body: "   " }),
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
	expect(createComment).not.toHaveBeenCalled();
});
