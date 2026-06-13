package jobs

import (
	"strings"
	"testing"
)

func TestLoadAliases(t *testing.T) {
	csv := "fd_team_id,fifa_code\n759,KOR\n805,CZE\n"
	m, err := LoadAliases(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if m[759] != "KOR" || m[805] != "CZE" || len(m) != 2 {
		t.Fatalf("aliases = %+v", m)
	}
}

func TestLoadAliasesRejectsBadRow(t *testing.T) {
	if _, err := LoadAliases(strings.NewReader("fd_team_id,fifa_code\nnotanumber,KOR\n")); err == nil {
		t.Fatal("expected error on non-numeric id")
	}
}
