package images

import (
	"regexp"
	"strings"

	"github.com/xinghenWink/Lumi/backend/internal/platform/problem"
)

var (
	quotedGIFText    = regexp.MustCompile("[\"“][^\"”]*[\"”]|「[^」]*」|『[^』]*』|‘[^’]*’|\x60[^\x60]*\x60|(?:^|\\s)'[^']*'")
	gifNegation      = regexp.MustCompile(`不要|不用|不需要|不生成|不制作|不做|不输出|别|无需|禁止|\b(?:no|not|never|without|don['’]t)\b`)
	chineseGIFOutput = regexp.MustCompile(`(?:生成|制作|输出|导出|做成|转成|做(?:一?[个個張张段])?)[^，。！？；,:;.!?\n]*?gif(?:\s*(?:动图|動畫|动画|動圖|格式|文件)|\s*$)`)
	englishGIFOutput = regexp.MustCompile(`\b(?:generate|create|make|render|export|output)\s+(?:(?:a|an|one|the)\s+)?(?:animated\s+)?gif\b(?:\s+(?:animation|file))?(?:\s*$|\s+(?:of|from|with|that|showing|using|for|based)\b)`)
	gifTextOnImage   = regexp.MustCompile(`(?:字样|字樣|文字|字母|标有|標有|印有|写有|寫有)|\b(?:text|letters|word|reading|saying|labelled|labeled)\b`)
)

func promptRequestsGIF(prompt string) bool {
	prompt = quotedGIFText.ReplaceAllString(strings.ToLower(prompt), " ")
	for clause := range strings.FieldsFuncSeq(prompt, func(r rune) bool {
		return strings.ContainsRune("，。！？；,:;.!?\n", r)
	}) {
		if gifNegation.MatchString(clause) || gifTextOnImage.MatchString(clause) {
			continue
		}
		if chineseGIFOutput.MatchString(clause) || englishGIFOutput.MatchString(clause) {
			return true
		}
	}
	return false
}

func resolveOutputFormat(input Input, supportsGIF, inferFromPrompt bool) (string, error) {
	switch input.OutputFormat {
	case "":
		if supportsGIF && inferFromPrompt && input.EditOptions == nil && promptRequestsGIF(input.Prompt) {
			return "gif", nil
		}
	case "png":
		return "png", nil
	case "gif":
		if supportsGIF && input.EditOptions == nil {
			return "gif", nil
		}
		return "", problem.New("IMAGE_GIF_UNSUPPORTED", 400)
	default:
		return "", problem.Invalid()
	}
	return "", nil
}
