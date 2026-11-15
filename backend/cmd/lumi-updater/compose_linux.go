package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xinghenWink/Lumi/backend/internal/deployment"
)

const (
	docker   = "/usr/bin/docker"
	bash     = "/bin/bash"
	loopback = "http://127.0.0.1:8080"
	pinKey   = "LUMI_IMAGE_REF"
)

var (
	errMissingContainer = errors.New("compose service is absent")
	containerID         = regexp.MustCompile(`^[a-f0-9]{64}$`)
	projectName         = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)
	pinAssignment       = regexp.MustCompile(`^[ \t]*(?:export[ \t]+)?LUMI_IMAGE_REF(?:[ \t]*[=:]|[ \t]*$)`)
)

type compose struct {
	directory     string
	project       string
	client        *http.Client
	operationLock *os.File
	repository    string
}

func newCompose(directory, project string) (*compose, error) {
	if os.Geteuid() != 0 || !filepath.IsAbs(directory) || !projectName.MatchString(project) || !slices.Contains([]string{"amd64", "arm64"}, runtime.GOARCH) {
		return nil, fmt.Errorf("a root-managed Linux deployment directory and Compose project are required")
	}
	directory = filepath.Clean(directory)
	for current := directory; ; current = filepath.Dir(current) {
		if err := trustedPath(current, true); err != nil {
			return nil, err
		}
		if current == "/" {
			break
		}
	}
	for _, name := range []string{".env", "docker-compose.yml", "backup.sh"} {
		if err := trustedPath(filepath.Join(directory, name), false); err != nil {
			return nil, err
		}
	}
	return &compose{
		directory: directory, project: project, repository: deployment.Image,
		client: &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{Proxy: nil},
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
	}, nil
}

func trustedPath(path string, directory bool) error {
	info, err := os.Lstat(path) // #nosec G703 -- Inspect the explicit root enrollment path without following symlinks.
	if err != nil {
		return fmt.Errorf("inspect deployment path: %w", err)
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || info.IsDir() != directory || !directory && !info.Mode().IsRegular() ||
		info.Mode().Perm()&0o022 != 0 || stat.Uid != 0 {
		return fmt.Errorf("deployment path must be owned by root and protected from other writers: %s", path)
	}
	return nil
}

func (c *compose) command(ctx context.Context, binary string, args ...string) *exec.Cmd {
	// Only packaged tools are run. Job identifiers and image digests are validated before use.
	cmd := exec.CommandContext(ctx, binary, args...) // #nosec G204 G702 -- Fixed binaries and separately validated structured arguments.
	cmd.Dir = c.directory
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "HOME=/root", "LANG=C"}
	return cmd
}

func (c *compose) composeArgs(args ...string) []string {
	return append([]string{"compose", "--project-name", c.project,
		"--project-directory", c.directory, "--env-file", filepath.Join(c.directory, ".env"),
		"-f", filepath.Join(c.directory, "docker-compose.yml")}, args...)
}

func output(cmd *exec.Cmd, step string) ([]byte, error) {
	// Command output can contain environment credentials. Keep it away from error messages.
	data, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("%s: %w", step, err)
	}
	return data, nil
}

func (c *compose) run(ctx context.Context, timeout time.Duration, description string, args ...string) ([]byte, error) {
	work, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return output(c.command(work, docker, args...), description)
}

type container struct {
	Image  string
	Config struct {
		Env    []string
		Labels map[string]string
	}
	State struct {
		Running bool
	}
	NetworkSettings struct {
		Networks map[string]struct{ IPAddress string }
		Ports    map[string][]struct{ HostIP, HostPort string }
	}
}

func decodeOne[T any](data []byte, description string) (T, error) {
	var zero T
	var items []T
	if err := json.Unmarshal(data, &items); err != nil {
		return zero, fmt.Errorf("decode %s: %w", description, err)
	}
	if len(items) != 1 {
		return zero, fmt.Errorf("expected one %s", description)
	}
	return items[0], nil
}

