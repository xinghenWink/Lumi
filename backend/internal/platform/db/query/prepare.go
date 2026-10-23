package query

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// PrepareLatencyQueries describes the hot paths without executing any business SQL.
// Using SQL as the statement name lets pgx reuse the description for generated calls.
func PrepareLatencyQueries(ctx context.Context, conn *pgx.Conn) error {
	for _, statement := range []string{
		getAuthenticatedUser, getChatSettings, getPlatformModel, availableModelRoutes,
		getConversation, listConversations, listPublicModels, listImageGallery,
		getCreditConfiguration, readCurrentCreditAccount, readCreditAccount,
		lockChatUser, getUserForUpdate, lockConversation, chatMessageByRequest,
		listChatMessages, insertChatMessage, getPreferences, useChatDailyQuota, startChatRun,
		getUpstream, recordCircuitSuccess, appendUpstreamCall,
		heartbeatChatRun, checkpointChatMessage, finishChatRun, persistChatRun, autoTitleConversation,
		getImageSettings, listSettings,
	} {
		if _, err := conn.Prepare(ctx, statement, statement); err != nil {
			return fmt.Errorf("prepare latency query: %w", err)
		}
	}
	return nil
}
