package redis

import (
	"context"
	"fmt"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"time"

	redisclient "github.com/redis/go-redis/v9"
)

type ChatFrame struct{ ID, Type, Data string }

func (c *Client) ReserveChat(ctx context.Context, key, fingerprint string) (bool, error) {
	const script = `local old=redis.call('GET',KEYS[1]);if old then if old~=ARGV[1] then return -1 end return 0 end redis.call('SET',KEYS[1],ARGV[1],'EX',300);return 1`
	result, err := c.client.Eval(ctx, script, []string{"lumi:chat:request:" + key}, fingerprint).Int()
	if err != nil {
		return false, fmt.Errorf("reserve chat buffer: %w", err)
	}
	if result < 0 {
		return false, problem.New("CHAT_REQUEST_CONFLICT", 409)
	}
	return result == 1, nil
}
func (c *Client) AppendChat(ctx context.Context, key, kind, data string) error {
	_, err := c.client.TxPipelined(ctx, func(pipe redisclient.Pipeliner) error {
		pipe.XAdd(ctx, &redisclient.XAddArgs{Stream: "lumi:chat:events:" + key, Values: map[string]any{"type": kind, "data": data}})
		pipe.Expire(ctx, "lumi:chat:events:"+key, 5*time.Minute)
		pipe.Expire(ctx, "lumi:chat:request:"+key, 5*time.Minute)
		return nil
	})
	if err != nil {
		return fmt.Errorf("append chat buffer: %w", err)
	}
	return nil
}
func (c *Client) ReadChat(ctx context.Context, key, after string) ([]ChatFrame, error) {
	if after==""{after="0-0"}
	streams, err := c.client.XRead(ctx,&redisclient.XReadArgs{Streams:[]string{"lumi:chat:events:"+key,after},Count:100,Block:200*time.Millisecond}).Result()
	if err==redisclient.Nil{return []ChatFrame{},nil}
	if err != nil {
		return nil, fmt.Errorf("read chat buffer: %w", err)
	}
	rows:=[]redisclient.XMessage{}
	for _,stream:=range streams{rows=append(rows,stream.Messages...)}
	frames := make([]ChatFrame, 0, len(rows))
	for _, row := range rows {
		kind, ok := row.Values["type"].(string)
		if !ok {
			return nil, fmt.Errorf("invalid chat frame type")
		}
		data, ok := row.Values["data"].(string)
		if !ok {
			return nil, fmt.Errorf("invalid chat frame body")
		}
		frames = append(frames, ChatFrame{ID: row.ID, Type: kind, Data: data})
	}
	return frames, nil
}
