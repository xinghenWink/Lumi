// Package canvas stores infinite-canvas boards. A board is one JSON document that
// references image files by ID; generation runs through the image task pipeline
// inside the board's hidden canvas conversation.
package canvas

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
)

// Limits shared with the web client (frontend/src/features/canvas/document.ts).
const (
	Schema           = 2
	MaxNodes         = 500
	MaxEdges         = 1000
	MaxTitle         = 100
	MaxText          = 8000
	MaxPrompt        = 8000
	MaxCoordinate    = 1_000_000
	MinNodeSize      = 24
	MaxNodeSize      = 20_000
	MinZoom          = 0.05
	MaxZoom          = 4
	MaxCount         = 10
	MaxCanvases      = 200
	MaxDocumentBytes = 1 << 20
	// MaxRequestBytes leaves room for the title, version and JSON whitespace around a full document.
	MaxRequestBytes = 1536 << 10
)

const (
	KindImage     = "image"
	KindText      = "text"
	KindGenerator = "generator"
	KindGroup     = "group"

	EdgeInput  = "input"
	EdgeResult = "result"

	StateEmpty   = "empty"
	StateReady   = "ready"
	StatePending = "pending"
	StateFailed  = "failed"
)

var (
	sizePattern  = regexp.MustCompile(`^(auto|[1-9][0-9]{1,4}x[1-9][0-9]{1,4})$`)
	ratioPattern = regexp.MustCompile(`^[1-9][0-9]{0,2}:[1-9][0-9]{0,2}$`)
	codePattern  = regexp.MustCompile(`^[A-Z0-9_]{0,64}$`)
)

type Viewport struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Zoom float64 `json:"zoom"`
}

// ImageContent is either a placed file (ready), a slot of a running task (pending)
// or a slot whose generation failed.
type ImageContent struct {
	State     string     `json:"state"`
	FileID    *uuid.UUID `json:"file_id"`
	TaskID    *uuid.UUID `json:"task_id"`
	Position  *int32     `json:"position"`
	ErrorCode string     `json:"error_code"`
}

type TextContent struct {
	Content string `json:"content"`
}

// GeneratorContent keeps the last chosen parameters; empty values mean "use the defaults"
// so a generator never pins an option that an administrator later disables.
type GeneratorContent struct {
	Prompt  string     `json:"prompt"`
	ModelID *uuid.UUID `json:"model_id"`
	Quality string     `json:"quality"`
	Size    string     `json:"size"`
	Ratio   string     `json:"ratio"`
	Count   int32      `json:"n"`
}

type Node struct {
	ID        uuid.UUID         `json:"id"`
	Kind      string            `json:"kind"`
	X         float64           `json:"x"`
	Y         float64           `json:"y"`
	W         float64           `json:"w"`
	H         float64           `json:"h"`
	Title     string            `json:"title"`
	GroupID   *uuid.UUID        `json:"group_id"`
	Image     *ImageContent     `json:"image,omitempty"`
	Text      *TextContent      `json:"text,omitempty"`
	Generator *GeneratorContent `json:"generator,omitempty"`
}

type Edge struct {
	ID   uuid.UUID `json:"id"`
	From uuid.UUID `json:"from"`
	To   uuid.UUID `json:"to"`
	Kind string    `json:"kind"`
}

// Document is painted in node order; group frames are always drawn beneath other nodes.
type Document struct {
	Schema   int      `json:"schema"`
	Viewport Viewport `json:"viewport"`
	Nodes    []Node   `json:"nodes"`
	Edges    []Edge   `json:"edges"`
}

func Empty() Document {
	return Document{Schema: Schema, Viewport: Viewport{Zoom: 1}, Nodes: []Node{}, Edges: []Edge{}}
}

