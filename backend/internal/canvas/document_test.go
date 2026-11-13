package canvas

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func pointer[T any](value T) *T { return &value }

func sampleDocument() (Document, map[string]uuid.UUID) {
	ids := map[string]uuid.UUID{}
	for _, name := range []string{"group", "image", "text", "generator", "output", "pending", "file", "task", "e1", "e2", "e3"} {
		ids[name] = uuid.New()
	}
	doc := Empty()
	doc.Nodes = []Node{
		{ID: ids["group"], Kind: KindGroup, X: -100, Y: -100, W: 600, H: 400, Title: "参考"},
		{ID: ids["image"], Kind: KindImage, X: 0, Y: 0, W: 240, H: 180, GroupID: pointer(ids["group"]), Image: &ImageContent{State: StateReady, FileID: pointer(ids["file"])}},
		{ID: ids["text"], Kind: KindText, X: 0, Y: 220, W: 240, H: 120, Text: &TextContent{Content: "第一行\n第二行\tTab"}},
		{ID: ids["generator"], Kind: KindGenerator, X: 400, Y: 0, W: 320, H: 220, Generator: &GeneratorContent{Prompt: "a cat", Quality: "low", Size: "1024x1024", Ratio: "1:1", Count: 2}},
		{ID: ids["output"], Kind: KindImage, X: 800, Y: 0, W: 240, H: 240, Image: &ImageContent{State: StateFailed, TaskID: pointer(ids["task"]), Position: pointer[int32](1), ErrorCode: "UPSTREAM_ERROR"}},
		{ID: ids["pending"], Kind: KindImage, X: 800, Y: 260, W: 240, H: 240, Image: &ImageContent{State: StatePending, TaskID: pointer(ids["task"]), Position: pointer[int32](0)}},
	}
	doc.Edges = []Edge{
		{ID: ids["e1"], From: ids["image"], To: ids["generator"]},
		{ID: ids["e2"], From: ids["text"], To: ids["generator"]},
		{ID: ids["e3"], From: ids["generator"], To: ids["output"]},
	}
	return doc, ids
}

