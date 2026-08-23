package fsjail

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveChecksSymlinksBeforeContainment(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	jail := New([]string{root})
	if _, err := jail.Resolve(link); err == nil {
		t.Fatal("symlink escaping configured root was accepted")
	}
	if _, err := jail.Resolve(root + string(os.PathSeparator) + "child" + string(os.PathSeparator) + ".."); err == nil {
		t.Fatal("path traversal was accepted")
	}
	if _, err := jail.Resolve(filepath.Join(root, "missing")); err == nil {
		t.Fatal("missing path was accepted")
	}
}

func TestEmptyRootsDenyEverything(t *testing.T) {
	jail := New(nil)
	if _, err := jail.Resolve("/tmp"); err == nil {
		t.Fatal("empty root configuration allowed an absolute path")
	}
	if _, _, err := jail.List(""); err == nil {
		t.Fatal("empty root configuration listed roots")
	}
}

func TestListMarksDotfilesAndBrokenSymlinksExplicitly(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "missing"), filepath.Join(root, "broken")); err != nil {
		t.Fatal(err)
	}
	jail := New([]string{root})
	_, entries, err := jail.List(root)
	if err != nil {
		t.Fatal(err)
	}
	var hidden, broken *Entry
	for i := range entries {
		switch entries[i].Name {
		case ".env":
			hidden = &entries[i]
		case "broken":
			broken = &entries[i]
		}
	}
	if hidden == nil || !hidden.Hidden || !hidden.Accessible {
		t.Fatalf("dotfile entry = %#v", hidden)
	}
	if broken == nil || broken.Kind != "symlink" || broken.Accessible {
		t.Fatalf("broken symlink entry = %#v", broken)
	}
}
