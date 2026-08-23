import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateProjectFlow, type CloneProjectInput, type CreateProjectInput } from "./CreateProjectFlow";
import { aoBridge } from "../lib/bridge";

const bridgeMocks = vi.hoisted(() => ({
	checkAncestorRepo: vi.fn(),
	chooseDirectory: vi.fn(),
	scanImportFolder: vi.fn(),
}));

vi.mock("../lib/bridge", () => ({
	aoBridge: {
		capabilities: { nativeFileDialogs: true },
		app: {
			checkAncestorRepo: bridgeMocks.checkAncestorRepo,
			chooseDirectory: bridgeMocks.chooseDirectory,
			scanImportFolder: bridgeMocks.scanImportFolder,
		},
	},
}));

// Probe stand-in: the real sheet needs a QueryClientProvider + agent catalog to
// render. These tests only care which path/kind CreateProjectFlow hands it and
// whether it's open, so a thin stub keeps the suite fast and focused.
vi.mock("./CreateProjectAgentSheet", () => ({
	CreateProjectAgentSheet: ({
		kind,
		open,
		path,
		onSubmit,
	}: {
		kind: string;
		open: boolean;
		path: string | null;
		onSubmit: (selection: any) => Promise<void>;
	}) => (open ? (
		<div data-kind={kind} data-path={path ?? ""} data-testid="agent-sheet">
			<button onClick={() => onSubmit({ role: "developer" })}>Start</button>
		</div>
	) : null),
}));

// Probe stand-in: the real dialog needs its own form state and validation.
// These tests only care whether the clone flow is on screen and that the
// droppedPath guard leaves it alone, so a thin stub keeps the suite focused.
vi.mock("./CloneRepositoryDialog", () => ({
	default: ({ open }: { open: boolean }) => (open ? <div data-testid="clone-dialog" /> : null),
}));

function okScan(path: string) {
	return {
		path,
		repos: [
			{
				branch: "main",
				hasRemote: true,
				name: "proj",
				path,
				relativePath: ".",
				remote: "git@github.com:example/proj.git",
				status: "ok" as const,
			},
		],
	};
}

const noop = {
	onCloneProject: async (_input: CloneProjectInput) => undefined,
	onCreateProject: async (_input: CreateProjectInput) => undefined,
	onInitializeProject: async (_path: string) => undefined,
};

beforeEach(() => {
	if (aoBridge.capabilities) (aoBridge.capabilities as any).nativeFileDialogs = true;
	bridgeMocks.checkAncestorRepo.mockReset().mockResolvedValue(undefined);
	bridgeMocks.chooseDirectory.mockReset();
	bridgeMocks.scanImportFolder.mockReset().mockImplementation(async ({ path }: { path: string }) => okScan(path));
});

