package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/xinghenWink/Lumi/backend/internal/config"
	"github.com/xinghenWink/Lumi/backend/internal/http/account"
	"github.com/xinghenWink/Lumi/backend/internal/http/handler"
	"github.com/xinghenWink/Lumi/backend/internal/http/router"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	platformlogger "github.com/xinghenWink/Lumi/backend/internal/platform/logger"
	"github.com/xinghenWink/Lumi/backend/internal/platform/password"
	platformredis "github.com/xinghenWink/Lumi/backend/internal/platform/redis"
	"github.com/xinghenWink/Lumi/backend/internal/user"
	"github.com/xinghenWink/Lumi/backend/migrations"
	"github.com/xinghenWink/Lumi/backend/web"
)

// Build metadata is set once by the linker, never mutated at runtime.
var (
	version   = "dev"
	commit    = "unknown"
	buildTime = "unknown"
)

func main() {
	logger := platformlogger.New(os.Stdout, slog.LevelInfo)
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx, os.Args[1:], logger); err != nil {
		// Dependency errors can contain credentials; keep them out of logs.
		logger.Error("command failed", "error_type", fmt.Sprintf("%T", err))
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, logger *slog.Logger) error {
	command := "serve"
	if len(args) > 0 {
		command = args[0]
	}
	if command == "healthcheck" {
		return healthcheck(ctx, os.Getenv("HTTP_ADDR"))
	}
	resetEmail := ""
	if command == "admin" && len(args) == 4 && args[1] == "reset-password" && args[2] == "--email" {
		command = "reset-admin"
		resetEmail = args[3]
	}
	if command != "serve" && command != "migrate" && command != "reset-admin" || (command != "reset-admin" && len(args) > 1) {
		return fmt.Errorf("usage: lumi [serve|migrate|healthcheck|admin reset-password --email address]")
	}
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		return fmt.Errorf("load configuration: %w", err)
	}
	logger = platformlogger.New(os.Stdout, cfg.LogLevel)
	health := handler.Health{}
	var database *pgxpool.Pool
	var cache *platformredis.Client
	startup, cancelStartup := context.WithTimeout(ctx, 60*time.Second)
	defer cancelStartup()
	if (command == "migrate" || command == "reset-admin") && cfg.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required for migrations")
	}
	if cfg.DatabaseURL != "" {
		pool, err := db.Open(startup, cfg.DatabaseURL)
		if err != nil {
			logger.Error("PostgreSQL connection failed")
			return fmt.Errorf("open database: %w", err)
		}
		defer pool.Close()
		database = pool
		if err := migrations.Up(startup, pool); err != nil {
			logger.Error("database migration failed")
			return fmt.Errorf("migrate database: %w", err)
		}
		health.Postgres = pool.Ping
	}
	if command == "migrate" {
		logger.Info("database migrations completed")
		return nil
	}
	if command == "reset-admin" {
		passwords, err := password.New(startup)
		if err != nil {
			return err
		}
		if err := user.New(database, passwords, nil).ResetAdminPassword(startup, resetEmail, cfg.AdminResetPassword); err != nil {
			return fmt.Errorf("reset administrator password: %w", err)
		}
		logger.Info("administrator password reset completed")
		return nil
	}
	if cfg.RedisURL != "" {
		cache, err = platformredis.Open(startup, cfg.RedisURL)
		if err != nil {
			logger.Error("Redis connection failed")
			return fmt.Errorf("open Redis: %w", err)
		}
		defer func() {
			if err := cache.Close(); err != nil {
				logger.Error("Redis close failed")
			}
		}()
		health.Redis = cache.Ping
	}
	accounts, err := configureAccounts(startup, cfg, database, cache, logger)
	if err != nil {
		logger.Error("account service initialization failed")
		return fmt.Errorf("initialize accounts: %w", err)
	}
	if cfg.DatabaseURL == "" || cfg.RedisURL == "" {
		logger.Warn("development without dependencies; readiness will return 503")
	}
	content, err := web.Assets()
	if err != nil {
		return fmt.Errorf("load frontend: %w", err)
	}
	engine, err := router.New(logger, health, handler.Version{Version: version, Commit: commit, BuildTime: buildTime}, content,
		account.Routes(accounts, account.Security{Origins: cfg.AllowedOrigins(), CookieSecure: cfg.CookieSecure, TrustedProxies: cfg.TrustedProxies}, logger))
	if err != nil {
		return fmt.Errorf("create router: %w", err)
	}
	server := &http.Server{
		Addr: cfg.HTTPAddress, Handler: engine,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 1 << 20,
		// No WriteTimeout: future SSE responses can legitimately last minutes.
	}
	listener, err := net.Listen("tcp", cfg.HTTPAddress)
	if err != nil {
		return fmt.Errorf("listen for HTTP: %w", err)
	}
	serveResult := make(chan error, 1)
	if accounts != nil {
		stopMaintenance := startUserMaintenance(ctx, accounts.Users, logger)
		defer stopMaintenance()
		stopCalls := startCallMaintenance(ctx, accounts.Catalog, logger)
		defer stopCalls()
		stopChat := startChatMaintenance(ctx, accounts.Chat, logger)
		defer stopChat()
	}
	go func() { serveResult <- server.Serve(listener) }()
	logger.Info("server started", "address", cfg.HTTPAddress, "version", version)
	select {
	case err := <-serveResult:
		if !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve HTTP: %w", err)
		}
		return nil
	case <-ctx.Done():
	}
	shutdown, cancelShutdown := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancelShutdown()
	if err := server.Shutdown(shutdown); err != nil {
		if closeErr := server.Close(); closeErr != nil {
			logger.Error("force close HTTP failed")
		}
		return fmt.Errorf("shutdown HTTP: %w", err)
	}
	logger.Info("server stopped")
	return nil
}

func healthcheck(ctx context.Context, address string) error {
	if address == "" {
		address = ":8080"
	}
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("parse healthcheck address: %w", err)
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return fmt.Errorf("healthcheck requires a numeric port between 1 and 65535")
	}
	// Probe only loopback, regardless of the externally configured bind address.
	if host == "::1" {
		host = "::1"
	} else {
		host = "127.0.0.1"
	}
	// #nosec G704 -- Host is restricted to loopback and the port is validated above.
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+net.JoinHostPort(host, strconv.Itoa(portNumber))+"/healthz", nil)
	if err != nil {
		return fmt.Errorf("create healthcheck request: %w", err)
	}
	client := &http.Client{
		Timeout: 3 * time.Second,
		// A local health endpoint must never redirect to another host.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	// #nosec G704 -- The request can only reach the validated local health endpoint.
	result, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("perform healthcheck: %w", err)
	}
	if err := result.Body.Close(); err != nil {
		return fmt.Errorf("close healthcheck response: %w", err)
	}
	if result.StatusCode != http.StatusOK {
		return fmt.Errorf("healthcheck returned status %d", result.StatusCode)
	}
	return nil
}
