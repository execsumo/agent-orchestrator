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

describe("DirectoryPickerDialog", () => {
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
});
