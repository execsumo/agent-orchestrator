package fsinspect

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aoagents/agent-orchestrator/backend/internal/fsjail"
)

func TestScanPreservesProjectAndWorkspaceImportBehavior(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "z-repo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "a-repo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	jail := fsjail.New([]string{root})
	result, err := Scan(context.Background(), root, "workspace", Options{Jail: jail})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Repos) != 2 || result.Repos[0].Name != "a-repo" || result.Repos[1].Name != "z-repo" {
		t.Fatalf("workspace scan = %#v", result.Repos)
	}
	for _, repo := range result.Repos {
		if !repo.NeedsGitInit || repo.Status != "ok" || repo.HasRemote {
			t.Fatalf("plain folder scan = %#v", repo)
		}
	}

	project, err := Scan(context.Background(), filepath.Join(root, "a-repo"), "project", Options{Jail: jail})
	if err != nil {
		t.Fatal(err)
	}
	if len(project.Repos) != 1 || !project.Repos[0].NeedsGitInit || project.Repos[0].RelativePath != "." {
		t.Fatalf("project scan = %#v", project)
	}
}

func TestScanDoesNotRevealAncestorOutsideConfiguredRoot(t *testing.T) {
	outside := t.TempDir()
	root := filepath.Join(outside, "allowed")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("git", "init", outside).CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, output)
	}
	jail := fsjail.New([]string{root})
	result, err := Scan(context.Background(), root, "project", Options{Jail: jail})
	if err != nil {
		t.Fatal(err)
	}
	if result.SetupWarning == "" || containsPath(result.SetupWarning, outside) {
		t.Fatalf("ancestor warning leaked outside path: %#v", result.SetupWarning)
	}
}

func containsPath(value, path string) bool {
	return len(path) > 0 && filepath.IsAbs(path) && strings.Contains(value, filepath.Clean(path))
}
