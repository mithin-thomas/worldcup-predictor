package auth

import (
	"fmt"
	"strings"
)

// GoogleClaims is the subset of verified ID-token claims we use.
type GoogleClaims struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	Picture       string
	HostedDomain  string // the "hd" claim
}

// CheckDomain enforces the §3.1 gate: the hd claim is the primary gate;
// email_verified and the email suffix are secondary guards.
func CheckDomain(c GoogleClaims, allowedDomain string) error {
	if !c.EmailVerified {
		return fmt.Errorf("auth: email not verified")
	}
	if !strings.EqualFold(c.HostedDomain, allowedDomain) {
		return fmt.Errorf("auth: hosted domain %q not allowed", c.HostedDomain)
	}
	if !strings.HasSuffix(strings.ToLower(c.Email), "@"+strings.ToLower(allowedDomain)) {
		return fmt.Errorf("auth: email %q outside allowed domain", c.Email)
	}
	return nil
}