// Validate reports the first structural problem in a document. It never touches the database;
// ownership of referenced files and tasks is checked by the service.
func Validate(doc Document) error {
	if doc.Schema != Schema {
		return fmt.Errorf("unsupported schema %d", doc.Schema)
	}
	if !coordinate(doc.Viewport.X) || !coordinate(doc.Viewport.Y) || !finite(doc.Viewport.Zoom) || doc.Viewport.Zoom < MinZoom || doc.Viewport.Zoom > MaxZoom {
		return fmt.Errorf("invalid viewport")
	}
	if len(doc.Nodes) > MaxNodes || len(doc.Edges) > MaxEdges {
		return fmt.Errorf("too many nodes or edges")
	}
	kinds := make(map[uuid.UUID]string, len(doc.Nodes))
	for _, node := range doc.Nodes {
		if node.ID == uuid.Nil || kinds[node.ID] != "" {
			return fmt.Errorf("invalid or duplicate node id")
		}
		kinds[node.ID] = node.Kind
	}
	for _, node := range doc.Nodes {
		if err := validateNode(node, kinds); err != nil {
			return fmt.Errorf("node %s: %w", node.ID, err)
		}
	}
	edges := make(map[uuid.UUID]bool, len(doc.Edges))
	pairs := make(map[[2]uuid.UUID]bool, len(doc.Edges))
	for _, edge := range doc.Edges {
		if edge.ID == uuid.Nil || edges[edge.ID] {
			return fmt.Errorf("invalid or duplicate edge id")
		}
		edges[edge.ID] = true
		pair := [2]uuid.UUID{edge.From, edge.To}
		if edge.From == edge.To || pairs[pair] || !connectable(kinds[edge.From], kinds[edge.To], edge.Kind) {
			return fmt.Errorf("edge %s: invalid connection", edge.ID)
		}
		pairs[pair] = true
	}
	return nil
}

func connectable(from, to, kind string) bool {
	switch kind {
	case EdgeInput:
		return (from == KindImage || from == KindText || from == KindGroup) &&
			(to == KindGenerator || to == KindImage)
	case EdgeResult:
		return (from == KindGenerator || from == KindImage) && to == KindImage
	}
	return false
}

func validateNode(node Node, kinds map[uuid.UUID]string) error {
	if !coordinate(node.X) || !coordinate(node.Y) || !size(node.W) || !size(node.H) {
		return fmt.Errorf("invalid geometry")
	}
	if !validation.Text(node.Title, 0, MaxTitle) {
		return fmt.Errorf("invalid title")
	}
	if node.GroupID != nil && (node.Kind == KindGroup || kinds[*node.GroupID] != KindGroup) {
		return fmt.Errorf("invalid group")
	}
	present := 0
	for _, part := range []bool{node.Image != nil, node.Text != nil, node.Generator != nil} {
		if part {
			present++
		}
	}
	switch node.Kind {
	case KindImage:
		if node.Image == nil || node.Text != nil {
			return fmt.Errorf("image content required")
		}
		if node.Generator != nil {
			if err := validateGenerator(*node.Generator); err != nil {
				return err
			}
		}
		return validateImage(*node.Image)
	case KindText:
		if present != 1 || node.Text == nil || !multiline(node.Text.Content, MaxText) {
			return fmt.Errorf("invalid text content")
		}
	case KindGenerator:
		if present != 1 || node.Generator == nil {
			return fmt.Errorf("generator content required")
		}
		return validateGenerator(*node.Generator)
	case KindGroup:
		if present != 0 {
			return fmt.Errorf("groups carry no content")
		}
	default:
		return fmt.Errorf("unknown kind")
	}
	return nil
}

func validateImage(image ImageContent) error {
	if !codePattern.MatchString(image.ErrorCode) {
		return fmt.Errorf("invalid error code")
	}
	if image.FileID != nil && *image.FileID == uuid.Nil || image.TaskID != nil && *image.TaskID == uuid.Nil {
		return fmt.Errorf("invalid reference")
	}
	if image.Position != nil && (*image.Position < 0 || *image.Position >= MaxCount || image.TaskID == nil) {
		return fmt.Errorf("invalid position")
	}
	switch image.State {
	case StateEmpty:
		if image.FileID != nil || image.TaskID != nil || image.Position != nil || image.ErrorCode != "" {
			return fmt.Errorf("empty image has no file or task")
		}
	case StateReady:
		if image.FileID == nil || image.ErrorCode != "" {
			return fmt.Errorf("ready image needs a file")
		}
	case StatePending:
		if image.FileID != nil || image.TaskID == nil || image.Position == nil || image.ErrorCode != "" {
			return fmt.Errorf("pending image needs a task slot")
		}
	case StateFailed:
		if image.FileID != nil {
			return fmt.Errorf("failed image has no file")
		}
	default:
		return fmt.Errorf("unknown image state")
	}
	return nil
}

