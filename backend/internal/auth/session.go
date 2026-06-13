// Package auth holds authentication primitives: session cookies, Google
// ID-token verification, and the domain gate. Pure logic here is I/O-free.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Session is the payload carried (signed, not encrypted) in the cookie.
type Session struct {
	UserID    int64 `json:"uid"`
	ExpiresAt int64 `json:"exp"` // unix seconds
}

type SessionManager struct {
	key []byte
}

func NewSessionManager(secret string) *SessionManager {
	return &SessionManager{key: []byte(secret)}
}

// Encode returns "<base64url(payload)>.<base64url(hmac)>".
func (m *SessionManager) Encode(s Session, ttl time.Duration) string {
	s.ExpiresAt = nowUTC().Add(ttl).Unix()
	body, _ := json.Marshal(s)
	b64 := base64.RawURLEncoding.EncodeToString(body)
	return b64 + "." + m.sign(b64)
}

func (m *SessionManager) Decode(token string) (Session, error) {
	b64, sig, ok := strings.Cut(token, ".")
	if !ok {
		return Session{}, errors.New("session: malformed token")
	}
	if !hmac.Equal([]byte(sig), []byte(m.sign(b64))) {
		return Session{}, errors.New("session: bad signature")
	}
	body, err := base64.RawURLEncoding.DecodeString(b64)
	if err != nil {
		return Session{}, errors.New("session: bad encoding")
	}
	var s Session
	if err := json.Unmarshal(body, &s); err != nil {
		return Session{}, errors.New("session: bad payload")
	}
	if nowUTC().Unix() >= s.ExpiresAt {
		return Session{}, errors.New("session: expired")
	}
	return s, nil
}

func (m *SessionManager) sign(b64 string) string {
	h := hmac.New(sha256.New, m.key)
	h.Write([]byte(b64))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// nowUTC is a package var so tests could override it if ever needed.
var nowUTC = func() time.Time { return time.Now().UTC() }
