package settings

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/secrets"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type Site struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Footer      string `json:"footer"`
	Contact     string `json:"contact"`
	TermsURL    string `json:"terms_url"`
	PrivacyURL  string `json:"privacy_url"`
}
type Registration struct {
	Enabled                  bool     `json:"enabled"`
	EmailVerificationEnabled bool     `json:"email_verification_enabled"`
	DomainAllowlist          []string `json:"domain_allowlist"`
	DomainBlocklist          []string `json:"domain_blocklist"`
	LoginFailureLimit        int      `json:"login_failure_limit"`
	LoginLockMinutes         int      `json:"login_lock_minutes"`
	LoginPerMinute           int      `json:"login_per_minute"`
	RegisterPerMinute        int      `json:"register_per_minute"`
	CodePerMinute            int      `json:"code_per_minute"`
}
type Mail struct {
	Host              string `json:"host"`
	Port              int    `json:"port"`
	Username          string `json:"username"`
	From              string `json:"from"`
	Encryption        string `json:"encryption"`
	PasswordEncrypted string `json:"password_encrypted,omitempty"`
	Password          string `json:"-"`
}
type Snapshot struct {
	Site         Site
	Registration Registration
	Mail         Mail
}
type MailView struct {
	Host               string `json:"host"`
	Port               int    `json:"port"`
	Username           string `json:"username"`
	From               string `json:"from"`
	Encryption         string `json:"encryption"`
	PasswordConfigured bool   `json:"password_configured"`
}
type View struct {
	Site         Site         `json:"site"`
	Registration Registration `json:"registration"`
	Mail         MailView     `json:"mail"`
	EnvOverrides []string     `json:"env_overrides"`
}
type MailInput struct {
	Host       string  `json:"host"`
	Port       int     `json:"port"`
	Username   string  `json:"username"`
	From       string  `json:"from"`
	Encryption string  `json:"encryption"`
	Password   *string `json:"password,omitempty"`
}
type Update struct {
	Site         *Site         `json:"site,omitempty"`
	Registration *Registration `json:"registration,omitempty"`
	Mail         *MailInput    `json:"mail,omitempty"`
}
type Public struct {
	Site                     Site `json:"site"`
	RegistrationEnabled      bool `json:"registration_enabled"`
	EmailVerificationEnabled bool `json:"email_verification_enabled"`
}

type Service struct {
	pool        *pgxpool.Pool
	vault       *secrets.Vault
	environment string
	overrides   map[string]string
	mu          sync.Mutex
	cached      Snapshot
	expires     time.Time
	generation  uint64
	load        func(context.Context) (Snapshot, error)
	now         func() time.Time
}

func New(pool *pgxpool.Pool, vault *secrets.Vault, environment string, overrides map[string]string) *Service {
	copyOverrides := make(map[string]string, len(overrides))
	for key, value := range overrides {
		copyOverrides[key] = value
	}
	s := &Service{pool: pool, vault: vault, environment: environment, overrides: copyOverrides, now: time.Now}
	s.load = func(ctx context.Context) (Snapshot, error) { return s.read(ctx, query.New(pool)) }
	return s
}

func (s *Service) Read(ctx context.Context) (Snapshot, error) {
	for {
		s.mu.Lock()
		if s.now().Before(s.expires) {
			result := clone(s.cached)
			s.mu.Unlock()
			return result, nil
		}
		generation := s.generation
		s.mu.Unlock()
		value, err := s.load(ctx)
		if err != nil {
			return Snapshot{}, err
		}
		if err := s.applyOverrides(&value); err != nil {
			return Snapshot{}, err
		}
		s.mu.Lock()
		if generation == s.generation {
			s.cached = clone(value)
			s.expires = s.now().Add(30 * time.Second)
			s.mu.Unlock()
			return value, nil
		}
		s.mu.Unlock()
		if err := ctx.Err(); err != nil {
			return Snapshot{}, fmt.Errorf("reload settings: %w", err)
		}
	}
}

func (s *Service) Invalidate() { s.mu.Lock(); s.expires = time.Time{}; s.generation++; s.mu.Unlock() }

func (s *Service) Public(ctx context.Context) (Public, error) {
	value, err := s.Read(ctx)
	if err != nil {
		return Public{}, err
	}
	return Public{Site: value.Site, RegistrationEnabled: value.Registration.Enabled, EmailVerificationEnabled: value.Registration.EmailVerificationEnabled}, nil
}
func (s *Service) View(ctx context.Context) (View, error) {
	value, err := s.Read(ctx)
	if err != nil {
		return View{}, err
	}
	return s.view(value), nil
}

