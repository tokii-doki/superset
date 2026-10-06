import { describe, expect, test } from "bun:test";
import type { Octokit } from "@octokit/rest";
import type {
	RepositoryIdentity,
	SourceControlProvider,
} from "@superset/shared/source-control";
import { createGitLabClient } from "./gitlab/gitlab";
import { resolveSourceControlProvider } from "./index";

describe("source control adapters", () => {
	test.each([
		"github",
		"gitlab",
	] as const)("%s exposes issue reads and request creation without calling the other provider", async (provider) => {
		const repository: RepositoryIdentity = {
			provider,
			instance:
				provider === "github"
					? "https://github.com"
					: "https://gitlab.example.com",
			repoPath: "team/repo",
			owner: "team",
			name: "repo",
			url:
				provider === "github"
					? "https://github.com/team/repo"
					: "https://gitlab.example.com/team/repo",
		};
		const url = `${repository.url}/request/12`;
		const calls: unknown[] = [];
		const client = resolveSourceControlProvider(provider, {
			resolveRepository: async () => repository,
			github: async () => {
				expect(provider).toBe("github");
				return {
					pulls: {
						create: async (input: unknown) => {
							calls.push(input);
							return { data: { number: 12, html_url: url } };
						},
					},
				} as unknown as Octokit;
			},
			execGh: async (args) => {
				expect(provider).toBe("github");
				expect(args.slice(0, 5)).toEqual([
					"issue",
					"view",
					"12",
					"--repo",
					"team/repo",
				]);
				return {
					number: 12,
					title: "Fix parser",
					body: null,
					state: "OPEN",
					url,
				};
			},
			gitlab: createGitLabClient({
				runner: async (input) => {
					expect(provider).toBe("gitlab");
					expect(input.instance).toBe(repository.instance);
					if (input.method === "POST") {
						calls.push(input.fields);
						return { iid: 12, web_url: url };
					}
					expect(input.endpoint).toBe("projects/team%2Frepo/issues/12");
					return {
						iid: 12,
						title: "Fix parser",
						description: null,
						state: "opened",
						web_url: url,
					};
				},
			}),
		});

		expect(await client.getIssueContent({ issueNumber: 12 })).toMatchObject({
			number: 12,
			title: "Fix parser",
			body: "",
			state: "open",
			author: null,
		});
		expect(
			await client.create({
				title: "Fix parser",
				draft: true,
				head: "feature",
				base: "main",
			}),
		).toEqual({ number: 12, url });
		expect(calls).toEqual([
			provider === "github"
				? {
						owner: "team",
						repo: "repo",
						title: "Fix parser",
						draft: true,
						head: "feature",
						base: "main",
					}
				: {
						title: "Draft: Fix parser",
						source_branch: "feature",
						target_branch: "main",
					},
		]);
	});

	test("rejects an unregistered provider before resolving a repository or credentials", () => {
		const unexpected = async (): Promise<never> => {
			throw new Error("Provider was called");
		};
		const options = {
			resolveRepository: unexpected,
			github: unexpected,
			execGh: unexpected,
			gitlab: createGitLabClient({ runner: unexpected }),
		};
		expect(() =>
			resolveSourceControlProvider("forgejo" as SourceControlProvider, options),
		).toThrow("Unsupported source control provider");
		expect(() =>
			resolveSourceControlProvider(
				"toString" as SourceControlProvider,
				options,
			),
		).toThrow("Unsupported source control provider");
	});
});
