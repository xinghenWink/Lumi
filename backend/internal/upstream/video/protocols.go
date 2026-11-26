package video

import (
	"fmt"
	"net/url"
	"strings"
)

func ordinal(role Role, index int) string {
	switch role {
	case Image, First, Last:
		return fmt.Sprintf("@image%d", index)
	case Video:
		return fmt.Sprintf("@video%d", index)
	case Audio:
		return fmt.Sprintf("@audio%d", index)
	default:
		return ""
	}
}

func mediaType(role Role) string {
	switch role {
	case Video:
		return "video_url"
	case Audio:
		return "audio_url"
	default:
		return "image_url"
	}
}

func content(req Request) []map[string]any {
	items := []map[string]any{{"type": "text", "text": Prompt(req, ordinal)}}
	for _, ref := range req.References {
		key := mediaType(ref.Role)
		items = append(items, map[string]any{"type": key, "role": ref.Role, key: map[string]string{"url": ref.URL}})
	}
	return items
}

func arkBody(req Request) map[string]any {
	options := req.Options
	return map[string]any{"model": req.Model, "content": content(req), "ratio": options.Ratio, "resolution": options.Resolution, "duration": options.Duration, "generate_audio": options.GenerateAudio}
}

func ark() protocol {
	path := "/api/v3/contents/generations/tasks"
	return protocol{
		create:   func(req Request) wire { return wire{path: path, body: arkBody(req)} },
		readPath: func(id string) string { return path + "/" + id },
		read: func(raw []byte, _ string) (Snapshot, error) {
			var v struct {
				ID      string `json:"id"`
				Status  string `json:"status"`
				Content struct {
					URL string `json:"video_url"`
				}
			}
			err := parse(raw, &v)
			return Snapshot{ID: v.ID, State: state(v.Status), ResultURL: v.Content.URL}, err
		},
	}
}

func wanBody(req Request) map[string]any {
	var media []map[string]any
	for _, ref := range req.References {
		media = append(media, map[string]any{"type": ref.Role, "url": ref.URL})
	}
	input := map[string]any{"prompt": Prompt(req, func(role Role, i int) string { return strings.TrimPrefix(ordinal(role, i), "@") })}
	if len(media) > 0 {
		input["media"] = media
	}
	o := req.Options
	return map[string]any{"model": req.Model, "input": input, "parameters": map[string]any{"resolution": strings.ToUpper(o.Resolution), "ratio": o.Ratio, "duration": o.Duration, "audio": o.GenerateAudio, "prompt_extend": false}}
}

func dashScope() protocol {
	return protocol{
		create: func(req Request) wire {
			return wire{path: "/api/v1/services/aigc/video-generation/video-synthesis", body: wanBody(req), headers: map[string]string{"X-DashScope-Async": "enable"}}
		},
		readPath: func(id string) string { return "/api/v1/tasks/" + id },
		read: func(raw []byte, _ string) (Snapshot, error) {
			var v struct {
				Code   string `json:"code"`
				Output struct {
					ID     string `json:"task_id"`
					Status string `json:"task_status"`
					URL    string `json:"video_url"`
				}
			}
			if err := parse(raw, &v); err != nil {
				return Snapshot{}, err
			}
			if v.Output.ID == "" && v.Code != "" {
				return Snapshot{}, &Failure{Code: "UPSTREAM_REQUEST_INVALID", Definite: true}
			}
			return Snapshot{ID: v.Output.ID, State: state(v.Output.Status), ResultURL: v.Output.URL}, nil
		},
	}
}

func h3Body(req Request) map[string]any {
	b := arkBody(req)
	b["resolution"] = strings.ToUpper(req.Options.Resolution)
	items := content(req)
	items[0]["text"] = Prompt(req, func(role Role, index int) string {
		label := "Picture"
		switch role {
		case Video:
			label = "Video"
		case Audio:
			label = "Audio"
		}
		return fmt.Sprintf("<%s %d>", label, index)
	})
	b["content"] = items
	return b
}

func minimax() protocol {
	return protocol{
		create:   func(req Request) wire { return wire{path: "/v2/video_generation", body: h3Body(req)} },
		readPath: func(id string) string { return "/v2/query/video_generation/" + id },
		read: func(raw []byte, id string) (Snapshot, error) {
			var v struct {
				ID   string `json:"task_id"`
				Task struct {
					ID      string `json:"id"`
					Status  string `json:"status"`
					Content struct {
						URL string `json:"url"`
					}
				}
			}
			err := parse(raw, &v)
			if id == "" {
				return Snapshot{ID: v.ID}, err
			}
			return Snapshot{ID: v.Task.ID, State: state(v.Task.Status), ResultURL: v.Task.Content.URL}, err
		},
	}
}

