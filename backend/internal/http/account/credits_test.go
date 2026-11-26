package account

import "testing"

func TestCSVFormulaInjection(t *testing.T) {
	for _, value := range []string{"=HYPERLINK(\"https://invalid\")", " +SUM(1,2)", "-cmd|' /C calc'!A0", "@SUM(A1)", "\tformula", "\nformula", "\ufeff=SUM(A1)", "\u00a0@SUM(A1)"} {
		if got := csvCell(value); len(got) == 0 || got[0] != '\'' {
			t.Errorf("unescaped CSV cell %q", value)
		}
	}
	for _, value := range []string{"-100", "100", "LUMI-ABCD-EFGH-JKMN-PQRS", "normal note"} {
		if got := csvCell(value); got != value {
			t.Errorf("changed safe cell %q to %q", value, got)
		}
	}
}

func TestCSVTranslations(t *testing.T) {
	for _, locale := range []string{"zh-CN", "en"} {
		catalog, err := loadCSVCatalog(locale)
		if err != nil || len(catalog.LedgerHeaders) != 12 || len(catalog.CodeHeaders) != 9 || len(catalog.Types) != 11 || len(catalog.Buckets) != 3 || len(catalog.States) != 4 {
			t.Fatalf("CSV translations locale=%s error=%v", locale, err)
		}
		if catalog.Types["video_charge"] == "" || catalog.Types["video_refund"] == "" || catalog.Buckets["video"] == "" {
			t.Fatalf("missing video credit translations for %s", locale)
		}
		if catalog.Types["referral_inviter_bonus"] == "" || catalog.Types["referral_invitee_bonus"] == "" {
			t.Fatalf("missing referral ledger translations for %s", locale)
		}
	}
}
