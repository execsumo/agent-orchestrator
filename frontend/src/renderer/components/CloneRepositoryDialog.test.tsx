import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import CloneRepositoryDialog, { joinCloneDestination, repositoryNameFromGitUrl } from "./CloneRepositoryDialog";
import { aoBridge } from "../lib/bridge";

vi.mock("../lib/bridge", () => ({
	aoBridge: {
		capabilities: { nativeFileDialogs: true },
		app: { chooseDirectory: vi.fn() },
	}
}));

const noop = { onBack: () => {}, onChange: () => {}, onClose: () => {}, onContinue: () => {} };


describe("clone repository input", () => {
	it.each([
		["https://github.com/acme/web-app.git", "web-app"],
		["ssh://git@github.com/acme/web-app.git", "web-app"],
		["git@github.com:acme/web-app.git", "web-app"],
		["file:///tmp/web-app", "web-app"],
		["file:///tmp/my%20repo.git", "my repo"],
		["https://github.com/acme/nested%2Frepo.git", "repo"],
		["file:///tmp/literal%252Frepo.git", "literal%2Frepo"],
	])("derives the checkout name from %s", (remoteUrl, expected) => {
		expect(repositoryNameFromGitUrl(remoteUrl)).toBe(expected);
	});

	it.each([
		"repository-without-a-scheme",
		"--upload-pack=malicious",
		"https://user:secret@example.com/acme/repo.git",
		"https://example.com/acme/repo.git?access_token=secret",
		"ssh://git:secret@example.com/acme/repo.git",
		"https://github.com/acme/two words.git",
		"file:///tmp/bad%ZZ.git",
	])("rejects unsafe or incomplete URL %s", (remoteUrl) => {
		expect(repositoryNameFromGitUrl(remoteUrl)).toBeNull();
	});

	it("joins POSIX and Windows destinations", () => {
		expect(joinCloneDestination("/Users/me/Code/", "web-app")).toBe("/Users/me/Code/web-app");
		expect(joinCloneDestination("C:\\Code\\", "web-app")).toBe("C:\\Code\\web-app");
	});
});

describe("CloneRepositoryDialog UI fallback", () => {
	it("shows choose folder button when nativeFileDialogs is true", () => {
		(aoBridge.capabilities as any).nativeFileDialogs = true;
		render(
			<CloneRepositoryDialog
				{...noop}
				disabled={false}
				error={null}
				open={true}
				value={{ remoteUrl: "", destinationParent: "" }}
			/>
		);
		expect(screen.getByRole("button", { name: "Choose" })).toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: "Clone into" })).toHaveAttribute("readonly");
	});

	it("shows path input when nativeFileDialogs is false", () => {
		(aoBridge.capabilities as any).nativeFileDialogs = false;
		render(
			<CloneRepositoryDialog
				{...noop}
				disabled={false}
				error={null}
				open={true}
				value={{ remoteUrl: "", destinationParent: "" }}
			/>
		);
		expect(screen.queryByRole("button", { name: "Choose" })).not.toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: "Clone into" })).toBeInTheDocument();
	});
});
