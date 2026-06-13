package auth

import (
	"context"
	"fmt"

	"google.golang.org/api/idtoken"
)

// TokenVerifier verifies a raw Google ID token and returns its claims.
// Handlers depend on this interface so tests can supply a fake.
type TokenVerifier interface {
	Verify(ctx context.Context, rawIDToken string) (GoogleClaims, error)
}

// GoogleTokenVerifier validates tokens against Google's keys for our audience.
type GoogleTokenVerifier struct {
	ClientID string
}

func (v GoogleTokenVerifier) Verify(ctx context.Context, rawIDToken string) (GoogleClaims, error) {
	payload, err := idtoken.Validate(ctx, rawIDToken, v.ClientID)
	if err != nil {
		return GoogleClaims{}, fmt.Errorf("auth: invalid id token: %w", err)
	}
	return GoogleClaims{
		Subject:       payload.Subject,
		Email:         claimString(payload.Claims, "email"),
		EmailVerified: claimBool(payload.Claims, "email_verified"),
		Name:          claimString(payload.Claims, "name"),
		Picture:       claimString(payload.Claims, "picture"),
		HostedDomain:  claimString(payload.Claims, "hd"),
	}, nil
}

func claimString(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

func claimBool(m map[string]any, k string) bool {
	if v, ok := m[k].(bool); ok {
		return v
	}
	return false
}
