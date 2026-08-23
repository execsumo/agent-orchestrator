package controllers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/aoagents/agent-orchestrator/backend/internal/fsinspect"
	"github.com/aoagents/agent-orchestrator/backend/internal/fsjail"
	"github.com/aoagents/agent-orchestrator/backend/internal/httpd/envelope"
)

// FileSystemController is the authenticated, jailed filesystem surface used by
// the browser directory picker. It deliberately has no operation that accepts
// a path without passing through fsjail.Resolve.
type FileSystemController struct {
	Jail        *fsjail.Jail
	HomeDir     string
	InternalDir string
}

func (c *FileSystemController) Register(r chi.Router) {
	r.Get("/fs/list", c.list)
	r.Post("/fs/inspect", c.inspect)
}

func (c *FileSystemController) list(w http.ResponseWriter, r *http.Request) {
	if c.Jail == nil {
		writeFilesystemUnavailable(w, r)
		return
	}
	query := FSListQuery{Path: r.URL.Query().Get("path")}
	resolved, entries, err := c.Jail.List(query.Path)
	if err != nil {
		writeFilesystemUnavailable(w, r)
		return
	}
	out := FSListResponse{Path: resolved, Entries: make([]FSListEntry, 0, len(entries))}
	for _, entry := range entries {
		out.Entries = append(out.Entries, FSListEntry{
			Name: entry.Name, Path: entry.Path, Kind: entry.Kind,
			Hidden: entry.Hidden, Accessible: entry.Accessible,
		})
	}
	envelope.WriteJSON(w, http.StatusOK, out)
}

func (c *FileSystemController) inspect(w http.ResponseWriter, r *http.Request) {
	var in FSInspectRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&in); err != nil || in.Path == "" || (in.Mode != "project" && in.Mode != "workspace") {
		envelope.WriteAPIError(w, r, http.StatusBadRequest, "bad_request", "INVALID_FILESYSTEM_REQUEST", "path and mode are required", nil)
		return
	}
	if c.Jail == nil {
		writeFilesystemUnavailable(w, r)
		return
	}
	result, err := fsinspect.Scan(r.Context(), in.Path, in.Mode, fsinspect.Options{
		Jail: c.Jail, HomeDir: c.HomeDir, InternalDir: c.InternalDir,
	})
	if err != nil {
		writeFilesystemUnavailable(w, r)
		return
	}
	out := FSInspectResponse{Path: result.Path, SetupWarning: result.SetupWarning, Repos: make([]FSRepoScan, 0, len(result.Repos))}
	for _, repo := range result.Repos {
		out.Repos = append(out.Repos, FSRepoScan{
			Name: repo.Name, Path: repo.Path, RelativePath: repo.RelativePath,
			Branch: repo.Branch, Remote: repo.Remote, HasRemote: repo.HasRemote,
			Status: repo.Status, Reason: repo.Reason, NeedsGitInit: repo.NeedsGitInit,
		})
	}
	envelope.WriteJSON(w, http.StatusOK, out)
}

func writeFilesystemUnavailable(w http.ResponseWriter, r *http.Request) {
	// Do not include the requested path: outside-root, missing, unreadable, and
	// symlink-escape cases must be indistinguishable and must not become a path
	// oracle through an error message.
	envelope.WriteAPIError(w, r, http.StatusNotFound, "not_found", "FILESYSTEM_PATH_UNAVAILABLE", "The requested directory is unavailable.", nil)
}
