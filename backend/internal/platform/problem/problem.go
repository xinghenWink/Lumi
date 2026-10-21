package problem

import "net/http"

// Error contains a safe diagnostic fallback; clients translate Code through i18n.
type Error struct {
	Code       string
	Status     int
	RetryAfter int
}

func (e *Error) Error() string { return e.Code }

func Retry(code string, seconds int) error {
	return &Error{Code: code, Status: http.StatusTooManyRequests, RetryAfter: seconds}
}

func New(code string, status int) error { return &Error{Code: code, Status: status} }
func Invalid() error                    { return New("INVALID_INPUT", http.StatusBadRequest) }
func Unauthorized() error               { return New("AUTH_REQUIRED", http.StatusUnauthorized) }
func Forbidden() error                  { return New("FORBIDDEN", http.StatusForbidden) }
