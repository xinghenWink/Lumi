package mailer

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/settings"
)

//go:embed locales/*.json
var messages embed.FS

type Settings interface {
	Read(context.Context) (settings.Snapshot, error)
}
type Service struct {
	settings    Settings
	environment string
	logger      *slog.Logger
}

func New(settings Settings, environment string, logger *slog.Logger) *Service {
	return &Service{settings: settings, environment: environment, logger: logger}
}

func (s *Service) SendCode(ctx context.Context, email, code, locale string) error {
	configuration, err := s.settings.Read(ctx)
	if err != nil {
		return err
	}
	if s.environment == "development" && configuration.Mail.Host == "" {
		// Explicit development-only exception: never log codes in test/production.
		s.logger.InfoContext(ctx, "development verification code", "target", validation.MaskEmail(email), "code", code)
		return nil
	}
	if configuration.Mail.Host == "" {
		return problem.New("SMTP_UNAVAILABLE", http.StatusServiceUnavailable)
	}
	message, err := message(configuration.Site.Name, email, code, locale, configuration.Mail.From)
	if err != nil {
		return err
	}
	if err := s.deliver(ctx, configuration.Mail, email, message); err != nil {
		// SMTP replies can contain credentials or recipient addresses.
		s.logger.ErrorContext(ctx, "verification email delivery failed")
		return problem.New("SMTP_UNAVAILABLE", http.StatusServiceUnavailable)
	}
	return nil
}

func (s *Service) deliver(ctx context.Context, configuration settings.Mail, email, body string) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	address := net.JoinHostPort(configuration.Host, strconv.Itoa(configuration.Port))
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	var connection net.Conn
	var err error
	tlsConfig := &tls.Config{ServerName: configuration.Host, MinVersion: tls.VersionTLS12}
	if configuration.Encryption == "tls" {
		connection, err = (&tls.Dialer{NetDialer: dialer, Config: tlsConfig}).DialContext(ctx, "tcp", address)
	} else {
		connection, err = dialer.DialContext(ctx, "tcp", address)
	}
	if err != nil {
		return fmt.Errorf("connect SMTP: %w", err)
	}
	defer func() {
		if err := connection.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			s.logger.Debug("SMTP connection close failed")
		}
	}()
	stop := context.AfterFunc(ctx, func() {
		if err := connection.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			s.logger.Debug("SMTP cancellation close failed")
		}
	})
	defer stop()
	if deadline, ok := ctx.Deadline(); ok {
		if err := connection.SetDeadline(deadline); err != nil {
			return fmt.Errorf("set SMTP deadline: %w", err)
		}
	}
	client, err := smtp.NewClient(connection, configuration.Host)
	if err != nil {
		return fmt.Errorf("initialize SMTP: %w", err)
	}
	if configuration.Encryption == "starttls" {
		if err := client.StartTLS(tlsConfig); err != nil {
			return fmt.Errorf("negotiate SMTP TLS: %w", err)
		}
	}
	if configuration.Username != "" {
		if err := client.Auth(smtp.PlainAuth("", configuration.Username, configuration.Password, configuration.Host)); err != nil {
			return fmt.Errorf("authenticate SMTP: %w", err)
		}
	}
	if err := client.Mail(configuration.From); err != nil {
		return fmt.Errorf("set SMTP sender: %w", err)
	}
	if err := client.Rcpt(email); err != nil {
		return fmt.Errorf("set SMTP recipient: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("open SMTP body: %w", err)
	}
	if _, err := writer.Write([]byte(body)); err != nil {
		if closeErr := writer.Close(); closeErr != nil {
			s.logger.Debug("SMTP body close failed")
		}
		return fmt.Errorf("write SMTP body: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("complete SMTP body: %w", err)
	}
	if err := client.Quit(); err != nil {
		return fmt.Errorf("close SMTP session: %w", err)
	}
	return nil
}

func message(site, email, code, locale, from string) (string, error) {
	if locale != "en" {
		locale = "zh-CN"
	}
	data, err := messages.ReadFile("locales/" + locale + ".json")
	if err != nil {
		return "", fmt.Errorf("read mail translations: %w", err)
	}
	var template struct {
		Subject string `json:"subject"`
		Body    string `json:"body"`
	}
	if err := json.Unmarshal(data, &template); err != nil {
		return "", fmt.Errorf("decode mail translations: %w", err)
	}
	replacer := strings.NewReplacer("{site}", site, "{code}", code)
	subject := mime.QEncoding.Encode("UTF-8", replacer.Replace(template.Subject))
	body := base64.StdEncoding.EncodeToString([]byte(replacer.Replace(template.Body)))
	return "From: " + from + "\r\nTo: " + email + "\r\nSubject: " + subject + "\r\nDate: " + time.Now().UTC().Format(time.RFC1123Z) + "\r\nMessage-ID: <" + rand.Text() + "@localhost>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + body + "\r\n", nil
}
