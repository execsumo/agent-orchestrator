package controllers_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aoagents/agent-orchestrator/backend/internal/config"
	"github.com/aoagents/agent-orchestrator/backend/internal/httpd"
)

func filesystemServer(t *testing.T, roots []string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(httpd.NewRouterWithControl(
		config.Config{FileSystemRoots: roots},
		slog.New(slog.NewTextHandler(io.Discard, nil)), nil, httpd.APIDeps{}, httpd.ControlDeps{},
	))
	t.Cleanup(server.Close)
	return server
}

func filesystemRequest(t *testing.T, server *httptest.Server, method, target string, body io.Reader) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(method, server.URL+target, body)
	if err != nil {
		t.Fatal(err)
	}
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	bytes, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp, string(bytes)
}

func TestFilesystemListJailSecurityProperties(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "inside.txt"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	locked := filepath.Join(outside, "locked")
	if err := os.Mkdir(locked, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(locked, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(locked, 0o700) })
	server := filesystemServer(t, []string{root})

	resp, body := filesystemRequest(t, server, http.MethodGet, "/api/v1/fs/list?path="+url.QueryEscape(root), nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(body, "inside.txt") {
		t.Fatalf("list root = %d %s", resp.StatusCode, body)
	}

	badPaths := []string{
		"%2e%2e",
		url.QueryEscape(root + string(os.PathSeparator) + "child" + string(os.PathSeparator) + ".."),
		url.QueryEscape(filepath.Join(root, "escape")),
		url.QueryEscape(locked),
		url.QueryEscape(filepath.Join(outside, "missing")),
		url.QueryEscape(filepath.Join(root, "missing")),
		url.QueryEscape(root + "\x00"),
	}
	var unavailableCode string
	for index, encoded := range badPaths {
		resp, body = filesystemRequest(t, server, http.MethodGet, "/api/v1/fs/list?path="+encoded, nil)
		if resp.StatusCode != http.StatusNotFound || strings.Contains(body, outside) {
			t.Fatalf("hostile path %d = %d %s", index, resp.StatusCode, body)
		}
		var envelope struct {
			Error   string `json:"error"`
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal([]byte(body), &envelope); err != nil {
			t.Fatal(err)
		}
		if index == 0 {
			unavailableCode = envelope.Code
		} else if envelope.Code != unavailableCode || envelope.Message != "The requested directory is unavailable." {
			t.Fatalf("unavailable error changed for hostile path %d: %s", index, body)
		}
	}
}

func TestFilesystemEmptyRootsDenyAndLANBlockLeavesRoutesAvailable(t *testing.T) {
	server := filesystemServer(t, nil)
	resp, body := filesystemRequest(t, server, http.MethodGet, "/api/v1/fs/list", nil)
	if resp.StatusCode != http.StatusNotFound || !strings.Contains(body, "FILESYSTEM_PATH_UNAVAILABLE") {
		t.Fatalf("empty roots = %d %s", resp.StatusCode, body)
	}
	if httpd.IsLANControlBlockedPathForTest("/api/v1/fs/list") {
		t.Fatal("filesystem list was added to the LAN control block")
	}
	if httpd.IsLANControlBlockedPathForTest("/api/v1/fs/inspect") {
		t.Fatal("filesystem inspect was added to the LAN control block")
	}
}
