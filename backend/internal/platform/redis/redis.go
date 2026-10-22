package redis

import (
	"context"
	"fmt"
	"time"

	redisclient "github.com/redis/go-redis/v9"
)

type Client struct {
	client *redisclient.Client
}

func Open(ctx context.Context, connectionURL string) (*Client, error) {
	options, err := redisclient.ParseURL(connectionURL)
	if err != nil {
		return nil, fmt.Errorf("invalid Redis connection configuration")
	}
	options.DialTimeout = 5 * time.Second
	options.ReadTimeout = 2 * time.Second
	options.WriteTimeout = 2 * time.Second
	options.ContextTimeoutEnabled = true
	client := redisclient.NewClient(options)
	if err := client.Ping(ctx).Err(); err != nil {
		if closeErr := client.Close(); closeErr != nil {
			return nil, fmt.Errorf("close Redis after connection failure: %w", closeErr)
		}
		return nil, fmt.Errorf("ping Redis: %w", err)
	}
	return &Client{client: client}, nil
}

func (c *Client) Ping(ctx context.Context) error {
	if err := c.client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("ping Redis: %w", err)
	}
	return nil
}

func (c *Client) Close() error {
	if err := c.client.Close(); err != nil {
		return fmt.Errorf("close Redis: %w", err)
	}
	return nil
}
