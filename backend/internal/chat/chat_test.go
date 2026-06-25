package chat

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAssembleMessages_PrependsSystem(t *testing.T) {
	got := assembleMessages("SYS", []Message{
		{Role: "user", Content: "hi"},
		{Role: "assistant", Content: "hello"},
	})
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}
	if got[0].Role != "system" || got[0].Content != "SYS" {
		t.Errorf("first = %+v, want system/SYS", got[0])
	}
	if got[1].Content != "hi" || got[2].Content != "hello" {
		t.Errorf("order not preserved: %+v", got)
	}
}

func TestLoadSystemPrompt(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "p.txt")
	if err := os.WriteFile(p, []byte("  be helpful  \n"), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := LoadSystemPrompt(p)
	if err != nil {
		t.Fatalf("LoadSystemPrompt: %v", err)
	}
	if s != "be helpful" {
		t.Errorf("got %q, want trimmed", s)
	}
	if _, err := LoadSystemPrompt(filepath.Join(dir, "missing.txt")); err == nil {
		t.Error("expected error for missing file")
	}
}
