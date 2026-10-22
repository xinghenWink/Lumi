package media

import (
	"context"
	"fmt"
	"io/fs"
)

func (s *Store) Usage(ctx context.Context) (int64, error) {
	var total int64
	err := fs.WalkDir(s.root.FS(), ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			total += info.Size()
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("measure image storage: %w", err)
	}
	return total, nil
}