func klingAlias(role Role, index int) string {
	switch role {
	case First:
		return "FirstFrame"
	case Last:
		return "LastFrame"
	default:
		return strings.TrimPrefix(ordinal(role, index), "@")
	}
}

func kling() protocol {
	return protocol{
		create: func(req Request) wire {
			path := "/text-to-video/"
			switch req.Options.Mode {
			case FirstFrame, FirstLast:
				path = "/image-to-video/"
			case Reference:
				path = "/omni-video/"
			}
			items := []map[string]any{{"type": "prompt", "text": Prompt(req, func(role Role, index int) string { return "@" + klingAlias(role, index) })}}
			counts := make(map[Role]int)
			for _, ref := range req.References {
				counts[ref.Role]++
				kind := string(ref.Role)
				if ref.Role == Image {
					kind = "refer_image"
				}
				if ref.Role == Video {
					kind = "feature_video"
				}
				item := map[string]any{"type": kind, "url": ref.URL}
				if req.Options.Mode == Reference {
					item["id"] = klingAlias(ref.Role, counts[ref.Role])
				}
				items = append(items, item)
			}
			body := map[string]any{"contents": items, "settings": map[string]any{"aspect_ratio": req.Options.Ratio, "resolution": req.Options.Resolution, "duration": req.Options.Duration}}
			if req.RequestID != "" {
				body["options"] = map[string]string{"external_task_id": req.RequestID}
			}
			return wire{path: path + url.PathEscape(req.Model), body: body}
		},
		readPath:    func(id string) string { return "/tasks?task_ids=" + url.QueryEscape(id) },
		recoverPath: func(id string) string { return "/tasks?external_task_ids=" + url.QueryEscape(id) },
		read: func(raw []byte, id string) (Snapshot, error) {
			type entry struct {
				ID         string `json:"id"`
				Status     string `json:"status"`
				ExternalID string `json:"external_id"`
				Outputs    []struct {
					Type string `json:"type"`
					URL  string `json:"url"`
				}
			}
			if id == "" {
				var result struct {
					Code int
					Data entry
				}
				if err := parse(raw, &result); err != nil {
					return Snapshot{}, err
				}
				if result.Code != 0 {
					return Snapshot{}, &Failure{Code: "UPSTREAM_REQUEST_INVALID", Definite: true}
				}
				return Snapshot{ID: result.Data.ID, State: state(result.Data.Status)}, nil
			}
			var result struct {
				Code int
				Data []entry
			}
			if err := parse(raw, &result); err != nil {
				return Snapshot{}, err
			}
			for _, item := range result.Data {
				if item.ID != id && item.ExternalID != id {
					continue
				}
				out := Snapshot{ID: item.ID, State: state(item.Status)}
				for _, output := range item.Outputs {
					if output.Type == "video" {
						out.ResultURL = output.URL
						break
					}
				}
				return out, nil
			}
			return Snapshot{}, &Failure{Code: "UPSTREAM_RESPONSE_INVALID", Retryable: true}
		},
	}
}

func gateway(profile string) (protocol, error) {
	if profile == "kling" {
		p := kling()
		p.contentPath = func(id string) string { return "/v1/videos/" + id + "/content" }
		p.recoverPath = nil
		create := p.create
		p.create = func(req Request) wire { req.RequestID = ""; return create(req) }
		return p, nil
	}
	p := protocol{
		readPath:    func(id string) string { return "/v1/videos/" + id },
		contentPath: func(id string) string { return "/v1/videos/" + id + "/content" },
		read: func(raw []byte, _ string) (Snapshot, error) {
			var v struct {
				ID     string
				Status string
			}
			err := parse(raw, &v)
			return Snapshot{ID: v.ID, State: state(v.Status)}, err
		},
	}
	var encode func(Request) map[string]any
	switch profile {
	case "doubao":
		encode = arkBody
	case "alibaba":
		encode = wanBody
	case "hailuo":
		encode = h3Body
	default:
		return protocol{}, fmt.Errorf("unknown New API video profile %q", profile)
	}
	p.create = func(req Request) wire {
		metadata := encode(req)
		delete(metadata, "model")
		return wire{path: "/v1/videos", body: map[string]any{"model": req.Model, "prompt": Prompt(req, ordinal), "seconds": req.Options.Duration, "metadata": metadata}}
	}
	return p, nil
}
