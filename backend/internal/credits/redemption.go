package credits

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xinghenWink/Lumi/backend/internal/audit"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db"
	"github.com/xinghenWink/Lumi/backend/internal/platform/db/query"
	"github.com/xinghenWink/Lumi/backend/internal/platform/pagination"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
	"github.com/xinghenWink/Lumi/backend/internal/platform/validation"
	"github.com/xinghenWink/Lumi/backend/internal/user"
)

type BatchInput struct {
	Name      string     `json:"name"`
	Note      string     `json:"note"`
	Prefix    string     `json:"prefix"`
	Quantity  int32      `json:"quantity"`
	Credits   int64      `json:"credits"`
	MaxUses   int32      `json:"max_uses"`
	ExpiresAt *time.Time `json:"expires_at"`
}
type Batch struct {
	ID        uuid.UUID  `json:"id"`
	Name      string     `json:"name"`
	Note      string     `json:"note"`
	Prefix    string     `json:"prefix"`
	Quantity  int32      `json:"quantity"`
	Credits   int64      `json:"credits"`
	MaxUses   int32      `json:"max_uses"`
	ExpiresAt *time.Time `json:"expires_at"`
	CreatedAt time.Time  `json:"created_at"`
}
type BatchPage struct {
	Items      []Batch `json:"items"`
	NextCursor string  `json:"next_cursor"`
}
type Code struct {
	ID        uuid.UUID  `json:"id"`
	BatchID   uuid.UUID  `json:"batch_id"`
	Code      string     `json:"code"`
	Tail      string     `json:"tail"`
	Credits   int64      `json:"credits"`
	MaxUses   int32      `json:"max_uses"`
	UsedCount int32      `json:"used_count"`
	Enabled   bool       `json:"enabled"`
	Status    string     `json:"status"`
	ExpiresAt *time.Time `json:"expires_at"`
	CreatedAt time.Time  `json:"created_at"`
}
type CodeFilter struct {
	BatchID                *uuid.UUID
	Status, Search, Cursor string
	Limit                  int32
}
type CodePage struct {
	Items      []Code `json:"items"`
	NextCursor string `json:"next_cursor"`
}
type RedeemRecord struct {
	ID        uuid.UUID `json:"id"`
	CodeID    uuid.UUID `json:"code_id"`
	UserID    uuid.UUID `json:"user_id"`
	CodeTail  string    `json:"code_tail"`
	Credits   int64     `json:"credits"`
	IP        string    `json:"ip,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}
type RecordFilter struct {
	UserID, CodeID *uuid.UUID
	Cursor         string
	Limit          int32
	Admin          bool
}
type RecordPage struct {
	Items      []RedeemRecord `json:"items"`
	NextCursor string         `json:"next_cursor"`
}
type RedeemResult struct {
	Credits int64        `json:"credits"`
	Account Account      `json:"account"`
	Record  RedeemRecord `json:"record"`
}
type CodeUpdate struct {
	IDs     []uuid.UUID `json:"ids"`
	Enabled *bool       `json:"enabled,omitempty"`
}

func normalizeCode(value string) (string, error) {
	if len(value) > 80 {
		return "", problem.New("REDEEM_INVALID", http.StatusBadRequest)
	}
	result := strings.ToUpper(strings.TrimSpace(value))
	result = strings.ReplaceAll(strings.ReplaceAll(result, "-", ""), " ", "")
	if len(result) < 1 || len(result) > 28 {
		return "", problem.New("REDEEM_INVALID", http.StatusBadRequest)
	}
	for _, ch := range result {
		if (ch < 'A' || ch > 'Z') && (ch < '0' || ch > '9') {
			return "", problem.New("REDEEM_INVALID", http.StatusBadRequest)
		}
	}
	return result, nil
}
func codeHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func generateCode(prefix string) (string, error) {
	raw := make([]byte, 10)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate redeem code: %w", err)
	}
	encoded := base32.NewEncoding("0123456789ABCDEFGHJKMNPQRSTVWXYZ").WithPadding(base32.NoPadding).EncodeToString(raw)
	code := encoded[:4] + "-" + encoded[4:8] + "-" + encoded[8:12] + "-" + encoded[12:]
	if prefix != "" {
		code = prefix + "-" + code
	}
	return code, nil
}
func batchView(record query.RedeemBatch) Batch {
	return Batch{ID: record.ID, Name: record.Name, Note: record.Note, Prefix: record.Prefix, Quantity: record.Quantity, Credits: record.Credits, MaxUses: record.MaxUses, ExpiresAt: user.UTCTime(record.ExpiresAt), CreatedAt: record.CreatedAt.UTC()}
}
func recordView(record query.RedeemRecord, admin bool) RedeemRecord {
	result := RedeemRecord{ID: record.ID, CodeID: record.CodeID, UserID: record.UserID, CodeTail: record.CodeTail, Credits: record.Credits, CreatedAt: record.CreatedAt.UTC()}
	if admin {
		result.IP = record.Ip.String()
	}
	return result
}
func (s *Service) CreateBatch(ctx context.Context, actor user.Actor, key string, input BatchInput) (Batch, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Note = strings.TrimSpace(input.Note)
	input.Prefix = strings.ToUpper(strings.TrimSpace(input.Prefix))
	if input.MaxUses == 0 {
		input.MaxUses = 1
	}
	if !validation.Text(input.Name, 1, 80) || !validation.Text(input.Note, 0, 200) || len(input.Prefix) > 12 || input.Quantity < 1 || input.Quantity > 1000 || input.Credits < 1 || input.Credits > 1_000_000_000 || input.MaxUses < 1 || input.MaxUses > 1_000_000 {
		return Batch{}, problem.Invalid()
	}
	if input.Prefix != "" {
		prefix, err := normalizeCode(input.Prefix)
		if err != nil || prefix != input.Prefix {
			return Batch{}, problem.Invalid()
		}
	}
	var result Batch
	err := db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		var err error
		result, err = idempotent(ctx, q, actor.ID, key, "redeem_batch", input, func(id uuid.UUID) (Batch, error) {
			if input.ExpiresAt != nil && !input.ExpiresAt.After(s.now()) {
				return Batch{}, problem.Invalid()
			}
			batch, err := q.CreateRedeemBatch(ctx, query.CreateRedeemBatchParams{ID: id, Name: input.Name, Note: input.Note, Prefix: input.Prefix, Quantity: input.Quantity, Credits: input.Credits, MaxUses: input.MaxUses, ExpiresAt: input.ExpiresAt, CreatedBy: actor.ID})
			if err != nil {
				return Batch{}, fmt.Errorf("create redeem batch: %w", err)
			}
			for range input.Quantity {
				code, err := generateCode(input.Prefix)
				if err != nil {
					return Batch{}, err
				}
				canonical, err := normalizeCode(code)
				if err != nil {
					return Batch{}, err
				}
				codeID, err := validation.NewID()
				if err != nil {
					return Batch{}, err
				}
				encrypted, err := s.vault.Encrypt(code, "redeem-code:"+codeID.String())
				if err != nil {
					return Batch{}, err
				}
				if err := q.CreateRedeemCode(ctx, query.CreateRedeemCodeParams{ID: codeID, BatchID: id, CodeHash: codeHash(canonical), CodeEncrypted: encrypted, Tail: canonical[len(canonical)-4:], Credits: input.Credits, MaxUses: input.MaxUses, ExpiresAt: input.ExpiresAt}); err != nil {
					return Batch{}, fmt.Errorf("store redeem code: %w", err)
				}
			}
			after := batchView(batch)
			err = audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: "redeem.batch_create", TargetType: "redeem_batch", TargetID: &id, After: after, IP: actor.IP})
			return after, err
		})
		return err
	})
	return result, err
}
func (s *Service) Batches(ctx context.Context, cursorValue string, limit int32) (BatchPage, error) {
	if limit < 1 || limit > 100 {
		return BatchPage{}, problem.Invalid()
	}
	fingerprint := pagination.Fingerprint("redeem-batches")
	cursor, err := pagination.Decode(cursorValue, fingerprint)
	if err != nil {
		return BatchPage{}, err
	}
	records, err := s.queries.ListRedeemBatches(ctx, query.ListRedeemBatchesParams{CursorTime: cursor.Time, CursorID: cursor.ID, PageLimit: limit + 1})
	if err != nil {
		return BatchPage{}, fmt.Errorf("list redeem batches: %w", err)
	}
	result := BatchPage{Items: make([]Batch, 0, len(records))}
	if len(records) > int(limit) {
		records = records[:limit]
		last := records[len(records)-1]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, fingerprint)
		if err != nil {
			return result, err
		}
	}
	for _, record := range records {
		result.Items = append(result.Items, batchView(record))
	}
	return result, nil
}
func (s *Service) Codes(ctx context.Context, filter CodeFilter) (CodePage, error) {
	if filter.Limit < 1 || filter.Limit > 100 || (filter.Status != "" && filter.Status != "unused" && filter.Status != "used" && filter.Status != "disabled" && filter.Status != "expired") {
		return CodePage{}, problem.Invalid()
	}
	encoded, err := json.Marshal([]any{filter.BatchID, filter.Status, filter.Search})
	if err != nil {
		return CodePage{}, fmt.Errorf("encode code filters: %w", err)
	}
	fingerprint := pagination.Fingerprint(string(encoded))
	cursor, err := pagination.Decode(filter.Cursor, fingerprint)
	if err != nil {
		return CodePage{}, err
	}
	searchHash := ""
	if filter.Search != "" {
		value, err := normalizeCode(filter.Search)
		if err != nil {
			return CodePage{}, problem.Invalid()
		}
		searchHash = codeHash(value)
	}
	records, err := s.queries.ListRedeemCodes(ctx, query.ListRedeemCodesParams{BatchFilter: filter.BatchID, SearchHash: searchHash, StatusFilter: filter.Status, AtTime: s.now(), CursorTime: cursor.Time, CursorID: cursor.ID, PageLimit: filter.Limit + 1})
	if err != nil {
		return CodePage{}, fmt.Errorf("list redeem codes: %w", err)
	}
	result := CodePage{Items: make([]Code, 0, len(records))}
	if len(records) > int(filter.Limit) {
		records = records[:filter.Limit]
		last := records[len(records)-1]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, fingerprint)
		if err != nil {
			return result, err
		}
	}
	for _, record := range records {
		code, err := s.vault.Decrypt(record.CodeEncrypted, "redeem-code:"+record.ID.String())
		if err != nil {
			return result, err
		}
		status := "unused"
		if !record.Enabled {
			status = "disabled"
		} else if record.ExpiresAt != nil && !record.ExpiresAt.After(s.now()) {
			status = "expired"
		} else if record.UsedCount >= record.MaxUses {
			status = "used"
		}
		result.Items = append(result.Items, Code{ID: record.ID, BatchID: record.BatchID, Code: code, Tail: record.Tail, Credits: record.Credits, MaxUses: record.MaxUses, UsedCount: record.UsedCount, Enabled: record.Enabled, Status: status, ExpiresAt: user.UTCTime(record.ExpiresAt), CreatedAt: record.CreatedAt.UTC()})
	}
	return result, nil
}
func (s *Service) UpdateCodes(ctx context.Context, actor user.Actor, input CodeUpdate, remove bool) error {
	if len(input.IDs) < 1 || len(input.IDs) > 1000 || (!remove && input.Enabled == nil) || (remove && input.Enabled != nil) {
		return problem.Invalid()
	}
	ids := slices.Clone(input.IDs)
	slices.SortFunc(ids, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	for i, id := range ids {
		if id == uuid.Nil || (i > 0 && id == ids[i-1]) {
			return problem.Invalid()
		}
	}
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		before := make([]map[string]any, 0, len(ids))
		for _, id := range ids {
			code, err := q.LockRedeemCode(ctx, id)
			if errors.Is(err, pgx.ErrNoRows) {
				return problem.New("REDEEM_INVALID", http.StatusNotFound)
			}
			if err != nil {
				return fmt.Errorf("lock edited redeem code: %w", err)
			}
			before = append(before, map[string]any{"id": id, "tail": code.Tail, "enabled": code.Enabled, "used_count": code.UsedCount})
			if remove {
				if code.UsedCount > 0 {
					return problem.New("REDEEM_DELETE_USED", http.StatusConflict)
				}
				if err := q.DeleteUnusedRedeemCode(ctx, id); err != nil {
					return fmt.Errorf("delete unused redeem code: %w", err)
				}
			} else if err := q.SetRedeemCodeEnabled(ctx, query.SetRedeemCodeEnabledParams{ID: id, Enabled: *input.Enabled}); err != nil {
				return fmt.Errorf("change redeem code state: %w", err)
			}
		}
		action := "redeem.codes_update"
		if remove {
			action = "redeem.codes_delete"
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: action, TargetType: "redeem_code", Before: before, After: input, IP: actor.IP})
	})
}
func (s *Service) Redeem(ctx context.Context, owner uuid.UUID, ip netip.Addr, key, code string) (RedeemResult, error) {
	if !ValidKey(key) {
		return RedeemResult{}, problem.New("IDEMPOTENCY_KEY_INVALID", http.StatusBadRequest)
	}
	identity := "redeem:" + owner.String()
	locked, retry, err := s.gate.LoginLocked(ctx, identity)
	if err != nil {
		return RedeemResult{}, err
	}
	if locked {
		return RedeemResult{}, problem.Retry("REDEEM_COOLDOWN", retry)
	}
	allowed, retry, err := s.gate.Allow(ctx, "redeem-user", owner.String(), 5, time.Minute)
	if err != nil {
		return RedeemResult{}, err
	}
	if !allowed {
		return RedeemResult{}, problem.Retry("RATE_LIMITED", retry)
	}
	var result RedeemResult
	canonical, formatErr := normalizeCode(code)
	err = db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := lockUser(ctx, q, owner, true); err != nil {
			return err
		}
		if formatErr != nil {
			return formatErr
		}
		var err error
		result, err = idempotent(ctx, q, owner, key, "redeem", canonical, func(operation uuid.UUID) (RedeemResult, error) {
			record, err := q.LockRedeemCodeByHash(ctx, codeHash(canonical))
			if errors.Is(err, pgx.ErrNoRows) {
				return RedeemResult{}, problem.New("REDEEM_INVALID", http.StatusBadRequest)
			}
			if err != nil {
				return RedeemResult{}, fmt.Errorf("lock redeemed code: %w", err)
			}
			if !record.Enabled {
				return RedeemResult{}, problem.New("REDEEM_DISABLED", http.StatusConflict)
			}
			if record.ExpiresAt != nil && !record.ExpiresAt.After(s.now()) {
				return RedeemResult{}, problem.New("REDEEM_EXPIRED", http.StatusConflict)
			}
			redeemed, err := q.HasRedeemedCode(ctx, query.HasRedeemedCodeParams{CodeID: record.ID, UserID: owner})
			if err != nil {
				return RedeemResult{}, fmt.Errorf("check previous redemption: %w", err)
			}
			if redeemed {
				return RedeemResult{}, problem.New("REDEEM_ALREADY_USED", http.StatusConflict)
			}
			if record.UsedCount >= record.MaxUses {
				return RedeemResult{}, problem.New("REDEEM_USED", http.StatusConflict)
			}
			cfg, err := configuration(ctx, q)
			if err != nil {
				return RedeemResult{}, err
			}
			account, err := s.account(ctx, q, owner, cfg)
			if err != nil {
				return RedeemResult{}, err
			}
			if err := change(ctx, q, &account, "redeem", "permanent", record.Credits, operation.String(), "redeem_code", &record.ID, nil, ""); err != nil {
				return RedeemResult{}, err
			}
			if err := q.IncrementRedeemUses(ctx, record.ID); err != nil {
				return RedeemResult{}, fmt.Errorf("consume redeem use: %w", err)
			}
			receipt, err := q.CreateRedeemRecord(ctx, query.CreateRedeemRecordParams{ID: operation, CodeID: record.ID, UserID: owner, CodeTail: record.Tail, Credits: record.Credits, Ip: ip})
			if err != nil {
				return RedeemResult{}, fmt.Errorf("record redemption: %w", err)
			}
			view, err := accountView(account, cfg, s.now())
			if err != nil {
				return RedeemResult{}, err
			}
			return RedeemResult{Credits: record.Credits, Account: view, Record: recordView(receipt, false)}, nil
		})
		return err
	})
	if err == nil {
		if clearErr := s.gate.LoginSucceeded(ctx, identity); clearErr != nil {
			return RedeemResult{}, clearErr
		}
		return result, nil
	}
	var rejected *problem.Error
	if errors.As(err, &rejected) && slices.Contains([]string{"REDEEM_INVALID", "REDEEM_DISABLED", "REDEEM_EXPIRED", "REDEEM_USED", "REDEEM_ALREADY_USED"}, rejected.Code) {
		if failureErr := s.gate.LoginFailed(ctx, identity, 10, time.Hour); failureErr != nil {
			return RedeemResult{}, failureErr
		}
	}
	return result, err
}
func (s *Service) Records(ctx context.Context, filter RecordFilter) (RecordPage, error) {
	if filter.Limit < 1 || filter.Limit > 100 {
		return RecordPage{}, problem.Invalid()
	}
	encoded, err := json.Marshal([]any{filter.UserID, filter.CodeID, filter.Admin})
	if err != nil {
		return RecordPage{}, fmt.Errorf("encode redemption filters: %w", err)
	}
	fingerprint := pagination.Fingerprint(string(encoded))
	cursor, err := pagination.Decode(filter.Cursor, fingerprint)
	if err != nil {
		return RecordPage{}, err
	}
	records, err := s.queries.ListRedeemRecords(ctx, query.ListRedeemRecordsParams{UserFilter: filter.UserID, CodeFilter: filter.CodeID, CursorTime: cursor.Time, CursorID: cursor.ID, PageLimit: filter.Limit + 1})
	if err != nil {
		return RecordPage{}, fmt.Errorf("list redemption records: %w", err)
	}
	result := RecordPage{Items: make([]RedeemRecord, 0, len(records))}
	if len(records) > int(filter.Limit) {
		records = records[:filter.Limit]
		last := records[len(records)-1]
		result.NextCursor, err = pagination.Encode(last.CreatedAt, last.ID, fingerprint)
		if err != nil {
			return result, err
		}
	}
	for _, record := range records {
		result.Items = append(result.Items, recordView(record, filter.Admin))
	}
	return result, nil
}
func (s *Service) ExportAudit(ctx context.Context, actor user.Actor, kind string, filters any) error {
	return db.Transaction(ctx, s.pool, func(q *query.Queries) error {
		if err := user.LockAdmin(ctx, q, actor); err != nil {
			return err
		}
		return audit.Write(ctx, q, audit.Entry{ActorID: &actor.ID, Action: kind + ".export", TargetType: kind, After: filters, IP: actor.IP})
	})
}
