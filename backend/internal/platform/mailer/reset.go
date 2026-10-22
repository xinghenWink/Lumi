package mailer

import (
	"context"
	"encoding/json"
	"fmt"
	"mime"
	"strings"

	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

func (s *Service) SendReset(ctx context.Context, email, link, locale string) error {
	cfg, err := s.settings.Read(ctx)
	if err != nil {
		return err
	}
	if cfg.Mail.Host == "" {
		return problem.New("SMTP_UNAVAILABLE", 503)
	}
	if locale != "en" {
		locale = "zh-CN"
	}
	raw, err := messages.ReadFile("locales/" + locale + ".json")
	if err != nil {
		return fmt.Errorf("read reset translations: %w", err)
	}
	var catalog struct {
		ResetSubject string `json:"reset_subject"`
		ResetBody    string `json:"reset_body"`
	}
	if err := json.Unmarshal(raw, &catalog); err != nil {
		return fmt.Errorf("decode reset translations: %w", err)
	}
	body := strings.ReplaceAll(catalog.ResetBody, "{link}", link)
	message := "From: " + cfg.Mail.From + "\r\nTo: " + email + "\r\nSubject: " + mime.QEncoding.Encode("UTF-8", catalog.ResetSubject) + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body
	if err := s.deliver(ctx, cfg.Mail, email, message); err != nil {
		return problem.New("SMTP_UNAVAILABLE", 503)
	}
	return nil
}
func (s *Service) SendTest(ctx context.Context, email, locale string) error {
	cfg, err := s.settings.Read(ctx)
	if err != nil {
		return err
	}
	if cfg.Mail.Host == "" {
		return problem.New("SMTP_UNAVAILABLE", 503)
	}
	if locale != "en" {
		locale = "zh-CN"
	}
	raw, err := messages.ReadFile("locales/" + locale + ".json")
	if err != nil {
		return fmt.Errorf("read test mail translations: %w", err)
	}
	var catalog struct {
		Subject string `json:"test_subject"`
		Body    string `json:"test_body"`
	}
	if err := json.Unmarshal(raw, &catalog); err != nil {
		return fmt.Errorf("decode test mail translations: %w", err)
	}
	message := "From: " + cfg.Mail.From + "\r\nTo: " + email + "\r\nSubject: " + mime.QEncoding.Encode("UTF-8", catalog.Subject) + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + catalog.Body
	if err := s.deliver(ctx, cfg.Mail, email, message); err != nil {
		return problem.New("SMTP_UNAVAILABLE", 503)
	}
	return nil
}
