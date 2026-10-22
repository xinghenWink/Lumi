package upstream

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// NetworkPolicy is explicit so self-hosted private networks cannot be enabled by a URL alone.
type NetworkPolicy struct {
	AllowPrivate bool
}

func ParseURL(value string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed == nil || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		parsed.Opaque != "" || parsed.ForceQuery || strings.ContainsAny(value, "\r\n\t\\") {
		return nil, fmt.Errorf("invalid upstream URL")
	}
	if port := parsed.Port(); port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 1 || number > 65535 {
			return nil, fmt.Errorf("invalid upstream port")
		}
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawPath = ""
	return parsed, nil
}

func publicAddress(address netip.Addr) bool {
	address = address.Unmap()
	if !address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() {
		return false
	}
	// Carrier-grade NAT, benchmark and reserved ranges also cannot be dialed by default.
	for _, value := range []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32", "2001::/32"} {
		prefix, err := netip.ParsePrefix(value)
		if err == nil && prefix.Contains(address) {
			return false
		}
	}
	return true
}

func (p NetworkPolicy) addresses(ctx context.Context, host string) ([]netip.Addr, error) {
	addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, fmt.Errorf("resolve upstream host: %w", err)
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("upstream host has no addresses")
	}
	for _, address := range addresses {
		if !p.AllowPrivate && !publicAddress(address) {
			return nil, fmt.Errorf("upstream address is outside the network policy")
		}
	}
	return addresses, nil
}

func (p NetworkPolicy) dial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("split upstream address: %w", err)
	}
	addresses, err := p.addresses(ctx, host)
	if err != nil {
		return nil, err
	}
	var last error
	for _, ip := range addresses {
		connection, err := (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return connection, nil
		}
		last = err
	}
	return nil, fmt.Errorf("dial upstream: %w", last)
}

func NewHTTPClient(proxy string, timeout time.Duration, policy NetworkPolicy) (*http.Client, error) {
	transport := &http.Transport{
		DialContext: policy.dial, TLSHandshakeTimeout: 10 * time.Second,
		ResponseHeaderTimeout: timeout, IdleConnTimeout: 30 * time.Second, MaxIdleConnsPerHost: 2,
	}
	if proxy != "" {
		parsed, err := ParseURL(proxy)
		if err != nil || parsed.Path != "" {
			return nil, fmt.Errorf("invalid upstream proxy")
		}
		transport.Proxy = http.ProxyURL(parsed)
	}
	return &http.Client{
		Transport: transport, Timeout: timeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}, nil
}

// ValidateDestination also checks the target when an explicit proxy performs DNS remotely.
func (p NetworkPolicy) ValidateDestination(ctx context.Context, target *url.URL) error {
	_, err := p.addresses(ctx, target.Hostname())
	return err
}
