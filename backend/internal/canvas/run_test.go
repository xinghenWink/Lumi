package canvas

import (
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
)

func TestPlaceResultsInAnEmptyImage(t *testing.T) {
	doc, _ := sampleDocument()
	image := Node{ID: uuid.New(), Kind: KindImage, X: 424, Y: 32, W: 280, H: 280, Image: &ImageContent{State: StateEmpty}}
	index := len(doc.Nodes)
	doc.Nodes = append(doc.Nodes, image)
	task := query.ImageTask{ID: uuid.New(), ImageCount: 3, Size: "1024x512"}
	if err := placeResults(&doc, index, task); err != nil {
		t.Fatal(err)
	}
	if err := Validate(doc); err != nil {
		t.Fatal(err)
	}
	slots := doc.Nodes[index:]
	if len(slots) != 3 || slots[0].ID != image.ID || slots[0].X != image.X || slots[0].Y != image.Y {
		t.Fatalf("first slot moved or was replaced: %+v", slots)
	}
	positions := make([]int32, 0, len(slots))
	for _, node := range slots {
		if node.Image.State != StatePending || node.Image.Position == nil || node.Image.TaskID == nil || *node.Image.TaskID != task.ID {
			t.Fatalf("incorrect slot: %+v", node.Image)
		}
		positions = append(positions, *node.Image.Position)
	}
	if !slices.Equal(positions, []int32{0, 1, 2}) {
		t.Fatalf("incorrect slot positions: %v", positions)
	}
	for _, edge := range doc.Edges[len(doc.Edges)-2:] {
		if edge.Kind != EdgeResult || edge.From != image.ID {
			t.Fatalf("incorrect result edge: %+v", edge)
		}
	}
	if slots[1].X <= image.X+image.W || slots[1].H != 140 {
		t.Fatalf("incorrect additional slot geometry: %+v", slots[1])
	}
}

func TestGenerationInputsResolveMentionIdentityAndOrder(t *testing.T) {
	doc, ids := sampleDocument()
	target := doc.Nodes[3]
	target.Generator.Prompt = "Describe @[first] with @[note] and @[copy]"
	target.Generator.Mentions = []Mention{{NodeID: ids["image"], Token: "@[first]"}, {NodeID: ids["text"], Token: "@[note]"}}
	copy := doc.Nodes[1]
	copy.ID = uuid.New()
	doc.Nodes = append(doc.Nodes, copy)
	doc.Edges = append(doc.Edges, Edge{ID: uuid.New(), From: copy.ID, To: target.ID, Kind: EdgeInput})
	target.Generator.Mentions = append(target.Generator.Mentions, Mention{NodeID: copy.ID, Token: "@[copy]"})
	prompt, files, err := generationInputs(doc, target)
	if err != nil || len(files) != 1 || files[0] != ids["file"] || strings.Count(prompt, "[Image 1]") != 2 ||
		strings.Count(prompt, doc.Nodes[2].Text.Content) != 1 {
		t.Fatalf("resolve mentions: %q %v %v", prompt, files, err)
	}
	doc.Edges = doc.Edges[:3]
	if _, _, err := generationInputs(doc, target); err == nil {
		t.Fatal("disconnected mention was accepted")
	}
}
