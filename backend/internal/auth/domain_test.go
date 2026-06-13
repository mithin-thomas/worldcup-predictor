package auth

import "testing"

func TestCheckDomainAcceptsMatchingVerifiedHostedDomain(t *testing.T) {
	c := GoogleClaims{Email: "dev@sayonetech.com", EmailVerified: true, HostedDomain: "sayonetech.com"}
	if err := CheckDomain(c, "sayonetech.com"); err != nil {
		t.Fatalf("CheckDomain() = %v, want nil", err)
	}
}

func TestCheckDomainRejectsWrongHostedDomain(t *testing.T) {
	c := GoogleClaims{Email: "x@gmail.com", EmailVerified: true, HostedDomain: "gmail.com"}
	if err := CheckDomain(c, "sayonetech.com"); err == nil {
		t.Fatal("CheckDomain() = nil, want error for wrong hd")
	}
}

func TestCheckDomainRejectsUnverifiedEmail(t *testing.T) {
	c := GoogleClaims{Email: "dev@sayonetech.com", EmailVerified: false, HostedDomain: "sayonetech.com"}
	if err := CheckDomain(c, "sayonetech.com"); err == nil {
		t.Fatal("CheckDomain() = nil, want error for email_verified=false")
	}
}

func TestCheckDomainRejectsMismatchedEmailSuffix(t *testing.T) {
	c := GoogleClaims{Email: "attacker@evil.com", EmailVerified: true, HostedDomain: "sayonetech.com"}
	if err := CheckDomain(c, "sayonetech.com"); err == nil {
		t.Fatal("CheckDomain() = nil, want error when email suffix != domain")
	}
}
