package redis

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	redisclient "github.com/redis/go-redis/v9"
)

// Lua scripts make limits atomic across processes. Keys contain only hashes.
func (c *Client) Allow(ctx context.Context, scope, identity string, limit int, window time.Duration) (bool, int, error) {
	const script = `
local stamp = redis.call('TIME')
local now = stamp[1] * 1000 + math.floor(stamp[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[1]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  return {0, math.max(1, math.ceil(redis.call('PTTL', KEYS[1]) / 1000))}
end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return {1, 0}`
	result, err := c.client.Eval(ctx, script, []string{securityKey(scope, identity)}, window.Milliseconds(), limit, rand.Text()).Int64Slice()
	if err != nil {
		return false, 0, fmt.Errorf("apply sliding window: %w", err)
	}
	if len(result) != 2 {
		return false, 0, fmt.Errorf("invalid rate limit response")
	}
	return result[0] == 1, int(result[1]), nil
}

func (c *Client) LoginLocked(ctx context.Context, identity string) (bool, int, error) {
	ttl, err := c.client.TTL(ctx, securityKey("login-lock", identity)).Result()
	if err != nil {
		return false, 0, fmt.Errorf("read login lock: %w", err)
	}
	return ttl > 0, int(ttl.Seconds()) + 1, nil
}

func (c *Client) LoginFailed(ctx context.Context, identity string, limit int, duration time.Duration) error {
	const script = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
if count >= tonumber(ARGV[1]) then
 redis.call('SET', KEYS[2], '1', 'PX', ARGV[2])
 redis.call('DEL', KEYS[1])
end
return count`
	if err := c.client.Eval(ctx, script, []string{securityKey("login-attempts", identity), securityKey("login-lock", identity)}, limit, duration.Milliseconds()).Err(); err != nil {
		return fmt.Errorf("record login failure: %w", err)
	}
	return nil
}

func (c *Client) LoginSucceeded(ctx context.Context, identity string) error {
	if err := c.client.Del(ctx, securityKey("login-attempts", identity), securityKey("login-lock", identity)).Err(); err != nil {
		return fmt.Errorf("clear login failures: %w", err)
	}
	return nil
}

func (c *Client) Cooldown(ctx context.Context, identity string) (bool, error) {
	value, err := c.client.SetNX(ctx, securityKey("verification-cooldown", identity), "1", time.Minute).Result()
	if err != nil {
		return false, fmt.Errorf("reserve verification cooldown: %w", err)
	}
	return value, nil
}

func (c *Client) ClearCooldown(ctx context.Context, identity string) error {
	if err := c.client.Del(ctx, securityKey("verification-cooldown", identity)).Err(); err != nil && err != redisclient.Nil {
		return fmt.Errorf("clear verification cooldown: %w", err)
	}
	return nil
}

func securityKey(scope, value string) string {
	digest := sha256.Sum256([]byte(value))
	return "lumi:" + scope + ":" + hex.EncodeToString(digest[:])
}
