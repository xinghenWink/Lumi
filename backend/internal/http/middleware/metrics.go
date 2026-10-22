package middleware

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type metricValue struct {
	Count   uint64
	Seconds float64
}

// Metrics belongs to one server instance; labels use bounded route templates.
type Metrics struct {
	mu     sync.Mutex
	values map[string]metricValue
}

func NewMetrics() *Metrics { return &Metrics{values: map[string]metricValue{}} }
func (m *Metrics) Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		key := fmt.Sprintf("route=%q,status=%q", route, fmt.Sprint(c.Writer.Status()))
		m.mu.Lock()
		v := m.values[key]
		v.Count++
		v.Seconds += time.Since(start).Seconds()
		m.values[key] = v
		m.mu.Unlock()
	}
}
func (m *Metrics) Render() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	keys := make([]string, 0, len(m.values))
	for k := range m.values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var out strings.Builder
	out.WriteString("# TYPE lumi_http_requests_total counter\n# TYPE lumi_http_request_duration_seconds summary\n")
	for _, k := range keys {
		v := m.values[k]
		fmt.Fprintf(&out, "lumi_http_requests_total{%s} %d\nlumi_http_request_duration_seconds_sum{%s} %g\nlumi_http_request_duration_seconds_count{%s} %d\n", k, v.Count, k, v.Seconds, k, v.Count)
	}
	return out.String()
}
