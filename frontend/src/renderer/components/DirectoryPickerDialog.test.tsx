import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { DirectoryPickerDialog } from "./DirectoryPickerDialog";

const api = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("../lib/api-client", () => ({
  apiClient: { GET: api.get },
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

const directory = (name: string, path: string, overrides = {}) => ({
  name,
  path,
  kind: "directory" as const,
  hidden: false,
  accessible: true,
  ...overrides,
});

const file = (name: string, path: string) => ({
  name,
  path,
  kind: "file" as const,
  hidden: false,
  accessible: true,
});

const response = (entries: unknown[]) => ({
  data: { path: "", entries },
});

describe("DirectoryPickerDialog", () => {
  beforeEach(() => {
    api.get.mockReset();
  });

  it("lists jailed directories and returns a selected folder", async () => {
    api.get.mockResolvedValue({
      data: {
        path: "",
        entries: [
          {
            name: "projects",
            path: "/safe/projects",
            kind: "directory",
            hidden: false,
            accessible: true,
          },
        ],
      },
    });
    const onSelect = vi.fn();
    render(
      <DirectoryPickerDialog
        open
        title="Choose a folder"
        onOpenChange={vi.fn()}
        onSelect={onSelect}
      />,
    );

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/api/v1/fs/list", {
        params: { query: {} },
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Select" }),
    );
    expect(onSelect).toHaveBeenCalledWith("/safe/projects");
  });

  it("renders an alert and no entries when listing returns an error", async () => {
    api.get.mockResolvedValue({ error: new Error("jail unavailable") });
    render(
      <DirectoryPickerDialog
        open
        title="Choose a folder"
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The directory picker is unavailable.",
    );
    expect(screen.queryByRole("button", { name: "jail unavailable" })).not.toBeInTheDocument();
  });

  it("renders an alert when listing rejects", async () => {
    api.get.mockRejectedValue(new Error("network failure"));
    render(
      <DirectoryPickerDialog
        open
        title="Choose a folder"
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The directory picker is unavailable.",
    );
  });

  it("renders the empty state when no folders are available", async () => {
    api.get.mockResolvedValue(response([]));
    render(
      <DirectoryPickerDialog
        open
        title="Choose a folder"
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(await screen.findByText("No folders available here.")).toBeInTheDocument();
  });

  it("renders loading without empty or alert states while the request is pending", async () => {
    api.get.mockReturnValue(new Promise(() => undefined));
    render(
      <DirectoryPickerDialog
        open
        title="Choose a folder"
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(await screen.findByText("Loading folders…")).toBeInTheDocument();
    expect(screen.queryByText("No folders available here.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows roots at the initial path and the path after navigation", async () => {
    api.get
      .mockResolvedValueOnce(response([directory("projects", "/safe/projects")]))
      .mockResolvedValueOnce(response([]));
    render(
      <DirectoryPickerDialog
        open
        title="Choose a folder"
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(await screen.findByText("Configured roots")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "projects" }));
    expect(await screen.findByText("/safe/projects")).toBeInTheDocument();
    expect(screen.queryByText("Configured roots")).not.toBeInTheDocument();
  });

  it("disables back at roots and returns two levels to the previous paths", async () => {
    api.get.mockImplementation((_url: string, options: { params: { query: { path?: string } } }) => {
      const path = options.params.query.path ?? "";
      const entries =
        path === ""
          ? [directory("one", "/safe/one")]
          : path === "/safe/one"
            ? [directory("two", "/safe/one/two")]
            : [];
      return Promise.resolve(response(entries));
    });
    render(
      <StrictMode>
        <DirectoryPickerDialog
          open
          title="Choose a folder"
          onOpenChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </StrictMode>,
    );

    const back = await screen.findByRole("button", { name: "Back" });
    expect(back).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "one" }));
    expect(back).toBeEnabled();
    await userEvent.click(await screen.findByRole("button", { name: "two" }));
    expect(await screen.findByText("/safe/one/two")).toBeInTheDocument();

    await userEvent.click(back);
    expect(await screen.findByText("/safe/one")).toBeInTheDocument();
    await userEvent.click(back);
    expect(await screen.findByText("Configured roots")).toBeInTheDocument();
    expect(back).toBeDisabled();
  });

  it("marks inaccessible entries unavailable without a select button", async () => {
    api.get.mockResolvedValue(
      response([directory("private", "/safe/private", { accessible: false })]),
    );
    render(
      <DirectoryPickerDialog
        open
        title="Choose a folder"
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "private" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Select$/ })).not.toBeInTheDocument();
  });

  it("suffixes hidden entries with the hidden label", async () => {
    api.get.mockResolvedValue(
      response([directory("secret", "/safe/secret", { hidden: true })]),
    );
    render(
      <DirectoryPickerDialog
        open
        title="Choose a folder"
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(await screen.findByRole("button", { name: "secret (hidden)" })).toBeInTheDocument();
  });

  it("selects the current path only after navigating into it", async () => {
    api.get
      .mockResolvedValueOnce(response([directory("projects", "/safe/projects")]))
      .mockResolvedValueOnce(response([]));
    const onSelect = vi.fn();
    render(
      <DirectoryPickerDialog
        open
        title="Choose a folder"
        onOpenChange={vi.fn()}
        onSelect={onSelect}
      />,
    );

    const selectCurrent = await screen.findByRole("button", {
      name: "Select this folder",
    });
    expect(selectCurrent).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "projects" }));
    expect(await screen.findByText("/safe/projects")).toBeInTheDocument();
    expect(selectCurrent).toBeEnabled();
    await userEvent.click(selectCurrent);
    expect(onSelect).toHaveBeenCalledWith("/safe/projects");
  });

  it("requests a directory with its path when navigating", async () => {
    api.get
      .mockResolvedValueOnce(response([directory("projects", "/safe/projects")]))
      .mockResolvedValueOnce(response([]));
    render(
      <DirectoryPickerDialog
        open
        title="Choose a folder"
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(api.get).toHaveBeenNthCalledWith(1, "/api/v1/fs/list", {
        params: { query: {} },
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "projects" }));
    await waitFor(() =>
      expect(api.get).toHaveBeenNthCalledWith(2, "/api/v1/fs/list", {
        params: { query: { path: "/safe/projects" } },
      }),
    );
  });

  it("does not navigate when a file entry is clicked", async () => {
    api.get.mockResolvedValue(response([file("notes.txt", "/safe/notes.txt")]));
    render(
      <DirectoryPickerDialog
        open
        title="Choose a folder"
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const name = await screen.findByRole("button", { name: "notes.txt" });
    expect(name).toBeDisabled();
    await userEvent.click(name);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("disables navigation and selection controls when disabled", async () => {
    api.get.mockResolvedValue(response([directory("projects", "/safe/projects")]));
    render(
      <DirectoryPickerDialog
        disabled
        open
        title="Choose a folder"
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(await screen.findByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "projects" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Select$/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Select this folder" })).toBeDisabled();
  });
});
