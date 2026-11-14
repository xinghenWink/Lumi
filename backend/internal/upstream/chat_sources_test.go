package upstream

import (
	"encoding/json"
	"testing"
)

func TestReadChatSources(t *testing.T) {
	sources := readChatSources(json.RawMessage(`[
		{"type":"url_citation","ref":"turn23news16","url_citation":{"url":"https://example.com/report","start_index":0,"end_index":4,"content":"private excerpt"}},
		{"type":"url_citation","ref":"turn23news16","url_citation":{"url":"https://example.com/report","title":"  Report \n title ","start_index":0,"end_index":4}},
		{"type":"url_citation","url_citation":{"url":"javascript:invalid"}},
		{"type":"url_citation","url_citation":{"url":"https://user@example.com/"}},
		{"type":"file_citation","url_citation":{"url":"https://example.com/irrelevant"}},
		{"type":"url_citation","url_citation":[]},
		{"type":"url_citation","id":"turn23news17","url_citation":{"url":"https://example.com/second","start_index":7,"end_index":-1}}
	]`))
	if len(sources) != 2 || sources[0].Ref != "turn23news16" || sources[0].Title != "Report title" ||
		sources[0].Start == nil || *sources[0].Start != 0 || sources[0].End == nil || *sources[0].End != 4 ||
		sources[1].Ref != "turn23news17" || sources[1].Start != nil || sources[1].End != nil {
		t.Fatalf("unexpected public sources: %#v", sources)
	}
	encoded, err := json.Marshal(sources)
	if err != nil {
		t.Fatal(err)
	}
	var fields []map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	if _, hasExcerpt := fields[0]["content"]; hasExcerpt {
		t.Fatal("private upstream excerpt reached public citation")
	}
}
