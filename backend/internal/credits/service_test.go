package credits

import (
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"testing"
	"time"
)

func TestCalendarBoundaries(t *testing.T) {
	for _, test := range []struct{ stamp, zone, date string }{
		{"2026-10-22T15:59:59Z", "Asia/Shanghai", "2026-10-22"},
		{"2026-10-22T16:00:00Z", "Asia/Shanghai", "2026-10-23"},
		{"2026-03-08T04:59:59Z", "America/New_York", "2026-03-07"},
		{"2026-03-08T05:00:00Z", "America/New_York", "2026-03-08"},
	} {
		at, err := time.Parse(time.RFC3339, test.stamp)
		if err != nil {
			t.Fatal(err)
		}
		day, _, err := calendar(at, test.zone)
		if err != nil || day.Format(time.DateOnly) != test.date {
			t.Fatalf("calendar(%s,%s)=%v error=%v", test.stamp, test.zone, day, err)
		}
	}
	at := time.Date(2026, 3, 8, 5, 0, 0, 0, time.UTC)
	day, _, err := calendar(at, "America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	view, err := accountView(query.CreditAccount{DailyResetOn: &day}, Configuration{CreditsTimezone: "America/New_York"}, at)
	if err != nil {
		t.Fatal(err)
	}
	if duration := view.NextResetAt.Sub(at); duration != 23*time.Hour {
		t.Fatalf("DST reset interval=%v", duration)
	}
}
func TestUntrustedCreditInputs(t *testing.T) {
	for _, value := range []string{"", "-1", "NaN", "1/2", "1e3", "101", "0.00001", "1.2.3"} {
		if _, err := multiplier(value); err == nil {
			t.Errorf("accepted multiplier %q", value)
		}
	}
	for _, value := range []string{"0", "0.0001", "1.2500", "100.0000"} {
		if _, err := multiplier(value); err != nil {
			t.Errorf("rejected multiplier %q", value)
		}
	}
	for _, value := range []string{"", "01x10", "1x0", "65537x1024", "1024X1024", "1024x1024x2"} {
		if validSize(value) {
			t.Errorf("accepted size %q", value)
		}
	}
	for _, value := range []string{"", "short", "with spaces", "bad\nheader"} {
		if ValidKey(value) {
			t.Errorf("accepted key %q", value)
		}
	}
}
func TestRedeemCodeEntropyAndCanonicalization(t *testing.T) {
	seen := make(map[string]bool, 1000)
	for range 1000 {
		value, err := generateCode("LUMI")
		if err != nil {
			t.Fatal(err)
		}
		if len(value) != 24 || seen[value] {
			t.Fatal("incorrect or repeated random code")
		}
		seen[value] = true
		canonical, err := normalizeCode(value)
		if err != nil || len(canonical) != 20 {
			t.Fatalf("normalize=%q error=%v", canonical, err)
		}
	}
	one, err := normalizeCode(" lumi-abcd-efgh-jkmn-pqrs ")
	if err != nil {
		t.Fatal(err)
	}
	two, err := normalizeCode("LUMIABCDEFGHJKMNPQRS")
	if err != nil || codeHash(one) != codeHash(two) {
		t.Fatal("code case or separators changed its identity")
	}
}
