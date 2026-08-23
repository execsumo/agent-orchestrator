// Package fsinspect ports the Electron import-folder scan to the daemon. It
// receives only paths already resolved by fsjail, and re-checks every workspace
// child before inspecting it so a symlink cannot escape the same jail midway
// through a scan.
package fsinspect

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aoagents/agent-orchestrator/backend/internal/fsjail"
)

const (
	maxEntries       = 200
	maxScanWorkers   = 8
	gitCommandTimeout = 5 * time.Second
)

var skipDirs = map[string]struct{}{
	".git": {}, "node_modules": {}, "dist": {}, "build": {}, ".cache": {},
	".turbo": {}, "target": {}, "coverage": {}, "tmp": {}, "temp": {}, "Library": {},
}

type Repo struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	RelativePath string `json:"relativePath"`
	Branch       string `json:"branch"`
	Remote       string `json:"remote"`
	HasRemote    bool   `json:"hasRemote"`
	Status       string `json:"status"`
	Reason       string `json:"reason,omitempty"`
	NeedsGitInit bool   `json:"needsGitInit,omitempty"`
}

type Result struct {
	Path         string `json:"path"`
	Repos        []Repo `json:"repos"`
	SetupWarning string `json:"setupWarning,omitempty"`
}

type Options struct {
	Jail        *fsjail.Jail
	HomeDir     string
	InternalDir string
}

func Scan(ctx context.Context, path, mode string, opts Options) (Result, error) {
	if opts.Jail == nil || (mode != "project" && mode != "workspace") {
		return Result{}, fsjail.ErrUnavailable
	}
	resolved, err := opts.Jail.Resolve(path)
	if err != nil {
		return Result{}, fsjail.ErrUnavailable
	}
	if mode == "project" {
		if reason := projectSetupSafetyReason(resolved, opts); reason != "" {
			return Result{Path: resolved, Repos: []Repo{{
				Name: filepath.Base(resolved), Path: resolved, RelativePath: ".", Branch: "HEAD",
				Status: "error", Reason: reason,
			}}}, nil
		}
		repo, repoErr := scanGitRepo(ctx, resolved, resolved, opts)
		if repoErr != nil {
			return Result{}, fsjail.ErrUnavailable
		}
		if repo != nil && !repo.NeedsGitInit {
			return Result{Path: resolved, Repos: []Repo{*repo}}, nil
		}
		warning := ancestorRepositorySetupWarning(ctx, resolved, opts)
		result := Result{Path: resolved, Repos: nil}
		if repo != nil {
			result.Repos = []Repo{*repo}
		}
		if warning != "" {
			result.SetupWarning = warning
		}
		return result, nil
	}

	entries, err := os.ReadDir(resolved)
	if err != nil {
		return Result{}, fsjail.ErrUnavailable
	}
	warning := ancestorRepositorySetupWarning(ctx, resolved, opts)
	candidates := make([]string, 0, min(len(entries), maxEntries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if _, skip := skipDirs[entry.Name()]; skip {
			continue
		}
		child := filepath.Join(resolved, entry.Name())
		childResolved, childErr := opts.Jail.Resolve(child)
		if childErr != nil {
			// An escaping symlink is not a repo candidate and must not leak
			// anything about its target.
			continue
		}
		candidates = append(candidates, childResolved)
		if len(candidates) == maxEntries {
			break
		}
	}
	repos := make([]*Repo, len(candidates))
	var wg sync.WaitGroup
	sem := make(chan struct{}, maxScanWorkers)
	for i, candidate := range candidates {
		wg.Add(1)
		go func(index int, repoPath string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			repos[index], _ = scanGitRepo(ctx, repoPath, resolved, opts)
		}(i, candidate)
	}
	wg.Wait()
	out := make([]Repo, 0, len(repos))
	for _, repo := range repos {
		if repo != nil {
			out = append(out, *repo)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	result := Result{Path: resolved, Repos: out}
	if warning != "" {
		result.SetupWarning = warning
	}
	return result, nil
}

func scanGitRepo(ctx context.Context, repoPath, rootPath string, opts Options) (*Repo, error) {
	relative := "."
	if repoPath != rootPath {
		relative, _ = filepath.Rel(rootPath, repoPath)
	}
	name := filepath.Base(repoPath)
	repo := &Repo{Name: name, Path: repoPath, RelativePath: relative, Status: "ok"}
	gitInfo, statErr := os.Stat(filepath.Join(repoPath, ".git"))
	if statErr == nil && gitInfo.IsDir() {
		if _, err := gitOutput(ctx, repoPath, "rev-parse", "--show-toplevel"); err != nil {
			return nil, nil
		}
	} else {
		bare, err := gitOutput(ctx, repoPath, "rev-parse", "--is-bare-repository")
		if err == nil && bare == "true" {
			repo.Status = "error"
			repo.Reason = "Bare repositories cannot be imported."
			return repo, nil
		}
		repo.NeedsGitInit = true
		return repo, nil
	}
	branch, branchErr := gitOutput(ctx, repoPath, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
	remote, remoteErr := gitOutput(ctx, repoPath, "remote", "get-url", "origin")
	_, headErr := gitOutput(ctx, repoPath, "rev-parse", "--verify", "HEAD")
	if branchErr != nil || strings.TrimSpace(branch) == "" {
		branch = "HEAD"
	} else {
		branch = strings.TrimPrefix(branch, "origin/")
	}
	repo.Branch = branch
	if remoteErr == nil {
		repo.Remote = remote
		repo.HasRemote = remote != ""
	}
	if name == "__root__" {
		repo.Status = "error"
		repo.Reason = "Repository name is reserved by AO."
		return repo, nil
	}
	repo.NeedsGitInit = headErr != nil || !repo.HasRemote
	return repo, nil
}

func ancestorRepositorySetupWarning(ctx context.Context, repoPath string, opts Options) string {
	top, err := gitOutput(ctx, repoPath, "rev-parse", "--show-toplevel")
	if err != nil || top == "" {
		return ""
	}
	top = filepath.Clean(top)
	if samePath(top, repoPath) {
		return ""
	}
	if opts.Jail != nil && !opts.Jail.Contains(top) {
		return "Selected folder is inside an existing Git repository outside the configured directory roots."
	}
	return "Selected folder is inside an existing Git repository at " + top + ". AO will initialize this folder as a separate repository."
}

func projectSetupSafetyReason(repoPath string, opts Options) string {
	for _, internal := range []string{opts.InternalDir, filepath.Join(opts.HomeDir, ".ao")} {
		if internal != "" && pathWithin(repoPath, internal) {
			return "Selected folder is inside AO's internal data directory. Select a project folder outside ~/.ao."
		}
	}
	return ""
}

func gitOutput(parent context.Context, cwd string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, gitCommandTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func samePath(a, b string) bool {
	ra, errA := filepath.EvalSymlinks(a)
	rb, errB := filepath.EvalSymlinks(b)
	if errA != nil || errB != nil {
		return filepath.Clean(a) == filepath.Clean(b)
	}
	return filepath.Clean(ra) == filepath.Clean(rb)
}

func pathWithin(child, parent string) bool {
	child, childErr := filepath.Abs(child)
	parent, parentErr := filepath.Abs(parent)
	if childErr != nil || parentErr != nil {
		return false
	}
	rel, err := filepath.Rel(parent, child)
	return err == nil && (rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))))
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