func validateGenerator(generator GeneratorContent) error {
	if !multiline(generator.Prompt, MaxPrompt) {
		return fmt.Errorf("invalid prompt")
	}
	if generator.ModelID != nil && *generator.ModelID == uuid.Nil {
		return fmt.Errorf("invalid model")
	}
	switch generator.Quality {
	case "", "low", "medium", "high":
	default:
		return fmt.Errorf("invalid quality")
	}
	if generator.Size != "" && !sizePattern.MatchString(generator.Size) || generator.Ratio != "" && !ratioPattern.MatchString(generator.Ratio) {
		return fmt.Errorf("invalid size or ratio")
	}
	if generator.Count < 1 || generator.Count > MaxCount {
		return fmt.Errorf("invalid count")
	}
	return nil
}

// FileIDs returns every file the document places, in first-seen order without duplicates.
func (doc Document) FileIDs() []uuid.UUID {
	return doc.collect(func(image ImageContent) *uuid.UUID { return image.FileID })
}

// TaskIDs returns every image task the document still refers to.
func (doc Document) TaskIDs() []uuid.UUID {
	return doc.collect(func(image ImageContent) *uuid.UUID { return image.TaskID })
}

func (doc Document) collect(pick func(ImageContent) *uuid.UUID) []uuid.UUID {
	seen := map[uuid.UUID]bool{}
	result := []uuid.UUID{}
	for _, node := range doc.Nodes {
		if node.Image == nil {
			continue
		}
		if id := pick(*node.Image); id != nil && !seen[*id] {
			seen[*id] = true
			result = append(result, *id)
		}
	}
	return result
}

// Cover picks the first placed image as the list thumbnail.
func (doc Document) Cover() *uuid.UUID {
	for _, node := range doc.Nodes {
		if node.Image != nil && node.Image.State == StateReady && node.Image.FileID != nil {
			id := *node.Image.FileID
			return &id
		}
	}
	return nil
}

// Encode returns the canonical stored form, normalizing absent arrays to empty ones.
func Encode(doc Document) ([]byte, error) {
	if doc.Nodes == nil {
		doc.Nodes = []Node{}
	}
	if doc.Edges == nil {
		doc.Edges = []Edge{}
	}
	encoded, err := json.Marshal(doc)
	if err != nil {
		return nil, fmt.Errorf("encode canvas document: %w", err)
	}
	if len(encoded) > MaxDocumentBytes {
		return nil, fmt.Errorf("canvas document exceeds %d bytes", MaxDocumentBytes)
	}
	return encoded, nil
}

func Decode(raw []byte) (Document, error) {
	var doc Document
	if err := json.Unmarshal(raw, &doc); err != nil {
		return Document{}, fmt.Errorf("decode canvas document: %w", err)
	}
	if doc.Nodes == nil {
		doc.Nodes = []Node{}
	}
	if doc.Edges == nil {
		doc.Edges = []Edge{}
	}
	return doc, nil
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }
func coordinate(value float64) bool {
	return finite(value) && math.Abs(value) <= MaxCoordinate
}
func size(value float64) bool {
	return finite(value) && value >= MinNodeSize && value <= MaxNodeSize
}

// multiline accepts line breaks and tabs but no other control characters.
func multiline(value string, maximum int) bool {
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) > maximum {
		return false
	}
	for _, character := range value {
		if unicode.IsControl(character) && character != '\n' && character != '\r' && character != '\t' {
			return false
		}
	}
	return true
}