func (s *Service) Save(ctx context.Context, actor user.Actor, group string, input Update) (View, error) {
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		before, err := s.read(ctx, q)
		if err != nil {
			return err
		}
		after := clone(before)
		var encoded []byte
		switch group {
		case "site":
			if input.Site == nil || input.Registration != nil || input.Mail != nil {
				return problem.Invalid()
			}
			after.Site = *input.Site
			if !validation.Text(after.Site.Name, 1, 40) || !validation.Text(after.Site.Description, 0, 200) || !validation.Text(after.Site.Footer, 0, 200) || !validation.Text(after.Site.Contact, 0, 200) || !validation.Link(after.Site.TermsURL) || !validation.Link(after.Site.PrivacyURL) {
				return problem.Invalid()
			}
			encoded, err = json.Marshal(after.Site)
		case "registration":
			if input.Registration == nil || input.Site != nil || input.Mail != nil {
				return problem.Invalid()
			}
			after.Registration = *input.Registration
			if err := validateRegistration(&after.Registration); err != nil {
				return err
			}
			encoded, err = json.Marshal(after.Registration)
		case "mail":
			if input.Mail == nil || input.Site != nil || input.Registration != nil {
				return problem.Invalid()
			}
			candidate := input.Mail
			after.Mail.Host = strings.TrimSpace(candidate.Host)
			after.Mail.Port = candidate.Port
			after.Mail.Username = candidate.Username
			after.Mail.From = candidate.From
			after.Mail.Encryption = candidate.Encryption
			if candidate.Password != nil {
				if len(*candidate.Password) > 4096 {
					return problem.Invalid()
				}
				after.Mail.Password = *candidate.Password
				after.Mail.PasswordEncrypted, err = s.vault.Encrypt(*candidate.Password, "settings.mail.password")
				if err != nil {
					return err
				}
			}
			if err := s.validateMail(after.Mail); err != nil {
				return err
			}
			encoded, err = json.Marshal(after.Mail)
		default:
			return problem.Invalid()
		}
		if err != nil {
			return fmt.Errorf("encode settings: %w", err)
		}
		if err := q.SaveSetting(ctx, query.SaveSettingParams{Key: group, Value: encoded, UpdatedBy: &actor.ID}); err != nil {
			return fmt.Errorf("save settings: %w", err)
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "settings.update", TargetType: group, Before: s.auditView(before), After: s.auditView(after), IP: actor.IP})
	})
	if err != nil {
		return View{}, err
	}
	s.Invalidate()
	return s.View(ctx)
}

func (s *Service) read(ctx context.Context, q *query.Queries) (Snapshot, error) {
	records, err := q.ListSettings(ctx)
	if err != nil {
		return Snapshot{}, fmt.Errorf("load settings: %w", err)
	}
	value := defaults()
	for _, record := range records {
		switch record.Key {
		case "site":
			err = json.Unmarshal(record.Value, &value.Site)
		case "registration":
			err = json.Unmarshal(record.Value, &value.Registration)
		case "mail":
			err = json.Unmarshal(record.Value, &value.Mail)
		}
		if err != nil {
			return Snapshot{}, fmt.Errorf("decode settings: %w", err)
		}
	}
	value.Mail.Password, err = s.vault.Decrypt(value.Mail.PasswordEncrypted, "settings.mail.password")
	if err != nil {
		return Snapshot{}, fmt.Errorf("decrypt mail settings: %w", err)
	}
	return value, nil
}

func defaults() Snapshot {
	return Snapshot{Site: Site{Name: "Lumi", Description: "对话与生图", Footer: "给灵感一点空间。", TermsURL: "/terms", PrivacyURL: "/privacy"}, Registration: Registration{Enabled: true, EmailVerificationEnabled: true, DomainAllowlist: []string{}, DomainBlocklist: []string{}, LoginFailureLimit: 5, LoginLockMinutes: 15, LoginPerMinute: 20, RegisterPerMinute: 10, CodePerMinute: 3}, Mail: Mail{Port: 587, Encryption: "starttls"}}
}
func clone(value Snapshot) Snapshot {
	value.Registration.DomainAllowlist = slices.Clone(value.Registration.DomainAllowlist)
	value.Registration.DomainBlocklist = slices.Clone(value.Registration.DomainBlocklist)
	return value
}

func (s *Service) view(value Snapshot) View {
	overrides := make([]string, 0, len(s.overrides))
	for key := range s.overrides {
		if field := environmentField(key); field != "" {
			overrides = append(overrides, field)
		}
	}
	slices.Sort(overrides)
	return View{Site: value.Site, Registration: value.Registration, Mail: MailView{Host: value.Mail.Host, Port: value.Mail.Port, Username: value.Mail.Username, From: value.Mail.From, Encryption: value.Mail.Encryption, PasswordConfigured: value.Mail.Password != ""}, EnvOverrides: overrides}
}

