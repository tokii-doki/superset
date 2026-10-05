import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { cloudTrpcClient } from "renderer/lib/cloud-trpc";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { assertGitLabHostSupport } from "renderer/lib/host-service-gitlab";
import { combinePullRequestReadErrors } from "../../../../utils/combinePullRequestReadErrors";
import { fromHostPullRequestContent } from "../../../../utils/fromHostPullRequestContent";

export async function fetchPullRequestDetail({
	projectId,
	hostUrl,
	repoFullName,
	organizationId,
	prNumber,
	provider = "github",
	instance,
	repoPath,
}: {
	projectId: string | null;
	hostUrl: string | null;
	repoFullName: string | null;
	organizationId: string | null;
	prNumber: number;
	provider?: "github" | "gitlab";
	instance?: string;
	repoPath?: string;
}) {
	if (provider === "gitlab") {
		if (!projectId)
			throw new Error(
				i18n._(
					msg({ message: "This request does not match the selected project." }),
				),
			);
		if (!hostUrl)
			throw new Error(
				i18n._(
					msg({
						message: "The device that hosts this project is unavailable.",
					}),
				),
			);
		await assertGitLabHostSupport(hostUrl);
		const content = await getHostServiceClientByUrl(
			hostUrl,
		).pullRequests.getContent.query({
			provider,
			projectId,
			prNumber,
			instance: instance ?? "",
			repoPath: repoPath ?? repoFullName ?? "",
		});
		return fromHostPullRequestContent(content);
	}
	let repositoryError: unknown;
	if (hostUrl && projectId) {
		try {
			const content = await getHostServiceClientByUrl(
				hostUrl,
			).pullRequests.getContent.query({ projectId, prNumber });
			return fromHostPullRequestContent(content);
		} catch (error) {
			if (!repoFullName) throw error;
		}
	}
	if (hostUrl && repoFullName) {
		try {
			const content = await getHostServiceClientByUrl(
				hostUrl,
			).pullRequests.getContentByRepo.query({ repoFullName, prNumber });
			return fromHostPullRequestContent(content);
		} catch (error) {
			if (!organizationId) throw error;
			repositoryError = error;
		}
	}
	if (!organizationId || !repoFullName)
		throw new Error("No GitHub repository available to fetch the pull request");
	try {
		return await cloudTrpcClient.integration.github.getPullRequest.query({
			organizationId,
			repoFullName,
			number: prNumber,
		});
	} catch (error) {
		throw combinePullRequestReadErrors(repositoryError, error);
	}
}
