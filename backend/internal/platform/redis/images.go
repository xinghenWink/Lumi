package redis

import (
	"context"
	"fmt"
	"time"

	redisclient "github.com/redis/go-redis/v9"
)

func (c *Client) EnqueueImage(ctx context.Context, id string, at time.Time) error {
	if err := c.client.ZAddNX(ctx, "lumi:image:queue", redisclient.Z{Score: float64(at.UnixMilli()), Member: id}).Err(); err != nil {
		return fmt.Errorf("enqueue image: %w", err)
	}
	return nil
}

func (c *Client) PopImages(ctx context.Context) ([]string, error) {
	// Removal is atomic; PostgreSQL reconciliation repairs a lost delivery.
	const script = `local ids=redis.call('ZRANGEBYSCORE',KEYS[1],'-inf',ARGV[1],'LIMIT',0,20)
for _,id in ipairs(ids) do redis.call('ZREM',KEYS[1],id) end
return ids`
	result, err := c.client.Eval(ctx, script, []string{"lumi:image:queue"}, time.Now().UnixMilli()).StringSlice()
	if err != nil {
		return nil, fmt.Errorf("pop image queue: %w", err)
	}
	return result, nil
}