func (c *compose) container(ctx context.Context, service string) (container, error) {
	data, err := c.run(ctx, 10*time.Second, "find Compose service", c.composeArgs("ps", "--all", "--quiet", service)...)
	if err != nil {
		return container{}, err
	}
	id := strings.TrimSpace(string(data))
	if id == "" {
		return container{}, errMissingContainer
	}
	if !containerID.MatchString(id) {
		return container{}, fmt.Errorf("expected exactly one Compose %s container", service)
	}
	data, err = c.run(ctx, 10*time.Second, "inspect Compose service", "container", "inspect", id)
	if err != nil {
		return container{}, err
	}
	instance, err := decodeOne[container](data, "container")
	if err != nil {
		return container{}, err
	}
	labels := instance.Config.Labels
	if labels["com.docker.compose.project"] != c.project || labels["com.docker.compose.service"] != service ||
		labels["com.docker.compose.project.working_dir"] != c.directory ||
		labels["com.docker.compose.project.config_files"] != filepath.Join(c.directory, "docker-compose.yml") {
		return container{}, fmt.Errorf("container for %s does not match the enrolled Compose project", service)
	}
	return instance, nil
}

func envValue(values []string, key string) string {
	for _, value := range values {
		if content, ok := strings.CutPrefix(value, key+"="); ok {
			return content
		}
	}
	return ""
}

func (c *compose) connect(ctx context.Context) (*pgxpool.Pool, error) {
	postgres, err := c.container(ctx, "postgres")
	if err != nil {
		return nil, err
	}
	network := postgres.NetworkSettings.Networks[c.project+"_default"]
	if !postgres.State.Running || len(postgres.NetworkSettings.Networks) != 1 || net.ParseIP(network.IPAddress) == nil {
		return nil, fmt.Errorf("installed PostgreSQL must run on the Compose project bridge")
	}
	for _, bindings := range postgres.NetworkSettings.Ports {
		if len(bindings) != 0 {
			return nil, fmt.Errorf("installed PostgreSQL must use internal networking")
		}
	}
	environment := postgres.Config.Env
	identity := url.UserPassword(envValue(environment, "POSTGRES_USER"), envValue(environment, "POSTGRES_PASSWORD"))
	address := url.URL{Scheme: "postgres", User: identity, Host: net.JoinHostPort(network.IPAddress, "5432"),
		Path: "/" + envValue(environment, "POSTGRES_DB"), RawQuery: "sslmode=disable&connect_timeout=4"}
	config, err := pgxpool.ParseConfig(address.String())
	if err != nil {
		return nil, fmt.Errorf("invalid bundled database configuration")
	}
	config.MaxConns = 2
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("connect to bundled PostgreSQL: %w", err)
	}
	return pool, nil
}

type imageInfo struct {
	ID           string
	RepoDigests  []string
	Architecture string
	OS           string
}

func (c *compose) image(ctx context.Context, ref string) (imageInfo, error) {
	data, err := c.run(ctx, 10*time.Second, "inspect deployment image", "image", "inspect", ref)
	if err != nil {
		return imageInfo{}, err
	}
	return decodeOne[imageInfo](data, "image")
}

func (c *compose) officialDigest(image imageInfo) (string, error) {
	var digest string
	for _, value := range image.RepoDigests {
		candidate, ok := strings.CutPrefix(value, c.repository+"@")
		if !ok || !deployment.ValidDigest(candidate) {
			continue
		}
		if digest != "" && digest != candidate {
			return "", fmt.Errorf("ambiguous official image digest")
		}
		digest = candidate
	}
	if digest == "" {
		return "", fmt.Errorf("official image digest is missing")
	}
	return digest, nil
}

