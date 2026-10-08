// Package localstore saves files on local disk; they are served by the backend under URLPrefix.
package localstore

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// URLPrefix is the public path the router serves Dir from.
const URLPrefix = "/api/media"

type Storage struct{ Dir string }

func New(dir string) (*Storage, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("media dir: %w", err)
	}
	return &Storage{Dir: dir}, nil
}

func (s *Storage) Upload(_ context.Context, key string, data []byte, _ string) (string, error) {
	clean := filepath.Clean("/" + key) // blocks "../" escapes
	path := filepath.Join(s.Dir, clean)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, path); err != nil {
		return "", err
	}
	// ?v= busts the browser cache when audio is regenerated under the same key.
	return fmt.Sprintf("%s%s?v=%d", URLPrefix, filepath.ToSlash(clean), time.Now().Unix()), nil
}
