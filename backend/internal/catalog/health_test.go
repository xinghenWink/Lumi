package catalog

import (
	"context"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"testing"
)

func TestBootstrapRejectsIncompleteCredentialsBeforeDatabaseAccess(t *testing.T) {
	service := &Service{}
	if err := service.Bootstrap(context.Background(), "", ""); err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][2]string{{"https://lumi.test/v1", ""}, {"", "fixture-key"}, {"https://lumi.test/v1", "   "}} {
		if err := service.Bootstrap(context.Background(), pair[0], pair[1]); err == nil {
			t.Fatal("accepted incomplete bootstrap credentials")
		}
	}
}

func TestWeightedOrderPreservesPriorityAndAllCandidates(t *testing.T) {
	rows := []query.AvailableModelRoutesRow{{UpstreamModelName: "a", RoutePriority: 0, RouteWeight: 1}, {UpstreamModelName: "b", RoutePriority: 0, RouteWeight: 100}, {UpstreamModelName: "fallback", RoutePriority: 1, RouteWeight: 10000}}
	for i := 0; i < 100; i++ {
		got, err := WeightedOrder(rows)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 3 || got[2].UpstreamModelName != "fallback" || got[0].UpstreamModelName == got[1].UpstreamModelName {
			t.Fatalf("invalid route order %+v", got)
		}
	}
	if rows[0].UpstreamModelName != "a" {
		t.Fatal("input routing snapshot changed")
	}
	if _, err := WeightedOrder([]query.AvailableModelRoutesRow{{RouteWeight: 0}}); err == nil {
		t.Fatal("accepted invalid weight")
	}
}
