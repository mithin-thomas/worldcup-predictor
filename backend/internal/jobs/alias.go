package jobs

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
)

// LoadAliases parses a football-data-team-id -> FIFA-code CSV (header row required)
// into a map. Used to align football-data matches with seeded teams.
func LoadAliases(r io.Reader) (map[int64]string, error) {
	rows, err := csv.NewReader(r).ReadAll()
	if err != nil {
		return nil, fmt.Errorf("jobs: read aliases: %w", err)
	}
	out := make(map[int64]string, len(rows))
	for i, row := range rows {
		if i == 0 {
			continue // header
		}
		if len(row) != 2 {
			return nil, fmt.Errorf("jobs: alias row %d: want 2 columns, got %d", i, len(row))
		}
		id, err := strconv.ParseInt(row[0], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("jobs: alias row %d: bad fd_team_id %q: %w", i, row[0], err)
		}
		out[id] = row[1]
	}
	return out, nil
}
