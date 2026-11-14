package upstream

import (
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// ChatSource is the public subset of a URL citation. Offsets refer to the raw reply.
type ChatSource struct {
	URL   string `json:"url"`
	Title string `json:"title,omitempty"`
	Ref   string `json:"ref,omitempty"`
	Start *int   `json:"start_index,omitempty"`
	End   *int   `json:"end_index,omitempty"`
}

const maxChatSources = 20

func readChatSources(raw json.RawMessage) []ChatSource {
	var entries []json.RawMessage
	if json.Unmarshal(raw, &entries) != nil {
		return nil
	}
	result := make([]ChatSource, 0, min(maxChatSources, len(entries)))
	for _, entry := range entries {
		var item struct {
			Type string     `json:"type"`
			ID   string     `json:"id"`
			Ref  string     `json:"ref"`
			URL  ChatSource `json:"url_citation"`
		}
		if json.Unmarshal(entry, &item) != nil || item.Type != "url_citation" {
			continue
		}
		source := item.URL
		// Some compatible providers attach their reference to the annotation.
		if source.Ref == "" {
			source.Ref = item.Ref
			if source.Ref == "" {
				source.Ref = item.ID
			}
		}
		if source = cleanChatSource(source); source.URL != "" {
			result = MergeChatSources(result, []ChatSource{source})
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

var sourceRef = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,127}$`)

func cleanChatSource(source ChatSource) ChatSource {
	source.URL = strings.TrimSpace(source.URL)
	if len(source.URL) > 2048 || strings.ContainsRune(source.URL, '\\') ||
		strings.IndexFunc(source.URL, func(r rune) bool { return unicode.IsControl(r) || unicode.IsSpace(r) }) >= 0 {
		return ChatSource{}
	}
	parsed, err := url.Parse(source.URL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Hostname() == "" || parsed.User != nil {
		return ChatSource{}
	}
	source.Title = strings.Join(strings.Fields(source.Title), " ")
	if len(source.Title) > 256 {
		end := 256
		for !utf8.RuneStart(source.Title[end]) {
			end--
		}
		source.Title = source.Title[:end]
	}
	if !sourceRef.MatchString(source.Ref) {
		source.Ref = ""
	}
	if source.Start == nil || source.End == nil || *source.Start < 0 || *source.End < *source.Start || *source.End >= 2<<20 {
		source.Start, source.End = nil, nil
	}
	return source
}

// MergeChatSources preserves first-seen order and bounds the metadata carried in SSE snapshots.
func MergeChatSources(current, incoming []ChatSource) []ChatSource {
	sameOffset := func(left, right *int) bool {
		return left == nil && right == nil || left != nil && right != nil && *left == *right
	}
	for _, source := range incoming {
		matched := false
		for i, previous := range current {
			if previous.URL != source.URL || previous.Ref != source.Ref ||
				!sameOffset(previous.Start, source.Start) || !sameOffset(previous.End, source.End) {
				continue
			}
			if previous.Title == "" {
				current[i].Title = source.Title
			}
			matched = true
			break
		}
		if !matched && len(current) < maxChatSources {
			current = append(current, source)
		}
	}
	return current
}