describe("CreateProjectFlow droppedPath", () => {
	it("does not open on mount", () => {
		render(<CreateProjectFlow mode="choose" {...noop} droppedPath={null} />);
		expect(screen.queryByRole("button", { name: "Add a workspace folder" })).not.toBeInTheDocument();
	});

	it("opens the mode picker without invoking the native folder chooser", async () => {
		const { rerender } = render(<CreateProjectFlow mode="choose" {...noop} droppedPath={null} />);

		rerender(<CreateProjectFlow mode="choose" {...noop} droppedPath={{ nonce: 1, path: "/dropped/proj" }} />);

		expect(await screen.findByRole("button", { name: "Open local repository" })).toBeInTheDocument();
		expect(bridgeMocks.chooseDirectory).not.toHaveBeenCalled();
	});

	it("uses the dropped path for preflight and opens the agent sheet, skipping the native dialog", async () => {
		const user = userEvent.setup();
		const { rerender } = render(<CreateProjectFlow mode="choose" {...noop} droppedPath={null} />);
		rerender(<CreateProjectFlow mode="choose" {...noop} droppedPath={{ nonce: 1, path: "/dropped/proj" }} />);

		await user.click(await screen.findByRole("button", { name: "Open local repository" }));

		await waitFor(() =>
			expect(bridgeMocks.scanImportFolder).toHaveBeenCalledWith({ mode: "project", path: "/dropped/proj" }),
		);
		expect(bridgeMocks.chooseDirectory).not.toHaveBeenCalled();
		const sheet = await screen.findByTestId("agent-sheet");
		expect(sheet).toHaveAttribute("data-path", "/dropped/proj");
		expect(sheet).toHaveAttribute("data-kind", "single_repo");
	});

	it("does not let a stale dropped path leak into the next manual New Project click", async () => {
		const user = userEvent.setup();
		bridgeMocks.chooseDirectory.mockResolvedValue("/manually/chosen");
		const { rerender } = render(
			<CreateProjectFlow mode="choose" {...noop} droppedPath={null} openSignal={0} />,
		);

		// Drop a folder, then dismiss the mode picker without picking a kind.
		rerender(<CreateProjectFlow mode="choose" {...noop} droppedPath={{ nonce: 1, path: "/dropped/proj" }} openSignal={0} />);
		await user.click(await screen.findByRole("button", { name: "Close new project dialog" }));
		await waitFor(() => expect(screen.queryByRole("button", { name: "Open local repository" })).not.toBeInTheDocument());

		// A manual "New Project" (⌘N-style openSignal bump) must fall back to the
		// native dialog, not silently reuse the dismissed drop's path.
		rerender(<CreateProjectFlow mode="choose" {...noop} droppedPath={{ nonce: 1, path: "/dropped/proj" }} openSignal={1} />);
		await user.click(await screen.findByRole("button", { name: "Open local repository" }));

		await waitFor(() => expect(bridgeMocks.chooseDirectory).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(bridgeMocks.scanImportFolder).toHaveBeenCalledWith({ mode: "project", path: "/manually/chosen" }),
		);
	});

	it("ignores a drop while the agent sheet is already open", async () => {
		const user = userEvent.setup();
		const { rerender } = render(<CreateProjectFlow mode="choose" {...noop} droppedPath={null} />);
		rerender(<CreateProjectFlow mode="choose" {...noop} droppedPath={{ nonce: 1, path: "/dropped/first" }} />);
		await user.click(await screen.findByRole("button", { name: "Open local repository" }));
		const sheet = await screen.findByTestId("agent-sheet");
		expect(sheet).toHaveAttribute("data-path", "/dropped/first");

		// A second, different folder is dropped while the agent sheet is open.
		rerender(<CreateProjectFlow mode="choose" {...noop} droppedPath={{ nonce: 2, path: "/dropped/second" }} />);

		expect(screen.getByTestId("agent-sheet")).toHaveAttribute("data-path", "/dropped/first");
		expect(screen.queryByRole("button", { name: "Open local repository" })).not.toBeInTheDocument();
	});

	it("ignores a drop while the clone-from-Git dialog is open", async () => {
		const user = userEvent.setup();
		const { rerender } = render(
			<CreateProjectFlow mode="choose" {...noop} droppedPath={null} openSignal={0} />,
		);

		// Open the mode picker manually and switch to the clone flow.
		rerender(<CreateProjectFlow mode="choose" {...noop} droppedPath={null} openSignal={1} />);
		await user.click(await screen.findByRole("button", { name: "Clone from Git" }));
		expect(await screen.findByTestId("clone-dialog")).toBeInTheDocument();

		// A folder is dropped while the clone dialog is on screen.
		rerender(
			<CreateProjectFlow mode="choose" {...noop} droppedPath={{ nonce: 1, path: "/dropped/proj" }} openSignal={1} />,
		);

		expect(screen.getByTestId("clone-dialog")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Open local repository" })).not.toBeInTheDocument();
		expect(bridgeMocks.chooseDirectory).not.toHaveBeenCalled();
	});
});

describe("CreateProjectFlow web fallback mode", () => {
	it("shows path field instead of choose button when nativeFileDialogs is false", async () => {
		(aoBridge.capabilities as any).nativeFileDialogs = false;
		const { rerender } = render(<CreateProjectFlow mode="single_repo" {...noop} openSignal={0} />);
		rerender(<CreateProjectFlow mode="single_repo" {...noop} openSignal={1} />);

		expect(screen.queryByRole("button", { name: "Choose Folder" })).not.toBeInTheDocument();
		try {
			expect(await screen.findByRole("textbox", { name: "Project absolute path" })).toBeInTheDocument();
		} catch (e) {
			screen.debug();
			throw e;
		}
	});

	it("runs daemon preflight before opening the agent sheet", async () => {
		(aoBridge.capabilities as any).nativeFileDialogs = false;
		const user = userEvent.setup();
		const { rerender } = render(<CreateProjectFlow mode="single_repo" {...noop} openSignal={0} />);
		rerender(<CreateProjectFlow mode="single_repo" {...noop} openSignal={1} />);

		const input = await screen.findByRole("textbox", { name: "Project absolute path" });
		await user.type(input, "/fake/path{enter}");

		expect(bridgeMocks.chooseDirectory).not.toHaveBeenCalled();
		expect(bridgeMocks.scanImportFolder).toHaveBeenCalledWith({ mode: "project", path: "/fake/path" });
		
		const sheet = await screen.findByTestId("agent-sheet");
		expect(sheet).toHaveAttribute("data-path", "/fake/path");
	});

	it("surfaces server-side validation error with request id", async () => {
		(aoBridge.capabilities as any).nativeFileDialogs = false;
		const user = userEvent.setup();
		
		const err = new Error("Path does not exist");
		(err as any).requestId = "req-123";
		const mockCreate = vi.fn().mockRejectedValue(err);

		const { rerender } = render(<CreateProjectFlow mode="single_repo" {...noop} onCreateProject={mockCreate} openSignal={0} />);
		rerender(<CreateProjectFlow mode="single_repo" {...noop} onCreateProject={mockCreate} openSignal={1} />);

		const input = await screen.findByRole("textbox", { name: "Project absolute path" });
		await user.type(input, "/fake/path{enter}");
		
		// The agent sheet should mount because selectedPath is set
		const startBtn = await screen.findByRole("button", { name: "Start" });
		await user.click(startBtn);

		await waitFor(() => expect(mockCreate).toHaveBeenCalled());
		
		expect(await screen.findByText("Path does not exist (Request ID: req-123)")).toBeInTheDocument();
	});
});
