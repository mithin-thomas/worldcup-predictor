package auth

import (
	"testing"
	"time"
)

func TestSessionRoundTrip(t *testing.T) {
	m := NewSessionManager("super-secret-key")
	token := m.Encode(Session{UserID: 42}, time.Hour)

	got, err := m.Decode(token)
	if err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if got.UserID != 42 {
		t.Errorf("UserID = %d, want 42", got.UserID)
	}
}

func TestDecodeRejectsTamperedToken(t *testing.T) {
	m := NewSessionManager("super-secret-key")
	token := m.Encode(Session{UserID: 42}, time.Hour)

	if _, err := m.Decode(token + "x"); err == nil {
		t.Fatal("Decode() error = nil, want signature error on tampered token")
	}
}

func TestDecodeRejectsWrongKey(t *testing.T) {
	token := NewSessionManager("key-a").Encode(Session{UserID: 1}, time.Hour)
	if _, err := NewSessionManager("key-b").Decode(token); err == nil {
		t.Fatal("Decode() error = nil, want signature error under different key")
	}
}

func TestDecodeRejectsExpired(t *testing.T) {
	m := NewSessionManager("super-secret-key")
	token := m.Encode(Session{UserID: 7}, -1*time.Minute) // already expired
	if _, err := m.Decode(token); err == nil {
		t.Fatal("Decode() error = nil, want expiry error")
	}
}