func TestValidateAcceptsCompleteDocument(t *testing.T) {
	doc, ids := sampleDocument()
	if err := Validate(doc); err != nil {
		t.Fatal(err)
	}
	if got := doc.FileIDs(); len(got) != 1 || got[0] != ids["file"] {
		t.Fatalf("files=%v", got)
	}
	if got := doc.TaskIDs(); len(got) != 1 || got[0] != ids["task"] {
		t.Fatalf("tasks=%v", got)
	}
	if cover := doc.Cover(); cover == nil || *cover != ids["file"] {
		t.Fatal("cover should be the first ready image")
	}
	if err := Validate(Empty()); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRejectsMalformedDocuments(t *testing.T) {
	cases := map[string]func(*Document, map[string]uuid.UUID){
		"schema":            func(d *Document, _ map[string]uuid.UUID) { d.Schema = 2 },
		"zoom":              func(d *Document, _ map[string]uuid.UUID) { d.Viewport.Zoom = 9 },
		"viewport far away": func(d *Document, _ map[string]uuid.UUID) { d.Viewport.X = MaxCoordinate + 1 },
		"duplicate node":    func(d *Document, _ map[string]uuid.UUID) { d.Nodes[1].ID = d.Nodes[0].ID },
		"nil node id":       func(d *Document, _ map[string]uuid.UUID) { d.Nodes[2].ID = uuid.Nil },
		"unknown kind":      func(d *Document, _ map[string]uuid.UUID) { d.Nodes[2].Kind = "video" },
		"tiny node":         func(d *Document, _ map[string]uuid.UUID) { d.Nodes[2].W = 1 },
		"title control":     func(d *Document, _ map[string]uuid.UUID) { d.Nodes[0].Title = "a\nb" },
		"long title":        func(d *Document, _ map[string]uuid.UUID) { d.Nodes[0].Title = strings.Repeat("字", MaxTitle+1) },
		"long text": func(d *Document, _ map[string]uuid.UUID) {
			d.Nodes[2].Text.Content = strings.Repeat("a", MaxText+1)
		},
		"text control":       func(d *Document, _ map[string]uuid.UUID) { d.Nodes[2].Text.Content = "bell\a" },
		"mixed content":      func(d *Document, _ map[string]uuid.UUID) { d.Nodes[2].Image = &ImageContent{State: StateFailed} },
		"group with content": func(d *Document, _ map[string]uuid.UUID) { d.Nodes[0].Text = &TextContent{} },
		"nested group":       func(d *Document, ids map[string]uuid.UUID) { d.Nodes[0].GroupID = pointer(ids["group"]) },
		"group target":       func(d *Document, ids map[string]uuid.UUID) { d.Nodes[2].GroupID = pointer(ids["text"]) },
		"ready without file": func(d *Document, _ map[string]uuid.UUID) { d.Nodes[1].Image.FileID = nil },
		"pending with file": func(d *Document, ids map[string]uuid.UUID) {
			d.Nodes[5].Image.FileID = pointer(ids["file"])
		},
		"pending without slot": func(d *Document, _ map[string]uuid.UUID) { d.Nodes[5].Image.Position = nil },
		"slot out of range":    func(d *Document, _ map[string]uuid.UUID) { d.Nodes[5].Image.Position = pointer[int32](MaxCount) },
		"bad error code":       func(d *Document, _ map[string]uuid.UUID) { d.Nodes[4].Image.ErrorCode = "lower case" },
		"unknown state":        func(d *Document, _ map[string]uuid.UUID) { d.Nodes[4].Image.State = "uploading" },
		"bad quality":          func(d *Document, _ map[string]uuid.UUID) { d.Nodes[3].Generator.Quality = "ultra" },
		"bad size":             func(d *Document, _ map[string]uuid.UUID) { d.Nodes[3].Generator.Size = "big" },
		"bad ratio":            func(d *Document, _ map[string]uuid.UUID) { d.Nodes[3].Generator.Ratio = "0:1" },
		"zero count":           func(d *Document, _ map[string]uuid.UUID) { d.Nodes[3].Generator.Count = 0 },
		"long prompt": func(d *Document, _ map[string]uuid.UUID) {
			d.Nodes[3].Generator.Prompt = strings.Repeat("p", MaxPrompt+1)
		},
		"nil model": func(d *Document, _ map[string]uuid.UUID) { d.Nodes[3].Generator.ModelID = pointer(uuid.Nil) },
		"self edge": func(d *Document, ids map[string]uuid.UUID) {
			d.Edges[0].To = ids["image"]
		},
		"duplicate edge pair": func(d *Document, _ map[string]uuid.UUID) {
			d.Edges = append(d.Edges, Edge{ID: uuid.New(), From: d.Edges[0].From, To: d.Edges[0].To})
		},
		"duplicate edge id": func(d *Document, ids map[string]uuid.UUID) { d.Edges[1].ID = ids["e1"] },
		"dangling edge":     func(d *Document, _ map[string]uuid.UUID) { d.Edges[0].From = uuid.New() },
		"text into image": func(d *Document, ids map[string]uuid.UUID) {
			d.Edges[1].To = ids["output"]
		},
		"generator into text": func(d *Document, ids map[string]uuid.UUID) {
			d.Edges[2].To = ids["text"]
		},
		"too many nodes": func(d *Document, _ map[string]uuid.UUID) {
			for len(d.Nodes) <= MaxNodes {
				d.Nodes = append(d.Nodes, Node{ID: uuid.New(), Kind: KindGroup, W: 100, H: 100})
			}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			doc, ids := sampleDocument()
			mutate(&doc, ids)
			if err := Validate(doc); err == nil {
				t.Fatal("accepted an invalid document")
			}
		})
	}
}

func TestConnectableDirections(t *testing.T) {
	allowed := [][2]string{{KindImage, KindGenerator}, {KindText, KindGenerator}, {KindGroup, KindGenerator}, {KindGenerator, KindImage}}
	for _, pair := range allowed {
		if !Connectable(pair[0], pair[1]) {
			t.Fatalf("%s -> %s should connect", pair[0], pair[1])
		}
	}
	for _, pair := range [][2]string{{KindGenerator, KindGenerator}, {KindImage, KindImage}, {KindText, KindText}, {KindGenerator, KindGroup}, {"", KindGenerator}} {
		if Connectable(pair[0], pair[1]) {
			t.Fatalf("%s -> %s should not connect", pair[0], pair[1])
		}
	}
}

func TestEncodeIsCanonicalAndBounded(t *testing.T) {
	encoded, err := Encode(Document{Schema: Schema, Viewport: Viewport{Zoom: 1}})
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) != `{"schema":1,"viewport":{"x":0,"y":0,"zoom":1},"nodes":[],"edges":[]}` {
		t.Fatalf("unexpected canonical form %s", encoded)
	}
	doc, _ := sampleDocument()
	encoded, err = Encode(doc)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := Decode(encoded)
	if err != nil || Validate(decoded) != nil || len(decoded.Nodes) != len(doc.Nodes) {
		t.Fatalf("round trip failed: %v", err)
	}
	var generic map[string]any
	if err := json.Unmarshal(encoded, &generic); err != nil {
		t.Fatal(err)
	}
	huge := Empty()
	for range MaxNodes {
		huge.Nodes = append(huge.Nodes, Node{ID: uuid.New(), Kind: KindText, W: 100, H: 100, Text: &TextContent{Content: strings.Repeat("长", MaxText)}})
	}
	if _, err := Encode(huge); err == nil {
		t.Fatal("accepted a document above the stored size limit")
	}
}
