import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, File, Folder, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient, apiErrorMessage } from "../lib/api-client";
import { Button } from "./ui/button";

type DirectoryEntry = {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink" | "unknown";
  hidden: boolean;
  accessible: boolean;
};

export function DirectoryPickerDialog({
  disabled = false,
  onOpenChange,
  onSelect,
  open,
  title,
}: {
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  open: boolean;
  title: string;
}) {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCurrentPath("");
    setHistory([]);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void apiClient
      .GET("/api/v1/fs/list", {
        params: { query: currentPath ? { path: currentPath } : {} },
      })
      .then(({ data, error: requestError }) => {
        if (cancelled) return;
        if (requestError || !data) {
          setEntries([]);
          setError(
            apiErrorMessage(requestError, t("directoryPicker.unavailable")),
          );
          return;
        }
        setEntries(data.entries as DirectoryEntry[]);
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([]);
          setError(t("directoryPicker.unavailable"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentPath, open, t]);

  const navigate = (entry: DirectoryEntry) => {
    if (entry.kind !== "directory" || !entry.accessible) return;
    setHistory((previous) => [...previous, currentPath]);
    setCurrentPath(entry.path);
  };

  const goBack = () => {
    setHistory((previous) => {
      const next = [...previous];
      setCurrentPath(next.pop() ?? "");
      return next;
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay data-[state=open]:animate-overlay-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-overlay flex max-h-[min(640px,calc(100svh-24px))] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-welcome-panel border border-[var(--color-border-import-modal)] bg-[var(--color-bg-import-modal)] p-0 text-[var(--color-text-import-title)] shadow-[var(--shadow-import-modal)]">
          <div className="flex items-start gap-3 border-b border-[var(--color-border-import-modal)] p-(--size-import-dialog-padding)">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("directoryPicker.back")}
              disabled={disabled || history.length === 0}
              onClick={goBack}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[18px] font-semibold">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 truncate font-mono text-[12px] text-[var(--color-text-import-muted)]">
                {currentPath || t("directoryPicker.roots")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="settings-close-button"
                aria-label={t("directoryPicker.cancel")}
                disabled={disabled}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto p-(--size-import-dialog-padding)">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-[var(--color-text-import-muted)]">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t("directoryPicker.loading")}
              </div>
            ) : error ? (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-[12px] text-destructive"
                role="alert"
              >
                {error}
              </div>
            ) : entries.length === 0 ? (
              <div className="py-12 text-center text-[12px] text-[var(--color-text-import-muted)]">
                {t("directoryPicker.empty")}
              </div>
            ) : (
              <div className="space-y-1">
                {entries.map((entry) => (
                  <div
                    key={entry.path}
                    className="flex items-center gap-2 rounded-md border border-transparent bg-[var(--color-bg-import-card)] px-3 py-2"
                  >
                    {entry.kind === "directory" ? (
                      <Folder className="size-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <File className="size-4 shrink-0" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-[13px] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={
                        disabled ||
                        !entry.accessible ||
                        entry.kind !== "directory"
                      }
                      onClick={() => navigate(entry)}
                    >
                      {entry.name}
                      {entry.hidden ? ` (${t("directoryPicker.hidden")})` : ""}
                    </button>
                    {entry.accessible && entry.kind === "directory" ? (
                      <Button
                        type="button"
                        variant="footer"
                        disabled={disabled}
                        onClick={() => onSelect(entry.path)}
                      >
                        {t("directoryPicker.select")}
                      </Button>
                    ) : (
                      <span className="text-[11px] text-[var(--color-text-import-muted)]">
                        {t("directoryPicker.inaccessible")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end border-t border-[var(--color-border-import-modal)] p-(--size-import-dialog-padding)">
            <Button
              type="button"
              variant="footer"
              disabled={disabled || !currentPath}
              onClick={() => onSelect(currentPath)}
            >
              {t("directoryPicker.selectCurrent")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
