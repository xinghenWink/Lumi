package redis

import (
	"context"
	"fmt"
	"time"
)

func (c *Client) AcquireJob(ctx context.Context, name, token string) (bool, error) {
	ok, err := c.client.SetNX(ctx, "lumi:job:"+name, token, time.Minute).Result()
	if err != nil {
		return false, fmt.Errorf("acquire job lease: %w", err)
	}
	return ok, nil
}
func (c *Client) ReleaseJob(ctx context.Context, name, token string) error {
	const script = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`
	if err := c.client.Eval(ctx, script, []string{"lumi:job:" + name}, token).Err(); err != nil {
		return fmt.Errorf("release job lease: %w", err)
	}
	return nil
}