func (c *compose) dependencies(ctx context.Context, app container) error {
	postgres, err := c.container(ctx, "postgres")
	if err != nil {
		return err
	}
	database, dbErr := url.Parse(envValue(app.Config.Env, "DATABASE_URL"))
	redis, redisErr := url.Parse(envValue(app.Config.Env, "REDIS_URL"))
	env := postgres.Config.Env
	if dbErr != nil || redisErr != nil || database.User == nil ||
		database.Scheme != "postgres" || database.Host != "postgres:5432" ||
		database.Path != "/"+envValue(env, "POSTGRES_DB") || database.User.Username() != envValue(env, "POSTGRES_USER") ||
		redis.Scheme != "redis" || redis.Host != "redis:6379" {
		return fmt.Errorf("managed updates require bundled PostgreSQL and Redis")
	}
	if _, err := c.container(ctx, "redis"); err != nil {
		return err
	}
	bindings := app.NetworkSettings.Ports["8080/tcp"]
	if len(bindings) != 1 || bindings[0].HostIP != "127.0.0.1" || bindings[0].HostPort != "8080" {
		return fmt.Errorf("managed updates require the standard loopback application port")
	}
	return nil
}

func (c *compose) probe(ctx context.Context, path string, result any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, loopback+path, nil)
	if err != nil {
		return fmt.Errorf("prepare local verification: %w", err)
	}
	res, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("verify local application: %w", err)
	}
	defer res.Body.Close() //nolint:errcheck // Closing cannot change the verification result.
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("application verification returned HTTP %d", res.StatusCode)
	}
	if result != nil {
		if err := json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(result); err != nil {
			return fmt.Errorf("decode application version: %w", err)
		}
	}
	return nil
}

func (c *compose) Identity(ctx context.Context) (deployment.Identity, error) {
	app, err := c.container(ctx, "app")
	if err != nil {
		return deployment.Identity{}, err
	}
	if !app.State.Running || !deployment.ValidDigest(app.Image) {
		return deployment.Identity{}, fmt.Errorf("application is not running")
	}
	if err := c.dependencies(ctx, app); err != nil {
		return deployment.Identity{}, err
	}
	image, err := c.image(ctx, app.Image)
	if err != nil {
		return deployment.Identity{}, err
	}
	digest, err := c.officialDigest(image)
	if err != nil {
		return deployment.Identity{}, err
	}
	var version struct {
		Version string `json:"version"`
		Commit  string `json:"commit"`
	}
	if err := c.probe(ctx, "/readyz", nil); err != nil {
		return deployment.Identity{}, err
	}
	if err := c.probe(ctx, "/api/version", &version); err != nil {
		return deployment.Identity{}, err
	}
	return deployment.Identity{Version: version.Version, Commit: version.Commit, Digest: digest,
		Platform: image.OS + "/" + image.Architecture}, nil
}

func (c *compose) ref(digest string) string { return c.repository + "@" + digest }

func (c *compose) checkImage(ctx context.Context, manifest deployment.Manifest, platform string) error {
	image, err := c.image(ctx, c.ref(manifest.Digest))
	if err != nil {
		return err
	}
	if image.OS+"/"+image.Architecture != platform || !slices.Contains(image.RepoDigests, c.ref(manifest.Digest)) {
		return fmt.Errorf("downloaded image does not match the expected digest and platform")
	}
	return nil
}

func (c *compose) Prepare(ctx context.Context, plan deployment.ExecutionPlan) error {
	if plan.Platform != "linux/"+runtime.GOARCH {
		return fmt.Errorf("deployment platform does not match the host")
	}
	if _, err := c.run(ctx, 15*time.Minute, "pull verified image", "pull", "--platform", plan.Platform, c.ref(plan.Target.Digest)); err != nil {
		return err
	}
	if err := c.checkImage(ctx, plan.Target, plan.Platform); err != nil {
		return err
	}
	current, err := c.Identity(ctx)
	if err != nil {
		return err
	}
	if current.Digest != plan.Source.Digest || current.Version != plan.Source.Version || current.Commit != plan.Source.Commit {
		return fmt.Errorf("running source changed during preflight")
	}
	return c.writePin(plan.Source.Digest, plan.Source.Digest, true)
}

