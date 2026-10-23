package account

import (
	"embed"
	"encoding/json"
	"fmt"
)

//go:embed locales/*.json
var csvMessages embed.FS

type csvCatalog struct {
	LedgerHeaders []string          `json:"ledger_headers"`
	CodeHeaders   []string          `json:"code_headers"`
	Types         map[string]string `json:"types"`
	Buckets       map[string]string `json:"buckets"`
	States        map[string]string `json:"states"`
}

func loadCSVCatalog(locale string) (csvCatalog, error) {
	if locale != "en" {
		locale = "zh-CN"
	}
	source, err := csvMessages.ReadFile("locales/credits." + locale + ".json")
	if err != nil {
		return csvCatalog{}, fmt.Errorf("read CSV translations: %w", err)
	}
	var result csvCatalog
	if err := json.Unmarshal(source, &result); err != nil {
		return result, fmt.Errorf("decode CSV translations: %w", err)
	}
	return result, nil
}
