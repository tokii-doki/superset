import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { pullRequests } from "../../../../db/schema";
import { createUserSimpleGit } from "../../../../runtime/git/simple-git";
import type { HostServiceContext } from "../../../../types";
import { createCallerFactory, router } from "../../../index";
import {
	createTestDb,
	PR_NUMBER,
	PROJECT_ID,
	REPO,
	seedLinkedPullRequest,
	UNLINKED_PR_NUMBER,
} from "../shared/test-db";
import { getLinkedWorkspace } from "./get-linked-workspace";

const tempDirs: string[] = [];
afterAll(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

async function createRepoWithOrigin(): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), "pr-linked-test-"));
	tempDirs.push(dir);
	const git = createUserSimpleGit(dir);
	await git.init();
	await git.addConfig("user.email", "test@test.local");
	await git.addConfig("user.name", "Test");
	await git.raw(["commit", "--allow-empty", "-m", "init"]);
	await git.addRemote(
		"origin",
		`https://github.com/${REPO.owner}/${REPO.name}.git`,
	);
	return (await git.revparse(["--show-toplevel"])).trim();
}

const createCaller = createCallerFactory(router({ getLinkedWorkspace }));

function callerFor(db: ReturnType<typeof createTestDb>) {
	return createCaller({
		db,
		isAuthenticated: true,
		organizationId: "org-test",
	} as unknown as HostServiceContext);
}

describe("pullRequests.getLinkedWorkspace", () => {
	test("keeps GitLab links isolated from GitHub and other GitLab instances", async () => {
		const db = createTestDb();
		seedLinkedPullRequest(db, "/nonexistent/checkout");
		db.update(pullRequests)
			.set({
				repoProvider: "gitlab",
				repoInstance: "https://gitlab.example.com",
			})
			.where(eq(pullRequests.id, "pr-42"))
			.run();
		const caller = callerFor(db);

		expect(
			await caller.getLinkedWorkspace({
				projectId: PROJECT_ID,
				prNumber: PR_NUMBER,
				provider: "gitlab",
				instance: "https://gitlab.example.com",
			}),
		).toEqual({ workspaceId: "ws-newer" });
		expect(
			await caller.getLinkedWorkspace({
				projectId: PROJECT_ID,
				prNumber: PR_NUMBER,
			}),
		).toEqual({ workspaceId: null });
		expect(
			await caller.getLinkedWorkspace({
				projectId: PROJECT_ID,
				prNumber: PR_NUMBER,
				provider: "gitlab",
				instance: "https://other.gitlab.example.com",
			}),
		).toEqual({ workspaceId: null });
	});

	test("answers the most recently active linked workspace through the repository", async () => {
		const db = createTestDb();
		seedLinkedPullRequest(db, await createRepoWithOrigin());

		expect(
			await callerFor(db).getLinkedWorkspace({
				projectId: PROJECT_ID,
				prNumber: PR_NUMBER,
			}),
		).toEqual({ workspaceId: "ws-newer" });
	});

	test("still answers an existing link when the checkout is unavailable", async () => {
		const db = createTestDb();
		seedLinkedPullRequest(db, "/nonexistent/checkout");

		expect(
			await callerFor(db).getLinkedWorkspace({
				projectId: PROJECT_ID,
				prNumber: PR_NUMBER,
			}),
		).toEqual({ workspaceId: "ws-newer" });
	});

	test("answers none for a PR with a row but no live workspace", async () => {
		const db = createTestDb();
		seedLinkedPullRequest(db, "/nonexistent/checkout");

		expect(
			await callerFor(db).getLinkedWorkspace({
				projectId: PROJECT_ID,
				prNumber: UNLINKED_PR_NUMBER,
			}),
		).toEqual({ workspaceId: null });
	});
});
