package canvas

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/images"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type RunInput struct {
	Version int64     `json:"version"`
	NodeID  uuid.UUID `json:"node_id"`
	ModelID uuid.UUID `json:"model_id"`
	Quality string    `json:"quality"`
	Size    string    `json:"size"`
	Ratio   string    `json:"ratio"`
	Count   int32     `json:"n"`
}

type Run struct {
	Canvas Canvas      `json:"canvas"`
	Task   images.Task `json:"task"`
}

func (s *Service) Run(ctx context.Context, imageService *images.Service, actor user.Actor, id uuid.UUID, key string, input RunInput) (Run, error) {
	if input.Version < 1 || input.NodeID == uuid.Nil || input.Count < 1 || input.Count > MaxCount {
		return Run{}, problem.Invalid()
	}
	var row query.Canvas
	var doc Document
	var nodeIndex int
	resolve := func(q *query.Queries) (images.Input, error) {
		var err error
		row, err = q.LockCanvas(ctx, query.LockCanvasParams{ID: id, UserID: actor.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			return images.Input{}, notFound()
		}
		if err != nil {
			return images.Input{}, fmt.Errorf("lock canvas for generation: %w", err)
		}
		if row.Version != input.Version {
			return images.Input{}, problem.New("CANVAS_CONFLICT", 409)
		}
		doc, err = Decode(row.Document)
		if err != nil {
			return images.Input{}, err
		}
		nodeIndex = slices.IndexFunc(doc.Nodes, func(node Node) bool { return node.ID == input.NodeID })
		if nodeIndex < 0 {
			return images.Input{}, problem.Invalid()
		}
		node := doc.Nodes[nodeIndex]
		inPlace := node.Image != nil && (node.Image.State == StateEmpty || node.Image.State == StateFailed)
		if node.Kind != KindGenerator && !inPlace && (node.Image == nil || node.Image.State != StateReady) {
			return images.Input{}, problem.Invalid()
		}
		added := int(input.Count)
		if inPlace {
			added--
		}
		if len(doc.Nodes)+added > MaxNodes || len(doc.Edges)+added > MaxEdges {
			return images.Input{}, problem.New("CANVAS_DOCUMENT_LIMIT", 409)
		}
		prompt, files, err := generationInputs(doc, node)
		if err != nil {
			return images.Input{}, err
		}
		return images.Input{
			ConversationID: row.ConversationID, ModelID: input.ModelID, Prompt: prompt,
			Quality: input.Quality, Size: input.Size, Ratio: input.Ratio, Count: input.Count, ReferenceFileIDs: files,
		}, nil
	}
	attach := func(q *query.Queries, task query.ImageTask) error {
		if err := placeResults(&doc, nodeIndex, task); err != nil {
			return err
		}
		if err := Validate(doc); err != nil {
			return problem.Invalid()
		}
		raw, err := Encode(doc)
		if err != nil {
			return problem.Invalid()
		}
		row, err = q.SaveCanvas(ctx, query.SaveCanvasParams{
			ID: id, UserID: actor.ID, Title: row.Title, Document: raw,
			NodeCount: int32(len(doc.Nodes)), CoverFileID: doc.Cover(), // #nosec G115 -- resolve checks MaxNodes.
		})
		if err != nil {
			return fmt.Errorf("save canvas result slots: %w", err)
		}
		return nil
	}
	request := struct {
		CanvasID uuid.UUID `json:"canvas_id"`
		RunInput
	}{id, input}
	task, err := imageService.SubmitForCanvas(ctx, actor, key, request, resolve, attach)
	if err != nil {
		return Run{}, err
	}
	var board Canvas
	if row.ID == uuid.Nil {
		board, err = s.Get(ctx, actor.ID, id)
	} else {
		board, err = s.view(ctx, s.q, row, actor.ID)
	}
	return Run{Canvas: board, Task: task}, err
}

func generationInputs(doc Document, target Node) (string, []uuid.UUID, error) {
	var prompt string
	var mentions []Mention
	if target.Generator != nil {
		prompt, mentions = target.Generator.Prompt, target.Generator.Mentions
	}
	return resolveInputs(doc, target, prompt, mentions, true)
}

func resolveInputs(doc Document, target Node, prompt string, mentions []Mention, useImageSource bool) (string, []uuid.UUID, error) {
	byID := make(map[uuid.UUID]Node, len(doc.Nodes))
	groups := make(map[uuid.UUID][]Node)
	for _, node := range doc.Nodes {
		byID[node.ID] = node
		if node.GroupID != nil {
			groups[*node.GroupID] = append(groups[*node.GroupID], node)
		}
	}
	files := []uuid.UUID{}
	seenNodes, imageNumbers := map[uuid.UUID]bool{}, map[uuid.UUID]int{}
	tokens := make(map[uuid.UUID]string)
	textInputs := make(map[uuid.UUID]string)
	textOrder := []uuid.UUID{}
	take := func(node Node) error {
		if seenNodes[node.ID] {
			return nil
		}
		seenNodes[node.ID] = true
		if node.Text != nil {
			if text := strings.TrimSpace(node.Text.Content); text != "" {
				tokens[node.ID] = text
				textInputs[node.ID] = text
				textOrder = append(textOrder, node.ID)
			}
		}
		if node.Image != nil {
			if node.Image.State != StateReady || node.Image.FileID == nil {
				return problem.New("IMAGE_REFERENCES_INVALID", 400)
			}
			id := *node.Image.FileID
			if imageNumbers[id] == 0 {
				files = append(files, id)
				imageNumbers[id] = len(files)
			}
			tokens[node.ID] = fmt.Sprintf("[Image %d]", imageNumbers[id])
		}
		return nil
	}
	if useImageSource && target.Image != nil && target.Image.State == StateReady {
		if err := take(target); err != nil {
			return "", nil, err
		}
	}
	seenNodes[target.ID] = true
	for _, edge := range doc.Edges {
		if edge.To != target.ID || edge.Kind != EdgeInput {
			continue
		}
		source := byID[edge.From]
		if source.Kind != KindGroup {
			if err := take(source); err != nil {
				return "", nil, err
			}
			continue
		}
		members := groups[source.ID]
		slices.SortStableFunc(members, func(a, b Node) int {
			return cmp.Or(cmp.Compare(a.Y, b.Y), cmp.Compare(a.X, b.X))
		})
		for _, member := range members {
			if err := take(member); err != nil {
				return "", nil, err
			}
		}
	}
	replacements := make([]string, 0, len(mentions)*2)
	for _, mention := range mentions {
		replacement, ok := tokens[mention.NodeID]
		if !ok {
			return "", nil, problem.New("CANVAS_REFERENCE_MISSING", 400)
		}
		replacements = append(replacements, mention.Token, replacement)
		delete(textInputs, mention.NodeID)
	}
	parts := []string{}
	if content := strings.TrimSpace(strings.NewReplacer(replacements...).Replace(prompt)); content != "" {
		parts = append(parts, content)
	}
	for _, id := range textOrder {
		if text, ok := textInputs[id]; ok {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n\n"), files, nil
}

func placeResults(doc *Document, nodeIndex int, task query.ImageTask) error {
	source := doc.Nodes[nodeIndex]
	width, height := 280.0, 280.0
	if w, h, found := strings.Cut(task.Size, "x"); found {
		x, xErr := strconv.ParseFloat(w, 64)
		y, yErr := strconv.ParseFloat(h, 64)
		if xErr == nil && yErr == nil && x > 0 && y > 0 {
			height = min(MaxNodeSize, max(MinNodeSize, width*y/x))
		}
	}
	x, y := source.X+source.W+96, source.Y
	if x > MaxCoordinate {
		x = max(-MaxCoordinate, source.X-width-96)
	}
	for position := int32(0); position < task.ImageCount; position++ {
		slotPosition := position
		slot := &ImageContent{State: StatePending, TaskID: &task.ID, Position: &slotPosition}
		if position == 0 && source.Image != nil && source.Image.State != StateReady {
			doc.Nodes[nodeIndex].Image = slot
			continue
		}
		y = clearResultSpace(doc.Nodes, x, y, width, height)
		if y > MaxCoordinate {
			return problem.Invalid()
		}
		id, err := validation.NewID()
		if err != nil {
			return err
		}
		edgeID, err := validation.NewID()
		if err != nil {
			return err
		}
		doc.Nodes = append(doc.Nodes, Node{ID: id, Kind: KindImage, X: x, Y: y, W: width, H: height, Image: slot})
		doc.Edges = append(doc.Edges, Edge{ID: edgeID, From: source.ID, To: id, Kind: EdgeResult})
		y += height + 24
	}
	return nil
}

func clearResultSpace(nodes []Node, x, y, width, height float64) float64 {
	for {
		next := y
		for _, node := range nodes {
			if node.Kind != KindGroup && x < node.X+node.W && x+width > node.X && y < node.Y+node.H && y+height > node.Y {
				next = max(next, node.Y+node.H+24)
			}
		}
		if next == y {
			return y
		}
		y = next
	}
}