func (c *compose) Stop(ctx context.Context, plan deployment.ExecutionPlan) error {
	app, err := c.container(ctx, "app")
	if errors.Is(err, errMissingContainer) {
		return nil
	}
	if err != nil {
		return err
	}
	image, err := c.image(ctx, app.Image)
	if err != nil {
		return err
	}
	if !slices.Contains(image.RepoDigests, c.ref(plan.Source.Digest)) && !slices.Contains(image.RepoDigests, c.ref(plan.Target.Digest)) {
		return fmt.Errorf("cannot stop an image outside the verified transition")
	}
	// Always issue stop: a container between automatic restart attempts must also stay stopped.
	if _, err := c.run(ctx, 85*time.Second, "stop Compose app", c.composeArgs("stop", "--timeout", "65", "app")...); err != nil {
		return err
	}
	app, err = c.container(ctx, "app")
	if err != nil {
		return err
	}
	if app.State.Running {
		return fmt.Errorf("application did not stop")
	}
	return nil
}

func (c *compose) Backup(ctx context.Context, id uuid.UUID, plan deployment.ExecutionPlan) error {
	app, err := c.container(ctx, "app")
	if err != nil {
		return err
	}
	if app.State.Running || c.operationLock == nil {
		return fmt.Errorf("backup requires a stopped application and deployment lock")
	}
	image, err := c.image(ctx, app.Image)
	if err != nil {
		return err
	}
	if !slices.Contains(image.RepoDigests, c.ref(plan.Source.Digest)) {
		return fmt.Errorf("backup source is not the verified image")
	}
	work, cancel := context.WithTimeout(ctx, 60*time.Minute)
	defer cancel()
	if err := trustedPath(filepath.Join(c.directory, "backup.sh"), false); err != nil {
		return err
	}
	cmd := c.command(work, bash, filepath.Join(c.directory, "backup.sh"), "--app-stopped", id.String())
	cmd.Env = append(cmd.Env, "COMPOSE_PROJECT_NAME="+c.project)
	cmd.ExtraFiles = []*os.File{c.operationLock}
	_, err = output(cmd, "create consistent deployment backup")
	return err
}

func (c *compose) Pin(ctx context.Context, from, to deployment.Manifest) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("interrupted image pin: %w", err)
	}
	return c.writePin(from.Digest, to.Digest, false)
}

func (c *compose) Start(ctx context.Context, other, manifest deployment.Manifest, platform string) error {
	app, err := c.container(ctx, "app")
	if err != nil && !errors.Is(err, errMissingContainer) {
		return err
	}
	if err == nil {
		image, err := c.image(ctx, app.Image)
		if err != nil {
			return err
		}
		if !slices.Contains(image.RepoDigests, c.ref(other.Digest)) &&
			!slices.Contains(image.RepoDigests, c.ref(manifest.Digest)) {
			return fmt.Errorf("cannot replace an image outside the verified transition")
		}
	}
	if err := c.checkImage(ctx, manifest, platform); err != nil {
		return err
	}
	configured, err := c.run(ctx, 10*time.Second, "resolve Compose app image", c.composeArgs("config", "--images", "app")...)
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(configured)) != c.ref(manifest.Digest) {
		return fmt.Errorf("configured Compose image pin changed")
	}
	if _, err := c.run(ctx, 155*time.Second, "start verified Compose app", c.composeArgs("up", "-d", "--no-deps", "--no-build",
		"--pull", "never", "--wait", "--wait-timeout", "120", "app")...); err != nil {
		return err
	}
	actual, err := c.Identity(ctx)
	if err != nil {
		return err
	}
	if actual.Digest != manifest.Digest || actual.Version != manifest.Version || actual.Commit != manifest.Commit || actual.Platform != platform {
		return fmt.Errorf("running application does not match the release manifest")
	}
	return nil
}

func (c *compose) writePin(from, to string, bootstrap bool) error {
	if !deployment.ValidDigest(from) || !deployment.ValidDigest(to) {
		return fmt.Errorf("invalid managed image digest")
	}
	path := filepath.Join(c.directory, ".env")
	if err := trustedPath(path, false); err != nil {
		return err
	}
	data, err := os.ReadFile(path) // #nosec G304 G703 -- Fixed file beneath the enrolled root-owned directory.
	if err != nil {
		return fmt.Errorf("read Compose environment: %w", err)
	}
	updated, err := replacePin(data, c.repository+"@"+from, c.repository+"@"+to, bootstrap)
	if err != nil {
		return err
	}
	if bytes.Equal(updated, data) {
		return nil
	}
	return writeAtomic(path, updated)
}

