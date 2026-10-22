package settings

import (
	"context"
	"testing"
	"time"
)

func TestCacheInvalidationAndEnvironmentPrecedence(t *testing.T) {
	now := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	calls := 0
	s := Service{now: func() time.Time { return now }, overrides: map[string]string{"SITE_NAME": "Environment name"}, load: func(context.Context) (Snapshot, error) {
		calls++
		value := defaults()
		value.Site.Name = "Database name"
		return value, nil
	}}
	first, err := s.Read(t.Context())
	if err != nil || first.Site.Name != "Environment name" {
		t.Fatalf("read: %+v %v", first, err)
	}
	first.Registration.DomainAllowlist = append(first.Registration.DomainAllowlist, "changed.test")
	second, err := s.Read(t.Context())
	if err != nil || calls != 1 || len(second.Registration.DomainAllowlist) != 0 {
		t.Fatalf("cache state: calls=%d error=%v", calls, err)
	}
	s.Invalidate()
	if _, err := s.Read(t.Context()); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatal("save invalidation did not reload")
	}
	now = now.Add(31 * time.Second)
	if _, err := s.Read(t.Context()); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatal("cache did not expire")
	}
}

func TestMailSecurityAndDomains(t *testing.T) {
	s := Service{environment: "production"}
	if err := s.validateMail(Mail{Host: "smtp.lumi.test", Port: 25, From: "mail@lumi.test", Encryption: "none"}); err == nil {
		t.Fatal("production accepted plaintext SMTP")
	}
	value := defaults().Registration
	value.DomainAllowlist = []string{" Example.COM ", "example.com"}
	if err := validateRegistration(&value); err != nil || len(value.DomainAllowlist) != 1 || value.DomainAllowlist[0] != "example.com" {
		t.Fatalf("domain normalization: %v", err)
	}
	value.DomainBlocklist = []string{"https://invalid.test"}
	if err := validateRegistration(&value); err == nil {
		t.Fatal("accepted invalid domain list")
	}
}
