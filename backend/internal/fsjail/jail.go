// Package fsjail exposes the deliberately small filesystem boundary used by
// the remote directory picker. A caller can only obtain paths after symlinks
// have been resolved and the resolved path has been checked against a
// configured root.
package fsjail

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var ErrUnavailable = errors.New("filesystem path unavailable")

type Entry struct {
	Name       string
	Path       string
	Kind       string
	Hidden     bool
	Accessible bool
}

type Jail struct {
	roots []string
}

func New(roots []string) *Jail {
	seen := make(map[string]struct{}, len(roots))
	resolved := make([]string, 0, len(roots))
	for _, root := range roots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		canonical, err := filepath.EvalSymlinks(filepath.Clean(root))
		if err != nil {
			continue
		}
		info, err := os.Stat(canonical)
		if err != nil || !info.IsDir() {
			continue
		}
		canonical = filepath.Clean(canonical)
		key := pathKey(canonical)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		resolved = append(resolved, canonical)
	}
	sort.Strings(resolved)
	return &Jail{roots: resolved}
}

func (j *Jail) Roots() []string {
	return append([]string(nil), j.roots...)
}

// Resolve rejects traversal syntax before filesystem access, then resolves
// every symlink, and only then checks containment. The ordering is the core
// security property: checking the lexical path first would let an escaping
// symlink pass the jail.
func (j *Jail) Resolve(raw string) (string, error) {
	if len(j.roots) == 0 || strings.IndexByte(raw, 0) >= 0 || hasParentSegment(raw) {
		return "", ErrUnavailable
	}
	if strings.TrimSpace(raw) == "" {
		return "", ErrUnavailable
	}

	candidates := make([]string, 0, len(j.roots))
	if filepath.IsAbs(raw) {
		candidates = append(candidates, raw)
	} else {
		for _, root := range j.roots {
			candidates = append(candidates, filepath.Join(root, raw))
		}
	}
	for _, candidate := range candidates {
		resolved, err := filepath.EvalSymlinks(filepath.Clean(candidate))
		if err != nil {
			continue
		}
		resolved = filepath.Clean(resolved)
		for _, root := range j.roots {
			if within(resolved, root) {
				return resolved, nil
			}
		}
	}
	return "", ErrUnavailable
}

func (j *Jail) Contains(path string) bool {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return false
	}
	for _, root := range j.roots {
		if within(filepath.Clean(resolved), root) {
			return true
		}
	}
	return false
}

func (j *Jail) List(raw string) (string, []Entry, error) {
	if strings.TrimSpace(raw) == "" {
		if len(j.roots) == 0 {
			return "", nil, ErrUnavailable
		}
		entries := make([]Entry, 0, len(j.roots))
		for _, root := range j.roots {
			entries = append(entries, Entry{
				Name:       filepath.Base(root),
				Path:       root,
				Kind:       "directory",
				Accessible: true,
			})
		}
		return "", entries, nil
	}
	resolved, err := j.Resolve(raw)
	if err != nil {
		return "", nil, ErrUnavailable
	}
	entries, err := os.ReadDir(resolved)
	if err != nil {
		return "", nil, ErrUnavailable
	}
	out := make([]Entry, 0, len(entries))
	for _, entry := range entries {
		candidate := filepath.Join(resolved, entry.Name())
		item := Entry{
			Name:       entry.Name(),
			Path:       candidate,
			Kind:       "unknown",
			Hidden:     strings.HasPrefix(entry.Name(), "."),
			Accessible: false,
		}
		if entry.Type()&os.ModeSymlink != 0 {
			item.Kind = "symlink"
		} else if entry.IsDir() {
			item.Kind = "directory"
		} else {
			item.Kind = "file"
		}
		resolvedEntry, resolveErr := filepath.EvalSymlinks(candidate)
		if resolveErr == nil && j.Contains(resolvedEntry) {
			item.Path = filepath.Clean(resolvedEntry)
			item.Accessible = true
			if info, infoErr := os.Stat(resolvedEntry); infoErr == nil {
				if info.IsDir() {
					item.Kind = "directory"
				} else if entry.Type()&os.ModeSymlink != 0 {
					item.Kind = "symlink"
				} else {
					item.Kind = "file"
				}
			}
		}
		out = append(out, item)
	}
	return resolved, out, nil
}

func hasParentSegment(value string) bool {
	for _, segment := range strings.FieldsFunc(value, func(r rune) bool { return r == '/' || r == '\\' }) {
		if segment == ".." {
			return true
		}
	}
	return false
}

func within(path, root string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func pathKey(value string) string {
	if filepath.Separator == '\\' {
		return strings.ToLower(value)
	}
	return value
}
