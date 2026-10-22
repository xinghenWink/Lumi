package account

import "testing"

func TestCSVFormulaInjection(t *testing.T) {
	for _, value := range []string{"=HYPERLINK(\"https://invalid\")", " +SUM(1,2)", "-cmd|' /C calc'!A0", "@SUM(A1)", "\tformula", "\nformula"} {
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