func (s *Service) auditView(value Snapshot) View {
	view := s.view(value)
	if view.Mail.Username != "" {
		view.Mail.Username = validation.MaskEmail(view.Mail.Username)
	}
	if view.Mail.From != "" {
		view.Mail.From = validation.MaskEmail(view.Mail.From)
	}
	if email, err := validation.Email(view.Site.Contact); err == nil {
		view.Site.Contact = validation.MaskEmail(email)
	}
	return view
}

func validateRegistration(value *Registration) error {
	if value.LoginFailureLimit < 3 || value.LoginFailureLimit > 20 || value.LoginLockMinutes < 1 || value.LoginLockMinutes > 120 || value.LoginPerMinute < 1 || value.LoginPerMinute > 120 || value.RegisterPerMinute < 1 || value.RegisterPerMinute > 60 || value.CodePerMinute < 1 || value.CodePerMinute > 20 {
		return problem.Invalid()
	}
	for _, list := range []*[]string{&value.DomainAllowlist, &value.DomainBlocklist} {
		if len(*list) > 100 {
			return problem.Invalid()
		}
		result := make([]string, 0, len(*list))
		for _, domain := range *list {
			domain = strings.ToLower(strings.TrimSpace(domain))
			if !validation.Domain(domain) {
				return problem.Invalid()
			}
			if !slices.Contains(result, domain) {
				result = append(result, domain)
			}
		}
		*list = result
	}
	return nil
}

func (s *Service) validateMail(value Mail) error {
	if value.Port < 1 || value.Port > 65535 || !validation.Text(value.Host, 0, 253) || !validation.Text(value.Username, 0, 254) {
		return problem.Invalid()
	}
	if value.Encryption != "starttls" && value.Encryption != "tls" && value.Encryption != "none" {
		return problem.Invalid()
	}
	if value.Host != "" {
		if _, err := netip.ParseAddr(value.Host); err != nil && value.Host != "localhost" && !validation.Domain(strings.ToLower(value.Host)) {
			return problem.Invalid()
		}
		if _, err := validation.Email(value.From); err != nil {
			return problem.Invalid()
		}
		if value.Encryption == "none" {
			ip, err := netip.ParseAddr(value.Host)
			if s.environment == "production" || (value.Host != "localhost" && (err != nil || !ip.IsLoopback())) {
				return problem.New("SMTP_TLS_REQUIRED", http.StatusBadRequest)
			}
		}
	}
	return nil
}

func (s *Service) applyOverrides(value *Snapshot) error {
	for key, text := range s.overrides {
		switch key {
		case "SITE_NAME":
			value.Site.Name = text
		case "REGISTRATION_ENABLED":
			parsed, err := strconv.ParseBool(text)
			if err != nil {
				return fmt.Errorf("parse registration override: %w", err)
			}
			value.Registration.Enabled = parsed
		case "EMAIL_VERIFICATION_ENABLED":
			parsed, err := strconv.ParseBool(text)
			if err != nil {
				return fmt.Errorf("parse verification override: %w", err)
			}
			value.Registration.EmailVerificationEnabled = parsed
		case "EMAIL_DOMAIN_ALLOWLIST":
			value.Registration.DomainAllowlist = strings.Split(text, ",")
		case "EMAIL_DOMAIN_BLOCKLIST":
			value.Registration.DomainBlocklist = strings.Split(text, ",")
		case "SMTP_HOST":
			value.Mail.Host = text
		case "SMTP_PORT":
			port, err := strconv.Atoi(text)
			if err != nil {
				return fmt.Errorf("parse SMTP port override: %w", err)
			}
			value.Mail.Port = port
		case "SMTP_USERNAME":
			value.Mail.Username = text
		case "SMTP_PASSWORD":
			value.Mail.Password = text
		case "SMTP_FROM":
			value.Mail.From = text
		case "SMTP_ENCRYPTION":
			value.Mail.Encryption = text
		}
	}
	if !validation.Text(value.Site.Name, 1, 40) {
		return problem.Invalid()
	}
	if err := validateRegistration(&value.Registration); err != nil {
		return err
	}
	return s.validateMail(value.Mail)
}

func environmentField(key string) string {
	switch key {
	case "SITE_NAME":
		return "site.name"
	case "REGISTRATION_ENABLED":
		return "registration.enabled"
	case "EMAIL_VERIFICATION_ENABLED":
		return "registration.email_verification_enabled"
	case "EMAIL_DOMAIN_ALLOWLIST":
		return "registration.domain_allowlist"
	case "EMAIL_DOMAIN_BLOCKLIST":
		return "registration.domain_blocklist"
	case "SMTP_HOST":
		return "mail.host"
	case "SMTP_PORT":
		return "mail.port"
	case "SMTP_USERNAME":
		return "mail.username"
	case "SMTP_PASSWORD":
		return "mail.password"
	case "SMTP_FROM":
		return "mail.from"
	case "SMTP_ENCRYPTION":
		return "mail.encryption"
	}
	return ""
}
