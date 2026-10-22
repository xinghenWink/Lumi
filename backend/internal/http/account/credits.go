package account

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xinghenWink/Lumi/backend/internal/credits"
	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

func (h *Handler) creditRoutes(protected, admin *gin.RouterGroup) {
	protected.GET("/me/credits", h.myCredits)
	protected.GET("/me/credits/ledger", h.myLedger)
	protected.GET("/me/credits/stats", h.myUsage)
	protected.POST("/me/credits/quote", h.csrf, h.quoteCredits)
	protected.POST("/me/redeem", h.csrf, h.redeemCredits)
	protected.GET("/me/redeem-records", h.myRedemptions)
	admin.GET("/users/:id/credits", h.userCredits)
	admin.POST("/users/:id/credits", h.csrf, h.adminLimit, h.adjustCredits)
	admin.GET("/pricing", h.getPricing)
	admin.PUT("/pricing", h.csrf, h.adminLimit, h.putPricing)
	admin.GET("/credit-ledger", h.allLedger)
	admin.GET("/credit-ledger/export", h.exportLedger)
	admin.POST("/redeem-batches", h.csrf, h.adminLimit, h.createBatch)
	admin.GET("/redeem-batches", h.listBatches)
	admin.GET("/redeem-codes", h.listCodes)
	admin.PATCH("/redeem-codes", h.csrf, h.adminLimit, h.updateCodes)
	admin.DELETE("/redeem-codes", h.csrf, h.adminLimit, h.deleteCodes)
	admin.GET("/redeem-codes/export", h.exportCodes)
	admin.GET("/redeem-records", h.allRedemptions)
}
func (h *Handler) myCredits(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	result, err := h.services.Credits.Read(c.Request.Context(), current.User.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) userCredits(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Credits.Read(c.Request.Context(), id)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) adjustCredits(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	id, err := identifier(c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	var input credits.AdjustInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Credits.Adjust(c.Request.Context(), current.Actor, id, c.GetHeader("Idempotency-Key"), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) quoteCredits(c *gin.Context) {
	var input credits.QuoteInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Credits.Quote(c.Request.Context(), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) myUsage(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	result, err := h.services.Credits.Usage(c.Request.Context(), current.User.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) redeemCredits(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	var input struct {
		Code string `json:"code"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Credits.Redeem(c.Request.Context(), current.User.ID, current.Actor.IP, c.GetHeader("Idempotency-Key"), input.Code)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) getPricing(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	result, err := h.services.Credits.Pricing(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) putPricing(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	var input credits.Pricing
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Credits.SavePricing(c.Request.Context(), current.Actor, input)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func ledgerFilter(c *gin.Context, owner *uuid.UUID) (credits.LedgerFilter, error) {
	from, until, limit, err := pageArguments(c)
	return credits.LedgerFilter{UserID: owner, Type: c.Query("type"), From: from, Until: until, Limit: limit, Cursor: c.Query("cursor")}, err
}
func (h *Handler) myLedger(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	if _, err := h.services.Credits.Read(c.Request.Context(), current.User.ID); err != nil {
		h.fail(c, err)
		return
	}
	filter, err := ledgerFilter(c, &current.User.ID)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Credits.Ledger(c.Request.Context(), filter)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) allLedger(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	owner, err := optionalID(c.Query("user_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	filter, err := ledgerFilter(c, owner)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Credits.Ledger(c.Request.Context(), filter)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) createBatch(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	var input credits.BatchInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Credits.CreateBatch(c.Request.Context(), current.Actor, c.GetHeader("Idempotency-Key"), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}
func (h *Handler) listBatches(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	_, _, limit, err := pageArguments(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Credits.Batches(c.Request.Context(), c.Query("cursor"), limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func codeFilter(c *gin.Context) (credits.CodeFilter, error) {
	batch, err := optionalID(c.Query("batch_id"))
	if err != nil {
		return credits.CodeFilter{}, err
	}
	_, _, limit, err := pageArguments(c)
	return credits.CodeFilter{BatchID: batch, Status: c.Query("status"), Search: c.Query("search"), Cursor: c.Query("cursor"), Limit: limit}, err
}
func (h *Handler) listCodes(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	filter, err := codeFilter(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Credits.Codes(c.Request.Context(), filter)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) updateCodes(c *gin.Context) { h.mutateCodes(c, false) }
func (h *Handler) deleteCodes(c *gin.Context) { h.mutateCodes(c, true) }
func (h *Handler) mutateCodes(c *gin.Context, remove bool) {
	if !h.checkAdmin(c) {
		return
	}
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	var input credits.CodeUpdate
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if err := h.services.Credits.UpdateCodes(c.Request.Context(), current.Actor, input, remove); err != nil {
		h.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *Handler) myRedemptions(c *gin.Context) {
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	h.redemptions(c, &current.User.ID, false)
}
func (h *Handler) allRedemptions(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	owner, err := optionalID(c.Query("user_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	h.redemptions(c, owner, true)
}
func (h *Handler) redemptions(c *gin.Context, owner *uuid.UUID, admin bool) {
	code, err := optionalID(c.Query("code_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	_, _, limit, err := pageArguments(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.services.Credits.Records(c.Request.Context(), credits.RecordFilter{UserID: owner, CodeID: code, Limit: limit, Cursor: c.Query("cursor"), Admin: admin})
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func csvCell(value string) string {
	stripped := strings.TrimLeft(value, " \t\r\n")
	if stripped != "" && strings.ContainsRune("=+-@", rune(stripped[0])) {
		if _, err := strconv.ParseInt(stripped, 10, 64); err != nil {
			return "'" + value
		}
	}
	if strings.ContainsAny(value, "\t\r\n") {
		return "'" + value
	}
	return value
}
func optionalCredits(value string) (*int64, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed < 0 || parsed > 2_000_000_000_000 {
		return nil, problem.Invalid()
	}
	return &parsed, nil
}
func beginCSV(c *gin.Context, name string) *csv.Writer {
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	c.Header("X-Content-Type-Options", "nosniff")
	return csv.NewWriter(c.Writer)
}
func csvRow(writer *csv.Writer, row []string) error {
	for i, cell := range row {
		row[i] = csvCell(cell)
	}
	if err := writer.Write(row); err != nil {
		return fmt.Errorf("write CSV row: %w", err)
	}
	return nil
}
func uuidCell(value *uuid.UUID) string {
	if value == nil {
		return ""
	}
	return value.String()
}
func (h *Handler) exportLedger(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	owner, err := optionalID(c.Query("user_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	filter, err := ledgerFilter(c, owner)
	if err != nil {
		h.fail(c, err)
		return
	}
	filter.Cursor = ""
	filter.Limit = 100
	if filter.Until == nil {
		until := time.Now().UTC()
		filter.Until = &until
	}
	page, err := h.services.Credits.Ledger(c.Request.Context(), filter)
	if err != nil {
		h.fail(c, err)
		return
	}
	if err := h.services.Credits.ExportAudit(c.Request.Context(), current.Actor, "credit_ledger", filter); err != nil {
		h.fail(c, err)
		return
	}
	catalog, err := loadCSVCatalog(current.User.Locale)
	if err != nil {
		h.fail(c, err)
		return
	}
	writer := beginCSV(c, "lumi-credit-ledger.csv")
	if err := csvRow(writer, catalog.LedgerHeaders); err != nil {
		h.csvFailure(c, err)
		return
	}
	for {
		for _, r := range page.Items {
			if err := csvRow(writer, []string{r.ID.String(), r.UserID.String(), catalog.Types[r.Type], catalog.Buckets[r.Bucket], strconv.FormatInt(r.Delta, 10), strconv.FormatInt(r.BucketBalanceAfter, 10), strconv.FormatInt(r.TotalAfter, 10), r.RefType, uuidCell(r.RefID), uuidCell(r.OperatorID), r.Note, r.CreatedAt.Format(time.RFC3339Nano)}); err != nil {
				h.csvFailure(c, err)
				return
			}
		}
		writer.Flush()
		if err := writer.Error(); err != nil {
			h.csvFailure(c, err)
			return
		}
		if page.NextCursor == "" {
			return
		}
		filter.Cursor = page.NextCursor
		page, err = h.services.Credits.Ledger(c.Request.Context(), filter)
		if err != nil {
			h.csvFailure(c, err)
			return
		}
	}
}
func (h *Handler) exportCodes(c *gin.Context) {
	if !h.checkAdmin(c) {
		return
	}
	current, ok := principal(c)
	if !ok {
		h.fail(c, problem.Unauthorized())
		return
	}
	filter, err := codeFilter(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	filter.Cursor = ""
	filter.Limit = 100
	page, err := h.services.Credits.Codes(c.Request.Context(), filter)
	if err != nil {
		h.fail(c, err)
		return
	}
	auditFilter := map[string]any{"batch_id": filter.BatchID, "status": filter.Status, "search_present": filter.Search != ""}
	if err := h.services.Credits.ExportAudit(c.Request.Context(), current.Actor, "redeem_code", auditFilter); err != nil {
		h.fail(c, err)
		return
	}
	catalog, err := loadCSVCatalog(current.User.Locale)
	if err != nil {
		h.fail(c, err)
		return
	}
	writer := beginCSV(c, "lumi-redeem-codes.csv")
	if err := csvRow(writer, catalog.CodeHeaders); err != nil {
		h.csvFailure(c, err)
		return
	}
	for {
		for _, r := range page.Items {
			expiry := ""
			if r.ExpiresAt != nil {
				expiry = r.ExpiresAt.Format(time.RFC3339Nano)
			}
			if err := csvRow(writer, []string{r.ID.String(), r.BatchID.String(), r.Code, strconv.FormatInt(r.Credits, 10), strconv.Itoa(int(r.MaxUses)), strconv.Itoa(int(r.UsedCount)), catalog.States[r.Status], expiry, r.CreatedAt.Format(time.RFC3339Nano)}); err != nil {
				h.csvFailure(c, err)
				return
			}
		}
		writer.Flush()
		if err := writer.Error(); err != nil {
			h.csvFailure(c, err)
			return
		}
		if page.NextCursor == "" {
			return
		}
		filter.Cursor = page.NextCursor
		page, err = h.services.Credits.Codes(c.Request.Context(), filter)
		if err != nil {
			h.csvFailure(c, err)
			return
		}
	}
}
func (h *Handler) csvFailure(c *gin.Context, err error) {
	h.logger.ErrorContext(c.Request.Context(), "CSV export interrupted", "route", c.FullPath(), "error_type", fmt.Sprintf("%T", err))
	c.Abort()
}