func replacePin(data []byte, from, to string, bootstrap bool) ([]byte, error) {
	lines := strings.Split(string(data), "\n")
	match := -1
	for i, line := range lines {
		plain := strings.TrimSuffix(line, "\r")
		if !pinAssignment.MatchString(plain) {
			continue
		}
		if match >= 0 || plain != pinKey+"="+from && plain != pinKey+"="+to && (!bootstrap || plain != pinKey+"=") {
			return nil, fmt.Errorf("managed image pin was edited or duplicated")
		}
		match = i
	}
	if match >= 0 {
		ending := ""
		if strings.HasSuffix(lines[match], "\r") {
			ending = "\r"
		}
		lines[match] = pinKey + "=" + to + ending
		return []byte(strings.Join(lines, "\n")), nil
	}
	if !bootstrap {
		return nil, fmt.Errorf("managed image pin was removed")
	}
	return []byte(strings.TrimSuffix(string(data), "\n") + "\n" + pinKey + "=" + to + "\n"), nil
}

func writeAtomic(path string, data []byte) (result error) {
	dir := filepath.Dir(path)
	temp, err := os.CreateTemp(dir, ".lumi-update-")
	if err != nil {
		return fmt.Errorf("create managed deployment file: %w", err)
	}
	defer func() {
		if err := os.Remove(temp.Name()); err != nil && !errors.Is(err, os.ErrNotExist) {
			result = errors.Join(result, fmt.Errorf("clean up temporary deployment file: %w", err))
		}
	}()
	if _, err := temp.Write(data); err != nil {
		return fmt.Errorf("write managed deployment file: %w", errors.Join(err, temp.Close()))
	}
	if err := errors.Join(temp.Sync(), temp.Close()); err != nil {
		return fmt.Errorf("flush managed deployment file: %w", err)
	}
	if err := os.Rename(temp.Name(), path); err != nil { // #nosec G703 -- Both files are in the enrolled root-owned directory.
		return fmt.Errorf("publish managed deployment file: %w", err)
	}
	directory, err := os.Open(dir) // #nosec G304 -- enrolled root-owned directory.
	if err != nil {
		return fmt.Errorf("open managed deployment directory: %w", err)
	}
	if err := errors.Join(directory.Sync(), directory.Close()); err != nil {
		return fmt.Errorf("flush managed deployment directory: %w", err)
	}
	return nil
}

type journal struct {
	ID   uuid.UUID                `json:"id"`
	Plan deployment.ExecutionPlan `json:"plan"`
}

func (c *compose) SavePlan(id uuid.UUID, plan deployment.ExecutionPlan) error {
	data, err := json.Marshal(journal{ID: id, Plan: plan})
	if err != nil {
		return fmt.Errorf("serialize deployment journal: %w", err)
	}
	return writeAtomic(filepath.Join(c.directory, ".deployment-plan.json"), data)
}

func (c *compose) LoadPlan(id uuid.UUID) (deployment.ExecutionPlan, error) {
	path := filepath.Join(c.directory, ".deployment-plan.json")
	if err := trustedPath(path, false); err != nil {
		return deployment.ExecutionPlan{}, err
	}
	data, err := os.ReadFile(path) // #nosec G304 -- fixed journal in the enrolled root-owned directory.
	if err != nil {
		return deployment.ExecutionPlan{}, fmt.Errorf("read deployment journal: %w", err)
	}
	var saved journal
	if err := json.Unmarshal(data, &saved); err != nil {
		return deployment.ExecutionPlan{}, fmt.Errorf("decode deployment journal: %w", err)
	}
	if saved.ID != id {
		return deployment.ExecutionPlan{}, fmt.Errorf("deployment journal belongs to another job")
	}
	return saved.Plan, nil
}

func (c *compose) lock(name string) (*os.File, error) {
	path := filepath.Join(c.directory, name)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0o600) // #nosec G304 -- fixed local lock name.
	if err != nil {
		return nil, fmt.Errorf("open deployment lock: %w", err)
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return nil, fmt.Errorf("acquire deployment lock: %w", errors.Join(err, file.Close()))
	}
	return file, nil
}
