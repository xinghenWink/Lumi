package mailer

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/xinghenWink/Lumi/backend/internal/settings"
)

type staticSettings struct{ value settings.Snapshot }

func (s staticSettings) Read(context.Context) (settings.Snapshot, error) { return s.value, nil }

func TestDevelopmentCodeLoggingIsExplicitAndRedacted(t *testing.T) {
	var output bytes.Buffer
	configuration := staticSettings{value: settings.Snapshot{Site: settings.Site{Name: "Lumi"}}}
	development := New(configuration, "development", slog.New(slog.NewJSONHandler(&output, nil)))
	if err := development.SendCode(t.Context(), "private@lumi.test", "123456", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(output.String(), "private@lumi.test") || !strings.Contains(output.String(), "123456") {
		t.Fatal("development log did not mask the email")
	}
	output.Reset()
	production := New(configuration, "production", slog.New(slog.NewJSONHandler(&output, nil)))
	if err := production.SendCode(t.Context(), "private@lumi.test", "123456", "zh-CN"); err == nil {
		t.Fatal("production without SMTP reported success")
	}
	if strings.Contains(output.String(), "123456") {
		t.Fatal("production logged a verification code")
	}
}

func TestSMTPDeliveryAndTranslation(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := listener.Close(); err != nil {
			t.Errorf("close SMTP listener: %v", err)
		}
	}()
	type result struct {
		message string
		err     error
	}
	delivered := make(chan result, 1)
	go func() { message, err := receiveSMTP(listener); delivered <- result{message, err} }()
	_, portText, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}
	configuration := staticSettings{value: settings.Snapshot{Site: settings.Site{Name: "Lumi"}, Mail: settings.Mail{Host: "127.0.0.1", Port: port, From: "noreply@lumi.test", Encryption: "none"}}}
	service := New(configuration, "test", slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err := service.SendCode(t.Context(), "member@lumi.test", "654321", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	select {
	case message := <-delivered:
		if message.err != nil {
			t.Fatal(message.err)
		}
		_, encoded, ok := strings.Cut(message.message, "\r\n\r\n")
		if !ok {
			t.Fatal("SMTP message had no MIME body")
		}
		body, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), "654321") || !strings.Contains(string(body), "验证码") {
			t.Fatal("localized verification message was not delivered")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("SMTP delivery timed out")
	}
}

func receiveSMTP(listener net.Listener) (message string, resultErr error) {
	connection, err := listener.Accept()
	if err != nil {
		return "", fmt.Errorf("accept SMTP: %w", err)
	}
	defer func() {
		if err := connection.Close(); err != nil && resultErr == nil {
			resultErr = fmt.Errorf("close test SMTP: %w", err)
		}
	}()
	if err := connection.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return "", fmt.Errorf("set test SMTP timeout: %w", err)
	}
	reader := bufio.NewReader(connection)
	writer := bufio.NewWriter(connection)
	reply := func(value string) error {
		if _, err := writer.WriteString(value); err != nil {
			return fmt.Errorf("write SMTP reply: %w", err)
		}
		if err := writer.Flush(); err != nil {
			return fmt.Errorf("flush SMTP reply: %w", err)
		}
		return nil
	}
	if err := reply("220 localhost ESMTP\r\n"); err != nil {
		return "", err
	}
	var content strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return "", fmt.Errorf("read SMTP command: %w", err)
		}
		switch {
		case strings.HasPrefix(line, "EHLO"), strings.HasPrefix(line, "HELO"):
			err = reply("250 localhost\r\n")
		case strings.HasPrefix(line, "MAIL FROM:"), strings.HasPrefix(line, "RCPT TO:"):
			err = reply("250 accepted\r\n")
		case strings.HasPrefix(line, "DATA"):
			if err := reply("354 send message\r\n"); err != nil {
				return "", err
			}
			for {
				part, err := reader.ReadString('\n')
				if err != nil {
					return "", fmt.Errorf("read SMTP message: %w", err)
				}
				if part == ".\r\n" {
					break
				}
				content.WriteString(part)
			}
			err = reply("250 delivered\r\n")
		case strings.HasPrefix(line, "QUIT"):
			if err := reply("221 goodbye\r\n"); err != nil {
				return "", err
			}
			return content.String(), nil
		default:
			err = reply("500 unsupported\r\n")
		}
		if err != nil {
			return "", err
		}
	}
}
