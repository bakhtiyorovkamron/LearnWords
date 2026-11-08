package domain

import (
	"encoding/json"
	"testing"
)

func TestNewTelegramStats_PercentHasOneDecimal(t *testing.T) {
	for _, c := range []struct {
		total, connected int
		want             float64
	}{
		{3, 1, 33.3},   // 33.333…
		{3, 2, 66.7},   // 66.666…
		{8, 1, 12.5},   // exact
		{16, 1, 6.3},   // 6.25: half rounds away from zero
		{2000, 1, 0.1}, // 0.05
		{3000, 1, 0},   // 0.033…
		{200, 199, 99.5},
		{7, 7, 100},
		{5, 0, 0},
	} {
		if got := NewTelegramStats(c.total, c.connected, 0).Percent; got != c.want {
			t.Errorf("%d of %d: %v%%, want %v%%", c.connected, c.total, got, c.want)
		}
	}
}

func TestNewTelegramStats_NoUsersIsZeroPercent(t *testing.T) {
	s := NewTelegramStats(0, 0, 0)
	if s.Percent != 0 {
		t.Fatalf("percent %v, want 0", s.Percent)
	}
	b, _ := json.Marshal(s)
	if string(b) != `{"total_users":0,"connected":0,"percent":0,"connected_last_7d":0}` {
		t.Errorf("json %s", b)
	}
	if got := NewTelegramStats(4, 1, 1); got != (TelegramStats{TotalUsers: 4, Connected: 1, Percent: 25, ConnectedLast7d: 1}) {
		t.Errorf("%+v", got)
	}
}
